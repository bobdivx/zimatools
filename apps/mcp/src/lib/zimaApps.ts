import { dockerSockAvailable, dockerSockJson } from "./dockerSock.js";
import { DockerSSH } from "./dockerSSH.js";

const GPU_NAME_RE = /ollama|popcorn|whisper|comfy|stable-diffusion|invoke|ffmpeg|sdnext|automatic1111/i;
const AGENTS_NAME_RE = /devforge|agent/i;

export interface ZimaApp {
  id: string;
  name: string;
  title: string;
  image: string;
  state: string;
  running: boolean;
  status: string;
  ports: string;
  icon: string | null;
  runtime: string | null;
  gpu: boolean;
  labels: Record<string, string>;
  gpuClient: string;
  gpuPriority: number;
}

export function gpuClientForName(name: string): { client: string; priority: number } {
  const n = name.replace(/^\//, "");
  if (/popcorn/i.test(n)) return { client: "popcorn", priority: 100 };
  if (/^ollama\b/i.test(n) || /^ollama$/i.test(n)) return { client: "ollama", priority: 50 };
  if (AGENTS_NAME_RE.test(n)) return { client: "agents", priority: 25 };
  return { client: n, priority: 25 };
}

function stripName(name: string): string {
  return name.replace(/^\//, "");
}

function formatPorts(ports: unknown): string {
  if (!ports) return "";
  if (typeof ports === "string") return ports;
  if (!Array.isArray(ports)) return String(ports);
  return ports
    .map((p: any) => {
      if (p?.PublicPort) {
        const ip = p.IP && p.IP !== "0.0.0.0" && p.IP !== "::" ? `${p.IP}:` : "";
        return `${ip}${p.PublicPort}->${p.PrivatePort}/${p.Type || "tcp"}`;
      }
      if (p?.PrivatePort) return `${p.PrivatePort}/${p.Type || "tcp"}`;
      return "";
    })
    .filter(Boolean)
    .join(", ");
}

function pickIcon(labels: Record<string, string>): string | null {
  return (
    labels.icon ||
    labels["io.casaos.icon"] ||
    labels["x-casaos.icon"] ||
    labels["com.casaos.app.icon"] ||
    null
  );
}

function pickTitle(name: string, labels: Record<string, string>): string {
  const rawCasa = labels["x-casaos"];
  if (rawCasa) {
    try {
      const parsed = JSON.parse(rawCasa);
      const title = parsed?.title?.en_us || parsed?.title?.en || parsed?.title;
      if (typeof title === "string" && title.trim()) return title.trim();
      if (parsed?.name) return String(parsed.name);
    } catch {
      /* ignore invalid JSON label */
    }
  }
  return (
    labels.title ||
    labels["io.casaos.title"] ||
    labels["x-casaos.title"] ||
    labels["com.docker.compose.service"] ||
    name
  );
}

interface DockerListItem {
  Id: string;
  Names?: string[];
  Image?: string;
  State?: string;
  Status?: string;
  Ports?: unknown[];
  Labels?: Record<string, string>;
  HostConfig?: { Runtime?: string };
}

interface DockerInspect {
  HostConfig?: { Runtime?: string };
  Config?: { Labels?: Record<string, string> };
}

function toApp(partial: {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  labels: Record<string, string>;
  runtime: string | null;
}): ZimaApp {
  const mapping = gpuClientForName(partial.name);
  const gpu =
    partial.runtime === "nvidia" ||
    GPU_NAME_RE.test(partial.name) ||
    GPU_NAME_RE.test(partial.image);
  const running = partial.state.toLowerCase() === "running";
  return {
    id: partial.id,
    name: partial.name,
    title: pickTitle(partial.name, partial.labels),
    image: partial.image,
    state: partial.state,
    running,
    status: partial.status,
    ports: partial.ports,
    icon: pickIcon(partial.labels),
    runtime: partial.runtime,
    gpu,
    labels: partial.labels,
    gpuClient: mapping.client,
    gpuPriority: mapping.priority,
  };
}

async function listFromSock(): Promise<ZimaApp[]> {
  const list = await dockerSockJson<DockerListItem[]>("GET", "/containers/json?all=true");
  const apps = await Promise.all(
    (list || []).map(async (c) => {
      const name = stripName((c.Names && c.Names[0]) || c.Id.slice(0, 12));
      const labels = c.Labels || {};
      let runtime: string | null = c.HostConfig?.Runtime || null;
      try {
        const inspect = await dockerSockJson<DockerInspect>("GET", `/containers/${encodeURIComponent(c.Id)}/json`);
        runtime = inspect.HostConfig?.Runtime || runtime;
      } catch {
        /* list payload is enough for name/icon; runtime may stay null */
      }
      return toApp({
        id: c.Id.slice(0, 12),
        name,
        image: c.Image || "",
        state: c.State || "",
        status: c.Status || "",
        ports: formatPorts(c.Ports),
        labels,
        runtime,
      });
    }),
  );
  apps.sort((a, b) => Number(b.running) - Number(a.running) || a.title.localeCompare(b.title, "fr"));
  return apps;
}

async function listFromSsh(): Promise<ZimaApp[]> {
  const containers = await DockerSSH.listContainers();
  return (containers || []).map((c: any) =>
    toApp({
      id: String(c.id || c.name || ""),
      name: String(c.name || "unknown"),
      image: String(c.image || ""),
      state: String(c.state || ""),
      status: String(c.status || c.state || ""),
      ports: String(c.ports || ""),
      labels: {},
      runtime: null,
    }),
  );
}

export async function listApps(): Promise<{
  ok: boolean;
  source: "sock" | "ssh" | "stub";
  apps: ZimaApp[];
  error?: string;
}> {
  let sockError: string | undefined;
  try {
    if (await dockerSockAvailable()) {
      const apps = await listFromSock();
      return { ok: true, source: "sock", apps };
    }
    sockError = "docker.sock ping failed";
  } catch (error: any) {
    sockError = error?.message || String(error);
  }

  try {
    const apps = await listFromSsh();
    return { ok: true, source: "ssh", apps, error: sockError };
  } catch (error: any) {
    return {
      ok: false,
      source: "stub",
      apps: [],
      error: `sock: ${sockError || "unavailable"}; ssh: ${error?.message || error}`,
    };
  }
}

export async function listContainersLegacy() {
  const listed = await listApps();
  return {
    stub: listed.source === "stub",
    source: listed.source,
    containers: listed.apps.map((a) => ({
      id: a.id,
      name: a.name,
      image: a.image,
      status: a.status,
      state: a.state,
      ports: a.ports,
    })),
    error: listed.error,
  };
}
