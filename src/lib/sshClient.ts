import { Client } from "ssh2";

interface SSHConfig {
  host: string;
  username: string;
  password: string;
  port?: number;
}

let sshClient: Client | null = null;
let isConnected = false;
let currentConfig: SSHConfig | null = null;

/**
 * Obtient ou crée une connexion SSH
 */
function getSSHClient(config: SSHConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    // Vérifier si on a déjà une connexion active avec la même config
    if (
      sshClient &&
      isConnected &&
      currentConfig &&
      currentConfig.host === config.host &&
      currentConfig.port === (config.port || 22) &&
      currentConfig.username === config.username
    ) {
      resolve(sshClient);
      return;
    }

    // Fermer l'ancienne connexion si elle existe
    if (sshClient) {
      try {
        sshClient.end();
      } catch (e) {
        // Ignorer les erreurs lors de la fermeture
      }
      sshClient = null;
      isConnected = false;
    }

    const client = new Client();
    
    client
      .on("ready", () => {
        sshClient = client;
        isConnected = true;
        currentConfig = config;
        resolve(client);
      })
      .on("error", (err) => {
        isConnected = false;
        sshClient = null;
        currentConfig = null;
        reject(err);
      })
      .on("close", () => {
        isConnected = false;
        if (sshClient === client) {
          sshClient = null;
          currentConfig = null;
        }
      })
      .connect({
        host: config.host,
        port: config.port || 22,
        username: config.username,
        password: config.password,
        readyTimeout: 20000,
        tryKeyboard: false,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
      });
  });
}

/**
 * Exécute une commande via SSH
 */
export async function executeSSHCommand(
  command: string,
  config: SSHConfig
): Promise<{ stdout: string; stderr: string; code: number }> {
  const client = await getSSHClient(config);

  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }

      let stdout = "";
      let stderr = "";

      stream
        .on("close", (code: number | null) => {
          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            code: code || 0,
          });
        })
        .on("data", (data: Buffer) => {
          stdout += data.toString();
        })
        .stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
    });
  });
}

/**
 * Ferme la connexion SSH
 */
export async function closeSSHConnection(): Promise<void> {
  return new Promise((resolve) => {
    if (sshClient) {
      sshClient.end();
      sshClient.on("close", () => {
        sshClient = null;
        isConnected = false;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

/**
 * Extrait l'hostname d'une URL (ex: http://zimacube.local:90 -> zimacube.local)
 */
function extractHostFromURL(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    // Si ce n'est pas une URL valide, essayer de parser comme hostname:port
    const parts = url.replace(/^https?:\/\//, '').split(':');
    return parts[0] || null;
  }
}

/**
 * Obtient la configuration SSH depuis les variables d'environnement
 * Essaie automatiquement de déduire l'host SSH depuis ZIMAOS_API_BASE si ZIMAOS_SSH_HOST n'est pas défini
 */
export function getSSHConfig(): SSHConfig {
  // Récupérer ou déduire l'host SSH
  let host = process.env.ZIMAOS_SSH_HOST;
  
  if (!host && process.env.ZIMAOS_API_BASE) {
    // Essayer de déduire l'host depuis ZIMAOS_API_BASE
    const derivedHost = extractHostFromURL(process.env.ZIMAOS_API_BASE);
    if (derivedHost) {
      host = derivedHost;
      console.log(`Auto-detected SSH host from ZIMAOS_API_BASE: ${host}`);
    }
  }

  if (!host) {
    throw new Error(
      "ZIMAOS_SSH_HOST environment variable is required (or set ZIMAOS_API_BASE to auto-detect)"
    );
  }

  // Support both ZIMAOS_SSH_USERNAME and ZIMAOS_USER for flexibility
  const username = process.env.ZIMAOS_SSH_USERNAME || process.env.ZIMAOS_USER || "zimaos";
  const password = process.env.ZIMAOS_SSH_PASSWORD;
  
  // Port SSH : utiliser ZIMAOS_SSH_PORT si défini, sinon 22 par défaut
  const port = process.env.ZIMAOS_SSH_PORT
    ? parseInt(process.env.ZIMAOS_SSH_PORT, 10)
    : 22;

  if (!password) {
    throw new Error("ZIMAOS_SSH_PASSWORD environment variable is required");
  }

  return { host, username, password, port };
}
