import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  dockerPullImage,
  dockerSockAvailable,
  dockerSockJson,
  dockerSockRequest,
} from "./dockerSock.js";

function resolveDataDir(): string {
  if (process.env.ZIMATOOLS_DATA_DIR) return process.env.ZIMATOOLS_DATA_DIR;
  try {
    if (fs.existsSync("/data") || process.platform !== "win32") return "/data";
  } catch {
    /* ignore */
  }
  return path.join(process.cwd(), ".data");
}

const DATA_DIR = resolveDataDir();
const STORE_PATH = path.join(DATA_DIR, "image-watchdog.json");

/** Conteneurs exclus du watchdog (self + infra). */
export const WATCHDOG_EXCLUDE_RE =
  /zimatools-mcp|zimatools-web|cloudflared|flaresolverr|github-runner/i;

const DEFAULT_INTERVAL = 60;
const INTERVAL_CHOICES = [15, 30, 60, 360, 1440] as const;

export type WatchdogResultStatus = "updated" | "unchanged" | "skipped" | "error";

export interface WatchdogResult {
  name: string;
  image: string;
  status: WatchdogResultStatus;
  message?: string;
  at: string;
}

export interface WatchdogRun {
  startedAt: string;
  finishedAt: string;
  trigger: "timer" | "manual" | "webhook";
  results: WatchdogResult[];
}

export interface WatchdogConfig {
  enabled: boolean;
  intervalMinutes: number;
  excludeNames: string[];
}

export interface WatchdogState {
  config: WatchdogConfig;
  lastCheckAt: string | null;
  lastRun: WatchdogRun | null;
  running: boolean;
}

interface PersistedStore {
  config: WatchdogConfig;
  webhookSecret: string;
  lastCheckAt: string | null;
  lastRun: WatchdogRun | null;
}

function generateSecret(): string {
  return crypto.randomBytes(24).toString("base64url");
}

interface DockerListItem {
  Id: string;
  Names?: string[];
  Image?: string;
  ImageID?: string;
  State?: string;
}

interface DockerInspectFull {
  Id: string;
  Name?: string;
  Image: string;
  Config: Record<string, unknown> & {
    Image?: string;
    Hostname?: string;
    Labels?: Record<string, string>;
  };
  HostConfig: Record<string, unknown>;
  NetworkSettings?: {
    Networks?: Record<string, Record<string, unknown>>;
  };
  State?: { Running?: boolean };
}

function defaultConfig(): WatchdogConfig {
  return {
    enabled: false,
    intervalMinutes: DEFAULT_INTERVAL,
    excludeNames: ["zimatools-mcp", "zimatools-web"],
  };
}

function ensureDataDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

function loadStore(): PersistedStore {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedStore>;
    const base = defaultConfig();
    const secret =
      (typeof parsed.webhookSecret === "string" && parsed.webhookSecret.trim()) || generateSecret();
    const store: PersistedStore = {
      config: {
        enabled: Boolean(parsed.config?.enabled),
        intervalMinutes: clampInterval(parsed.config?.intervalMinutes ?? base.intervalMinutes),
        excludeNames: Array.isArray(parsed.config?.excludeNames)
          ? parsed.config!.excludeNames.map(String)
          : base.excludeNames,
      },
      webhookSecret: secret,
      lastCheckAt: parsed.lastCheckAt ?? null,
      lastRun: parsed.lastRun ?? null,
    };
    // Persist generated secret if file had none
    if (!parsed.webhookSecret?.trim()) saveStore(store);
    return store;
  } catch {
    const store: PersistedStore = {
      config: defaultConfig(),
      webhookSecret: generateSecret(),
      lastCheckAt: null,
      lastRun: null,
    };
    saveStore(store);
    return store;
  }
}

function saveStore(store: PersistedStore) {
  ensureDataDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function clampInterval(n: number): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 5) return DEFAULT_INTERVAL;
  if ((INTERVAL_CHOICES as readonly number[]).includes(v)) return v;
  return Math.min(Math.max(v, 5), 10080);
}

function stripName(name: string): string {
  return name.replace(/^\//, "");
}

function isExcluded(name: string, image: string, excludeNames: string[]): boolean {
  const n = stripName(name);
  if (WATCHDOG_EXCLUDE_RE.test(n) || WATCHDOG_EXCLUDE_RE.test(image)) return true;
  const lower = n.toLowerCase();
  return excludeNames.some((ex) => {
    const e = stripName(ex).toLowerCase();
    return e && (lower === e || lower.includes(e));
  });
}

function imageMatchesFilter(containerImage: string, filters: string[] | undefined): boolean {
  if (!filters?.length) return true;
  const ci = containerImage.toLowerCase();
  return filters.some((f) => {
    const needle = f.toLowerCase().trim();
    if (!needle) return false;
    if (ci === needle) return true;
    // match repo without tag
    const repo = needle.includes(":") ? needle.slice(0, needle.lastIndexOf(":")) : needle;
    const ciRepo = ci.includes(":") ? ci.slice(0, ci.lastIndexOf(":")) : ci;
    return ci === repo || ciRepo === repo || ci.startsWith(`${repo}:`) || ci.includes(needle);
  });
}

function buildCreateBody(inspect: DockerInspectFull, imageRef: string) {
  const config = { ...inspect.Config };
  // Keep Image as the named ref so recreate tracks the tag
  config.Image = imageRef;

  const hostConfig = { ...inspect.HostConfig };
  delete (hostConfig as any).Links;

  const networks = inspect.NetworkSettings?.Networks || {};
  const endpoints: Record<string, { IPAMConfig?: unknown; Links?: unknown; Aliases?: unknown }> = {};
  for (const [net, cfg] of Object.entries(networks)) {
    const c = cfg as Record<string, unknown>;
    endpoints[net] = {
      IPAMConfig: c.IPAMConfig ?? undefined,
      Links: c.Links ?? undefined,
      Aliases: c.Aliases ?? undefined,
    };
  }

  return {
    ...config,
    HostConfig: hostConfig,
    NetworkingConfig: { EndpointsConfig: endpoints },
  };
}

async function recreateContainer(
  inspect: DockerInspectFull,
  imageRef: string,
): Promise<void> {
  const name = stripName(inspect.Name || inspect.Id.slice(0, 12));
  const wasRunning = Boolean(inspect.State?.Running);
  const tempName = `${name}-ztwd-${Date.now().toString(36)}`;
  const id = inspect.Id;

  // Rename old out of the way
  {
    const { status, body } = await dockerSockRequest(
      "POST",
      `/containers/${encodeURIComponent(id)}/rename?name=${encodeURIComponent(tempName)}`,
      15_000,
    );
    if (status >= 400) throw new Error(`rename failed: ${body.slice(0, 200)}`);
  }

  let newId: string | undefined;
  try {
    if (wasRunning) {
      await dockerSockRequest("POST", `/containers/${encodeURIComponent(id)}/stop?t=20`, 60_000);
    }

    const createBody = buildCreateBody(inspect, imageRef);
    const created = await dockerSockJson<{ Id: string }>(
      "POST",
      `/containers/create?name=${encodeURIComponent(name)}`,
      { body: JSON.stringify(createBody), timeoutMs: 30_000 },
    );
    newId = created.Id;

    if (wasRunning) {
      const { status, body } = await dockerSockRequest(
        "POST",
        `/containers/${encodeURIComponent(newId)}/start`,
        60_000,
      );
      if (status >= 400) throw new Error(`start failed: ${body.slice(0, 200)}`);
    }

    await dockerSockRequest(
      "DELETE",
      `/containers/${encodeURIComponent(id)}?force=true&v=false`,
      30_000,
    );
  } catch (err) {
    // Rollback: remove botched new container, restore old name + start
    if (newId) {
      await dockerSockRequest(
        "DELETE",
        `/containers/${encodeURIComponent(newId)}?force=true`,
        30_000,
      ).catch(() => undefined);
    }
    await dockerSockRequest(
      "POST",
      `/containers/${encodeURIComponent(id)}/rename?name=${encodeURIComponent(name)}`,
      15_000,
    ).catch(() => undefined);
    if (wasRunning) {
      await dockerSockRequest("POST", `/containers/${encodeURIComponent(id)}/start`, 60_000).catch(
        () => undefined,
      );
    }
    throw err;
  }
}

class ImageWatchdog {
  private store: PersistedStore;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private queue: Promise<void> = Promise.resolve();

  constructor() {
    this.store = loadStore();
    this.reschedule();
  }

  /** Env IMAGE_WEBHOOK_SECRET overrides the persisted secret when set. */
  effectiveSecret(): { secret: string; source: "env" | "stored" } {
    const fromEnv = process.env.IMAGE_WEBHOOK_SECRET?.trim();
    if (fromEnv) return { secret: fromEnv, source: "env" };
    return { secret: this.store.webhookSecret, source: "stored" };
  }

  status(): WatchdogState & {
    webhookConfigured: boolean;
    webhookSecret: string;
    webhookSecretSource: "env" | "stored";
    dataPath: string;
  } {
    const { secret, source } = this.effectiveSecret();
    return {
      config: { ...this.store.config, excludeNames: [...this.store.config.excludeNames] },
      lastCheckAt: this.store.lastCheckAt,
      lastRun: this.store.lastRun,
      running: this.running,
      webhookConfigured: Boolean(secret),
      webhookSecret: secret,
      webhookSecretSource: source,
      dataPath: STORE_PATH,
    };
  }

  updateConfig(patch: {
    enabled?: boolean;
    intervalMinutes?: number;
    rotateSecret?: boolean;
  }): ReturnType<ImageWatchdog["status"]> {
    if (patch.enabled != null) this.store.config.enabled = Boolean(patch.enabled);
    if (patch.intervalMinutes != null) {
      this.store.config.intervalMinutes = clampInterval(patch.intervalMinutes);
    }
    if (patch.rotateSecret) {
      this.store.webhookSecret = generateSecret();
    }
    saveStore(this.store);
    this.reschedule();
    return this.status();
  }

  private reschedule() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!this.store.config.enabled) return;
    const ms = this.store.config.intervalMinutes * 60_000;
    this.timer = setInterval(() => {
      void this.enqueue("timer");
    }, ms);
    // Don't block process exit
    if (typeof this.timer === "object" && this.timer && "unref" in this.timer) {
      (this.timer as NodeJS.Timeout).unref();
    }
  }

  enqueue(trigger: WatchdogRun["trigger"], images?: string[]): Promise<WatchdogRun> {
    const runPromise = this.queue.then(() => this.checkAndUpdate(trigger, images));
    this.queue = runPromise.then(
      () => undefined,
      () => undefined,
    );
    return runPromise;
  }

  private async checkAndUpdate(
    trigger: WatchdogRun["trigger"],
    images?: string[],
  ): Promise<WatchdogRun> {
    const startedAt = new Date().toISOString();
    this.running = true;
    const results: WatchdogResult[] = [];

    try {
      if (!(await dockerSockAvailable())) {
        results.push({
          name: "*",
          image: "",
          status: "error",
          message: "docker.sock unavailable",
          at: new Date().toISOString(),
        });
      } else {
        const list = await dockerSockJson<DockerListItem[]>("GET", "/containers/json?all=true");
        for (const c of list || []) {
          const name = stripName((c.Names && c.Names[0]) || c.Id.slice(0, 12));
          const image = c.Image || "";

          if (isExcluded(name, image, this.store.config.excludeNames)) {
            if (!images?.length) {
              results.push({
                name,
                image,
                status: "skipped",
                message: "excluded",
                at: new Date().toISOString(),
              });
            }
            continue;
          }
          if (!imageMatchesFilter(image, images)) continue;

          try {
            const before = await dockerSockJson<DockerInspectFull>(
              "GET",
              `/containers/${encodeURIComponent(c.Id)}/json`,
            );
            const imageRef = (before.Config?.Image as string) || image;
            const imageIdBefore = before.Image;

            await dockerPullImage(imageRef);

            const pulled = await dockerSockJson<{ Id: string }>(
              "GET",
              `/images/${encodeURIComponent(imageRef)}/json`,
            );
            const newImageId = pulled.Id;
            if (!newImageId || newImageId === imageIdBefore) {
              results.push({
                name,
                image: imageRef,
                status: "unchanged",
                at: new Date().toISOString(),
              });
              continue;
            }

            await recreateContainer(before, imageRef);
            results.push({
              name,
              image: imageRef,
              status: "updated",
              message: `${imageIdBefore.slice(7, 19) || imageIdBefore.slice(0, 12)} → ${newImageId.slice(7, 19) || newImageId.slice(0, 12)}`,
              at: new Date().toISOString(),
            });
          } catch (e: any) {
            results.push({
              name,
              image,
              status: "error",
              message: e?.message || String(e),
              at: new Date().toISOString(),
            });
          }
        }
      }
    } finally {
      this.running = false;
    }

    const finishedAt = new Date().toISOString();
    const run: WatchdogRun = { startedAt, finishedAt, trigger, results };
    this.store.lastCheckAt = finishedAt;
    this.store.lastRun = run;
    saveStore(this.store);
    return run;
  }
}

export const imageWatchdog = new ImageWatchdog();

export function verifyWebhookSecret(headerAuth: string | undefined, headerSecret: string | undefined): boolean {
  const expected = imageWatchdog.effectiveSecret().secret;
  if (!expected) return false;
  if (headerSecret && headerSecret === expected) return true;
  if (headerAuth) {
    const m = /^Bearer\s+(.+)$/i.exec(headerAuth.trim());
    if (m && m[1] === expected) return true;
  }
  return false;
}

export { INTERVAL_CHOICES };
