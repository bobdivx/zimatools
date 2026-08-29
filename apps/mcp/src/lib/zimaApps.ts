import { dockerSockAvailable, dockerSockJson } from "./dockerSock.js";
import { DockerSSH } from "./dockerSSH.js";

const GPU_NAME_RE = /ollama|popcorn|whisper|comfy|stable-diffusion|invoke|ffmpeg|sdnext|automatic1111|musicgpt/i;
const GPU_EXCLUDE_RE = /zimatools-mcp|zimatools-web|cloudflared/i;
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

interface DockerDeviceRequest {
  Driver?: string;
  Count?: number;
  DeviceIDs?: string[] | null;
  Capabilities?: unknown;
}

interface DockerListItem {
  Id: string;
  Names?: string[];
  Image?: string;
  State?: string;
  Status?: string;
  Ports?: unknown[];
  Labels?: Record<string, string>;
  HostConfig?: { Runtime?: string; DeviceRequests?: DockerDeviceRequest[] };
}

interface DockerInspect {
  HostConfig?: {
    Runtime?: string;
    DeviceRequests?: DockerDeviceRequest[];
    Devices?: Array<{ PathOnHost?: string; PathInContainer?: string }>;
  };
  Config?: { Labels?: Record<string, string>; Env?: string[] };
}

function nvidiaVisibleDevices(env: string[] | undefined): boolean {
  if (!env?.length) return false;
  for (const line of env) {
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    if (line.slice(0, eq) !== "NVIDIA_VISIBLE_DEVICES") continue;
    const value = line.slice(eq + 1).trim();
    if (!value) return false;
    const lower = value.toLowerCase();
    if (lower === "void" || lower === "none") return false;
    return true;
  }
  return false;
}

function hasGpuDeviceRequest(reqs: DockerDeviceRequest[] | undefined): boolean {
  if (!reqs?.length) return false;
  return reqs.some((req) => {
    const driver = String(req?.Driver || "").toLowerCase();
    if (driver === "nvidia" || driver === "gpu") return true;
    const caps = req?.Capabilities;
    const flat = Array.isArray(caps)
      ? (caps as unknown[]).flat(3).map((c) => String(c).toLowerCase())
      : [];
    if (flat.includes("gpu") || flat.includes("nvidia")) return true;
    if (typeof req?.Count === "number" && req.Count !== 0) return true;
    if (Array.isArray(req?.DeviceIDs) && req.DeviceIDs.length > 0) return true;
    return false;
  });
}

function hasNvidiaDevicePath(devices: DockerInspect["HostConfig"] extends infer H ? any : never): boolean {
  if (!devices?.length) return false;
  return devices.some((d: any) => /nvidia/i.test(String(d?.PathOnHost || d?.PathInContainer || "")));
}

export function isGpuApp(partial: {
  name: string;
  image: string;
  runtime: string | null;
  env?: string[];
  deviceRequests?: DockerDeviceRequest[];
  devices?: Array<{ PathOnHost?: string; PathInContainer?: string }>;
}): boolean {
  const name = stripName(partial.name);
  const image = partial.image || "";
  if (GPU_EXCLUDE_RE.test(name) || GPU_EXCLUDE_RE.test(image)) return false;
  if (partial.runtime === "nvidia") return true;
  if (hasGpuDeviceRequest(partial.deviceRequests)) return true;
  if (nvidiaVisibleDevices(partial.env)) return true;
  if (hasNvidiaDevicePath(partial.devices)) return true;
  if (GPU_NAME_RE.test(name) || GPU_NAME_RE.test(image)) return true;
  return false;
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
  env?: string[];
  deviceRequests?: DockerDeviceRequest[];
  devices?: Array<{ PathOnHost?: string; PathInContainer?: string }>;
}): ZimaApp {
  const mapping = gpuClientForName(partial.name);
  const gpu = isGpuApp(partial);
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
      let env: string[] | undefined;
      let deviceRequests = c.HostConfig?.DeviceRequests;
      let devices: Array<{ PathOnHost?: string; PathInContainer?: string }> | undefined;
      try {
        const inspect = await dockerSockJson<DockerInspect>("GET", `/containers/${encodeURIComponent(c.Id)}/json`);
        runtime = inspect.HostConfig?.Runtime || runtime;
        env = inspect.Config?.Env;
        deviceRequests = inspect.HostConfig?.DeviceRequests || deviceRequests;
        devices = inspect.HostConfig?.Devices;
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
        env,
        deviceRequests,
        devices,
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
