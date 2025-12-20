import { executeSSHCommand, getSSHConfig } from "./sshClient.js";

/**
 * API Docker utilisant SSH pour exécuter des commandes Docker directement
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
    const config = getSSHConfig();
    const command = `docker start ${containerId}`;
    
    try {
      let result = await executeSSHCommand(command, config);
      
      if (result.code !== 0 || result.stderr) {
        // Essayer avec sudo
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
    const config = getSSHConfig();
    const command = `docker stop ${containerId}`;
    
    try {
      let result = await executeSSHCommand(command, config);
      
      if (result.code !== 0 || result.stderr) {
        // Essayer avec sudo
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
    const config = getSSHConfig();
    const command = `docker restart ${containerId}`;
    
    try {
      let result = await executeSSHCommand(command, config);
      
      if (result.code !== 0 || result.stderr) {
        // Essayer avec sudo
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
