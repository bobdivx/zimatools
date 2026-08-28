export type McpToolCategoryId = "fichiers" | "docker" | "gpu";

export interface McpToolInfo {
  name: string;
  className: string;
  summary: string;
  enabled: boolean;
}

export interface McpToolCategory {
  id: McpToolCategoryId;
  title: string;
  description: string;
  tools: McpToolInfo[];
}

export const MCP_VERSION = "0.1.0";

export const MCP_CATEGORIES: McpToolCategory[] = [
  {
    id: "fichiers",
    title: "Fichiers",
    description: "Lecture et modification du stockage ZimaOS via l'API fichiers.",
    tools: [
      {
        name: "list_directory_zimaos",
        className: "ListDirectory",
        summary: "Liste fichiers et dossiers d'un chemin ZimaOS, avec prefixe [FILE] / [DIR].",
        enabled: true,
      },
      {
        name: "read_file_from_zimaos",
        className: "ReadFile",
        summary: "Lit le contenu complet d'un fichier sur le NAS.",
        enabled: true,
      },
      {
        name: "write_file_zimaos",
        className: "WriteFile",
        summary: "Ecrit ou cree un fichier sur ZimaOS.",
        enabled: true,
      },
      {
        name: "edit_file_zimaos",
        className: "EditFile",
        summary: "Modifie un fichier existant (remplacement cible).",
        enabled: true,
      },
      {
        name: "search_file_zimaos",
        className: "SearchFile",
        summary: "Recherche un fichier par nom dans l'arborescence ZimaOS.",
        enabled: true,
      },
      {
        name: "get_file_info_zimaos",
        className: "Getfileinfo",
        summary: "Metadonnees d'un fichier : taille, type, dates.",
        enabled: true,
      },
      {
        name: "create_directory_zimaos",
        className: "Createdirectory",
        summary: "Cree un dossier sur ZimaOS.",
        enabled: true,
      },
      {
        name: "MoveFiles",
        className: "Movefiles",
        summary: "Deplace ou renomme des fichiers — outil present dans le depot mais desactive (non charge).",
        enabled: false,
      },
      {
        name: "list_allowed_directories_zimaos",
        className: "ListAllowedDirectories",
        summary: "Chemins ZimaOS accessibles par les outils fichiers.",
        enabled: true,
      },
    ],
  },
  {
    id: "docker",
    title: "Docker",
    description: "Inventaire et cycle de vie des conteneurs ZimaOS (via docker.sock ou SSH).",
    tools: [
      {
        name: "list_docker_containers_zimaos",
        className: "ListDockerContainers",
        summary: "Liste tous les conteneurs (id, nom, image, etat, ports).",
        enabled: true,
      },
      {
        name: "start_docker_container_zimaos",
        className: "StartDockerContainer",
        summary: "Demarre un conteneur identifie par nom ou id.",
        enabled: true,
      },
      {
        name: "stop_docker_container_zimaos",
        className: "StopDockerContainer",
        summary: "Arrete un conteneur. A n'utiliser que hors ollama / popcornn-server.",
        enabled: true,
      },
      {
        name: "restart_docker_container_zimaos",
        className: "RestartDockerContainer",
        summary: "Redemarre un conteneur sans le retirer.",
        enabled: true,
      },
      {
        name: "get_docker_container_logs_zimaos",
        className: "GetDockerContainerLogs",
        summary: "Dernieres lignes de logs d'un conteneur.",
        enabled: true,
      },
      {
        name: "get_docker_container_info_zimaos",
        className: "GetDockerContainerInfo",
        summary: "Inspect detaille d'un conteneur (image, reseaux, mounts).",
        enabled: true,
      },
    ],
  },
  {
    id: "gpu",
    title: "GPU",
    description: "Arbitre VRAM: exclusif (popcorn) ou reservations partagees, wait/SSE, preemption par priorite.",
    tools: [
      {
        name: "gpu.status",
        className: "GpuStatus",
        summary: "nvidia-smi (ou stub), leases/reservations, VRAM libre, file et priorites.",
        enabled: true,
      },
      {
        name: "gpu.acquire",
        className: "GpuAcquire",
        summary: "Demande un lease (exclusif ou vramMiB partage). wait=true bloque jusqu'au grant. Une priorite plus haute preempte.",
        enabled: true,
      },
      {
        name: "gpu.release",
        className: "GpuRelease",
        summary: "Relache un lease/reservation et promeut la file si assez de VRAM.",
        enabled: true,
      },
      {
        name: "gpu.queue_list",
        className: "GpuQueueList",
        summary: "Leases/reservations et file d'attente, sans requeter nvidia-smi.",
        enabled: true,
      },
      {
        name: "gpu.set_priority",
        className: "GpuSetPriority",
        summary: "Fixe la priorite d'un client (defaut popcorn 100, ollama 50, agents 25).",
        enabled: true,
      },
    ],
  },
];

export function mcpUrlForHost(hostname: string, port: number, endpoint: string): string {
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `http://${hostname}:${port}${path}`;
}

export async function probeMcpHttp(port: number, endpoint: string): Promise<{ reachable: boolean; status?: number; error?: string }> {
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = `http://127.0.0.1:${port}${path}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "text/event-stream, application/json, */*" },
      signal: AbortSignal.timeout(2500),
    });
    return { reachable: res.status < 500, status: res.status };
  } catch (error: any) {
    return { reachable: false, error: error?.message || String(error) };
  }
}
