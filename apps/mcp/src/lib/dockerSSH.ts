import { executeSSHCommand, getSSHConfig } from "./sshClient.js";
import { dockerSockAvailable, dockerSockRequest } from "./dockerSock.js";

async function viaSock(
  method: string,
  apiPath: string,
  timeoutMs = 60_000,
): Promise<boolean> {
  if (!(await dockerSockAvailable())) return false;
  const { status, body } = await dockerSockRequest(method, apiPath, timeoutMs);
  // 204/304 = ok for start/stop; 304 = already started
  if (status >= 400) {
    throw new Error(`Docker API ${status}: ${body.slice(0, 240)}`);
  }
  return true;
}

async function removeViaSock(containerId: string, force = true): Promise<void> {
  const qs = force ? "?force=true&v=false" : "?v=false";
  const { status, body } = await dockerSockRequest(
    "DELETE",
    `/containers/${encodeURIComponent(containerId)}${qs}`,
    30_000,
  );
  if (status >= 400 && status !== 404) {
    throw new Error(`Docker API ${status}: ${body.slice(0, 240)}`);
  }
}

/**
 * API Docker : préfère docker.sock (monté sur ZimaOS), fallback SSH si besoin.
 */
export const DockerSSH = {
  /**
   * Liste tous les conteneurs Docker (running et stopped)
   */
  async listContainers(): Promise<any[]> {
    const config = getSSHConfig();
    // Utiliser docker ps -a avec format tab séparé pour plus de fiabilité
    // Format: ID|Names|Image|Status|State|CreatedAt|Ports
    const command = `docker ps -a --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.State}}|{{.CreatedAt}}|{{.Ports}}'`;
    
    try {
      let result = await executeSSHCommand(command, config);
      
      if (result.code !== 0 || (result.stderr && !result.stdout)) {
        // Essayer avec sudo si la commande a échoué
        const sudoCommand = `sudo -n docker ps -a --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.State}}|{{.CreatedAt}}|{{.Ports}}'`;
        result = await executeSSHCommand(sudoCommand, config);
      }

      if (result.code !== 0 || !result.stdout) {
        throw new Error(result.stderr || "Failed to list containers");
      }
      
      return this.parseDockerPsOutput(result.stdout);
    } catch (error: any) {
      throw new Error(`Failed to list Docker containers: ${error.message}`);
    }
  },

  /**
   * Parse la sortie de docker ps --format (format tab séparé)
   */
  parseDockerPsOutput(output: string): any[] {
    if (!output.trim()) {
      return [];
    }

    const lines = output.trim().split('\n');
    const containers: any[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      
      const parts = line.split('|');
      if (parts.length >= 7) {
        containers.push({
          id: parts[0]?.substring(0, 12) || parts[0], // Raccourcir l'ID
          name: parts[1] || 'N/A',
          image: parts[2] || 'N/A',
          status: parts[3] || 'N/A',
          state: parts[4] || 'N/A',
          created: parts[5] || 'N/A',
          ports: parts[6] || 'N/A',
        });
      }
    }

    return containers;
  },

  /**
   * Obtient les informations détaillées d'un conteneur
   */
  async getContainerInfo(containerId: string): Promise<any> {
    const config = getSSHConfig();
    const command = `docker inspect ${containerId}`;
    
    try {
      let result = await executeSSHCommand(command, config);
      
      if (result.stderr && !result.stdout) {
        // Essayer avec sudo
        const sudoCommand = `sudo -n docker inspect ${containerId}`;
        result = await executeSSHCommand(sudoCommand, config);
      }

      if (result.stderr && !result.stdout) {
        throw new Error(result.stderr || "Failed to get container info");
      }

      const info = JSON.parse(result.stdout);
      return Array.isArray(info) ? info[0] : info;
    } catch (error: any) {
      if (error.message.includes("No such container")) {
        throw new Error(`Container ${containerId} not found`);
      }
      throw new Error(`Failed to get container info: ${error.message}`);
    }
  },

  /**
   * Démarre un conteneur Docker
   */
  async startContainer(containerId: string): Promise<void> {
    try {
      if (await viaSock("POST", `/containers/${encodeURIComponent(containerId)}/start`)) {
        return;
      }
    } catch (e: any) {
      // 304 = already started
      if (String(e?.message || e).includes("Docker API 304")) return;
      // Fall through to SSH if sock path failed for other reasons when SSH is configured
      try {
        getSSHConfig();
      } catch {
        throw e;
      }
    }

    const config = getSSHConfig();
    const command = `docker start ${containerId}`;
    
    try {
      let result = await executeSSHCommand(command, config);
      
      if (result.code !== 0 || result.stderr) {
        const sudoCommand = `sudo -n docker start ${containerId}`;
        result = await executeSSHCommand(sudoCommand, config);
      }

      if (result.code !== 0) {
        throw new Error(result.stderr || "Failed to start container");
      }
    } catch (error: any) {
      throw new Error(`Failed to start container: ${error.message}`);
    }
  },

  /**
   * Arrête un conteneur Docker
   */
  async stopContainer(containerId: string): Promise<void> {
    try {
      if (await viaSock("POST", `/containers/${encodeURIComponent(containerId)}/stop?t=20`)) {
        return;
      }
    } catch (e: any) {
      if (String(e?.message || e).includes("Docker API 304")) return;
      try {
        getSSHConfig();
      } catch {
        throw e;
      }
    }

    const config = getSSHConfig();
    const command = `docker stop ${containerId}`;
    
    try {
      let result = await executeSSHCommand(command, config);
      
      if (result.code !== 0 || result.stderr) {
        const sudoCommand = `sudo -n docker stop ${containerId}`;
        result = await executeSSHCommand(sudoCommand, config);
      }

      if (result.code !== 0) {
        throw new Error(result.stderr || "Failed to stop container");
      }
    } catch (error: any) {
      throw new Error(`Failed to stop container: ${error.message}`);
    }
  },

  /**
   * Redémarre un conteneur Docker
   */
  async restartContainer(containerId: string): Promise<void> {
    try {
      if (await viaSock("POST", `/containers/${encodeURIComponent(containerId)}/restart?t=20`)) {
        return;
      }
    } catch (e: any) {
      try {
        getSSHConfig();
      } catch {
        throw e;
      }
    }

    const config = getSSHConfig();
    const command = `docker restart ${containerId}`;
    
    try {
      let result = await executeSSHCommand(command, config);
      
      if (result.code !== 0 || result.stderr) {
        const sudoCommand = `sudo -n docker restart ${containerId}`;
        result = await executeSSHCommand(sudoCommand, config);
      }

      if (result.code !== 0) {
        throw new Error(result.stderr || "Failed to restart container");
      }
    } catch (error: any) {
      throw new Error(`Failed to restart container: ${error.message}`);
    }
  },

  /**
   * Supprime un conteneur (force par défaut).
   */
  async removeContainer(containerId: string, force = true): Promise<void> {
    try {
      if (await dockerSockAvailable()) {
        await removeViaSock(containerId, force);
        return;
      }
    } catch (e: any) {
      try {
        getSSHConfig();
      } catch {
        throw e;
      }
    }

    const config = getSSHConfig();
    const command = force ? `docker rm -f ${containerId}` : `docker rm ${containerId}`;
    let result = await executeSSHCommand(command, config);
    if (result.code !== 0) {
      result = await executeSSHCommand(`sudo -n ${command}`, config);
    }
    if (result.code !== 0) {
      throw new Error(result.stderr || "Failed to remove container");
    }
  },

  /**
   * Start ; si le port host est déjà pris, force-remove le conteneur (CasaOS le recrée au Start UI).
   * Retourne un message d'action pour l'appelant.
   */
  async startContainerRecoverPort(containerId: string): Promise<string> {
    try {
      await this.startContainer(containerId);
      return `Container ${containerId} started`;
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (!/port is already allocated/i.test(msg)) throw e;
      await this.removeContainer(containerId, true);
      return `Container ${containerId} removed (port conflict). Recreate/Start the app from ZimaOS UI.`;
    }
  },

  /**
   * Obtient les logs d'un conteneur Docker
   */
  async getContainerLogs(
    containerId: string,
    options?: { tail?: number; follow?: boolean }
  ): Promise<string> {
    const config = getSSHConfig();
    let command = `docker logs ${containerId}`;
    
    if (options?.tail) {
      command += ` --tail ${options.tail}`;
    }
    
    // Note: follow ne peut pas être utilisé en mode non-interactif
    // On ignore cette option pour l'instant
    
    try {
      let result = await executeSSHCommand(command, config);
      
      if (result.code !== 0 || (result.stderr && !result.stdout)) {
        // Essayer avec sudo
        const sudoCommand = command.replace('docker', 'sudo -n docker');
        result = await executeSSHCommand(sudoCommand, config);
      }

      if (result.code !== 0 && result.stderr) {
        throw new Error(result.stderr);
      }

      return result.stdout;
    } catch (error: any) {
      throw new Error(`Failed to get container logs: ${error.message}`);
    }
  },
};
