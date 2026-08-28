import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

/** Capacite virtuelle quand nvidia-smi est absent (tests / stub). */
const STUB_TOTAL_MIB = 24576;
const DEFAULT_SHARED_VRAM_MIB = 2048;
const SMI_CACHE_MS = 800;
const DEFAULT_WAIT_MS = 120_000;

export interface GpuInfo {
  index: number;
  name: string;
  memoryTotalMiB: number;
  memoryUsedMiB: number;
  memoryFreeMiB: number;
  utilizationPercent: number | null;
  temperatureC: number | null;
}

export interface Lease {
  id: string;
  client: string;
  priority: number;
  acquiredAt: string;
  expiresAt: string | null;
  preemptedFrom: string | null;
  vramMiB: number;
  exclusive: boolean;
}

export interface QueueItem {
  id: string;
  client: string;
  priority: number;
  requestedAt: string;
  vramMiB: number;
  exclusive: boolean;
  ttlSeconds?: number;
}

export interface Reservation {
  client: string;
  vramMiB: number;
  exclusive: boolean;
  leaseId: string;
}

export interface GpuResources {
  used: number;
  reserved: number;
  free: number;
}

export type GpuEventName = "queued" | "granted" | "released" | "preempted" | "position";

export interface AcquireOptions {
  vramMiB?: number;
  exclusive?: boolean;
}

export interface AcquireResult {
  granted: boolean;
  reason: string;
  lease: Lease | null;
  leases: Lease[];
  reservations: Reservation[];
  reservedMiB: number;
  freeForQueueMiB: number;
  queue: QueueItem[];
  position?: number;
  preempted?: Lease;
  preemptedList?: Lease[];
  released?: boolean;
  previous?: Lease | null;
  previousList?: Lease[];
}

export type GpuEventPayload = Record<string, unknown> & {
  client?: string;
  resources: GpuResources;
};

const DEFAULT_PRIORITIES: Record<string, number> = {
  popcorn: 100,
  ollama: 50,
  agents: 25,
};

function nowIso() {
  return new Date().toISOString();
}

function parseNumber(value: string): number | null {
  const n = Number.parseFloat(value.trim());
  return Number.isFinite(n) ? n : null;
}

async function queryNvidiaSmi(): Promise<{ gpus: GpuInfo[]; stub: boolean; error?: string }> {
  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      [
        "--query-gpu=index,name,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu",
        "--format=csv,noheader,nounits",
      ],
      { timeout: 5000 },
    );
    const gpus: GpuInfo[] = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(",").map((s) => s.trim());
        const [index, name, total, used, free, util, temp] = parts;
        return {
          index: Number.parseInt(index, 10) || 0,
          name: name || "unknown",
          memoryTotalMiB: parseNumber(total) ?? 0,
          memoryUsedMiB: parseNumber(used) ?? 0,
          memoryFreeMiB: parseNumber(free) ?? 0,
          utilizationPercent: parseNumber(util),
          temperatureC: parseNumber(temp),
        };
      });
    return { gpus, stub: false };
  } catch (error: any) {
    return {
      stub: true,
      error: error?.message || String(error),
      gpus: [
        {
          index: 0,
          name: "stub-gpu (nvidia-smi indisponible)",
          memoryTotalMiB: 0,
          memoryUsedMiB: 0,
          memoryFreeMiB: 0,
          utilizationPercent: null,
          temperatureC: null,
        },
      ],
    };
  }
}

export class GpuArbiter {
  private leases: Lease[] = [];
  private queue: QueueItem[] = [];
  private priorities: Record<string, number> = { ...DEFAULT_PRIORITIES };
  private bus = new EventEmitter();
  private lastSmi: { gpus: GpuInfo[]; stub: boolean; error?: string } = {
    stub: true,
    gpus: [
      {
        index: 0,
        name: "stub-gpu (nvidia-smi indisponible)",
        memoryTotalMiB: 0,
        memoryUsedMiB: 0,
        memoryFreeMiB: 0,
        utilizationPercent: null,
        temperatureC: null,
      },
    ],
  };
  private lastSmiAt = 0;

  constructor() {
    this.bus.setMaxListeners(100);
  }

  on(event: GpuEventName | "event", listener: (payload: GpuEventPayload) => void) {
    this.bus.on(event, listener);
    return () => this.bus.off(event, listener);
  }

  subscribe(cb: (event: GpuEventName, payload: GpuEventPayload) => void) {
    const handler = (event: GpuEventName, payload: GpuEventPayload) => cb(event, payload);
    this.bus.on("gpu", handler);
    return () => this.bus.off("gpu", handler);
  }

  private emitGpu(event: GpuEventName, payload: Record<string, unknown>) {
    const full = { ...payload, resources: this.resourcesSync() } as GpuEventPayload;
    this.bus.emit(event, full);
    this.bus.emit("event", { event, ...full });
    this.bus.emit("gpu", event, full);
  }

  getPriority(client: string): number {
    const key = client.toLowerCase();
    return this.priorities[key] ?? 10;
  }

  setPriority(client: string, priority: number) {
    const p = Math.max(0, Math.min(1000, Math.floor(priority)));
    this.priorities[client.toLowerCase()] = p;
    this.sortQueue();
    this.emitPositions();
    return { client: client.toLowerCase(), priority: p, priorities: { ...this.priorities } };
  }

  private sortQueue() {
    this.queue.sort((a, b) => b.priority - a.priority || a.requestedAt.localeCompare(b.requestedAt));
  }

  private get primaryLease(): Lease | null {
    const exclusive = this.leases.find((l) => l.exclusive);
    if (exclusive) return exclusive;
    if (this.leases.length === 0) return null;
    return [...this.leases].sort(
      (a, b) => b.priority - a.priority || a.acquiredAt.localeCompare(b.acquiredAt),
    )[0];
  }

  private reservations(): Reservation[] {
    return this.leases.map((l) => ({
      client: l.client,
      vramMiB: l.vramMiB,
      exclusive: l.exclusive,
      leaseId: l.id,
    }));
  }

  private reservedMiB(exceptClient?: string) {
    return this.leases
      .filter((l) => !exceptClient || l.client !== exceptClient)
      .reduce((sum, l) => sum + l.vramMiB, 0);
  }

  private gpuSnapshot() {
    const gpu = this.lastSmi.gpus[0];
    const rawTotal = gpu?.memoryTotalMiB ?? 0;
    const total = rawTotal > 0 ? rawTotal : STUB_TOTAL_MIB;
    const used = gpu?.memoryUsedMiB ?? 0;
    const smiFree = rawTotal > 0 ? (gpu?.memoryFreeMiB ?? 0) : Math.max(0, total - this.reservedMiB());
    return { gpu, total, used, smiFree, stub: this.lastSmi.stub || rawTotal <= 0 };
  }

  private freeForQueueMiB(exceptClient?: string) {
    const { total, smiFree } = this.gpuSnapshot();
    const reservedOthers = this.reservedMiB(exceptClient);
    const budget = Math.max(0, total - reservedOthers);
    return Math.max(0, Math.min(smiFree, budget));
  }

  private resourcesSync(): GpuResources {
    const { used } = this.gpuSnapshot();
    return {
      used,
      reserved: this.reservedMiB(),
      free: this.freeForQueueMiB(),
    };
  }

  private isExclusiveRequest(client: string, priority: number, exclusive?: boolean) {
    if (exclusive === true) return true;
    if (exclusive === false && priority < 100) return false;
    return priority >= 100 || client.toLowerCase() === "popcorn";
  }

  private resolveVram(requested: number | undefined, exclusive: boolean, available: number, total: number) {
    if (exclusive) return total;
    if (requested != null && Number.isFinite(requested) && requested > 0) {
      return Math.floor(requested);
    }
    if (available > 0 && available < DEFAULT_SHARED_VRAM_MIB) return available;
    return DEFAULT_SHARED_VRAM_MIB;
  }

  private positionOf(client: string) {
    const idx = this.queue.findIndex((q) => q.client === client);
    return idx >= 0 ? idx + 1 : 0;
  }

  private emitPositions() {
    this.queue.forEach((item, i) => {
      this.emitGpu("position", { client: item.client, position: i + 1 });
    });
  }

  private snapshotResult(extra: Partial<AcquireResult> = {}): AcquireResult {
    return {
      granted: extra.granted ?? false,
      reason: extra.reason ?? "",
      lease: extra.lease ?? this.primaryLease,
      leases: [...this.leases],
      reservations: this.reservations(),
      reservedMiB: this.reservedMiB(),
      freeForQueueMiB: this.freeForQueueMiB(),
      queue: [...this.queue],
      position: extra.position,
      preempted: extra.preempted,
      preemptedList: extra.preemptedList,
      released: extra.released,
      previous: extra.previous,
      previousList: extra.previousList,
    };
  }

  private async ensureSmi() {
    const now = Date.now();
    if (now - this.lastSmiAt < SMI_CACHE_MS && this.lastSmiAt > 0) return;
    this.lastSmi = await queryNvidiaSmi();
    this.lastSmiAt = Date.now();
  }

  private expireIfNeeded() {
    const now = Date.now();
    const expired = this.leases.filter((l) => l.expiresAt && Date.parse(l.expiresAt) <= now);
    if (expired.length === 0) return;
    const expiredIds = new Set(expired.map((l) => l.id));
    this.leases = this.leases.filter((l) => !expiredIds.has(l.id));
    for (const previous of expired) {
      this.emitGpu("released", { client: previous.client, previous, reason: "expired" });
    }
    this.promoteQueue();
  }

  private enqueue(item: Omit<QueueItem, "id" | "requestedAt"> & { requestedAt?: string }) {
    const existing = this.queue.find((q) => q.client === item.client);
    if (existing) {
      existing.priority = Math.max(existing.priority, item.priority);
      existing.vramMiB = item.vramMiB;
      existing.exclusive = item.exclusive;
      if (item.ttlSeconds != null) existing.ttlSeconds = item.ttlSeconds;
      this.sortQueue();
      return existing;
    }
    const queued: QueueItem = {
      id: randomUUID(),
      client: item.client,
      priority: item.priority,
      requestedAt: item.requestedAt || nowIso(),
      vramMiB: item.vramMiB,
      exclusive: item.exclusive,
      ttlSeconds: item.ttlSeconds,
    };
    this.queue.push(queued);
    this.sortQueue();
    return queued;
  }

  private grantLease(opts: {
    client: string;
    priority: number;
    vramMiB: number;
    exclusive: boolean;
    ttlSeconds?: number;
    preemptedFrom?: string | null;
  }): Lease {
    const expiresAt =
      opts.ttlSeconds && opts.ttlSeconds > 0
        ? new Date(Date.now() + opts.ttlSeconds * 1000).toISOString()
        : null;
    const lease: Lease = {
      id: randomUUID(),
      client: opts.client,
      priority: opts.priority,
      acquiredAt: nowIso(),
      expiresAt,
      preemptedFrom: opts.preemptedFrom ?? null,
      vramMiB: opts.vramMiB,
      exclusive: opts.exclusive,
    };
    this.leases.push(lease);
    return lease;
  }

  private canGrant(item: { exclusive: boolean; vramMiB: number; client: string; priority: number }) {
    if (item.exclusive) {
      if (this.leases.length === 0) return true;
      return this.leases.every((l) => l.priority < item.priority);
    }
    if (this.leases.some((l) => l.exclusive && l.priority >= item.priority)) return false;
    const exclusiveBlocker = this.leases.find((l) => l.exclusive);
    if (exclusiveBlocker && exclusiveBlocker.priority >= item.priority) return false;
    return this.freeForQueueMiB(item.client) >= item.vramMiB || this.canPreemptForVram(item);
  }

  private canPreemptForVram(item: { vramMiB: number; client: string; priority: number }) {
    let free = this.freeForQueueMiB(item.client);
    if (free >= item.vramMiB) return true;
    const victims = this.leases
      .filter((l) => l.client !== item.client && l.priority < item.priority)
      .sort((a, b) => a.priority - b.priority || b.vramMiB - a.vramMiB);
    for (const v of victims) {
      free += v.vramMiB;
      if (free >= item.vramMiB) return true;
    }
    if (this.leases.some((l) => l.exclusive && l.priority < item.priority)) return true;
    return false;
  }

  private preemptHolders(opts: {
    requester: string;
    priority: number;
    neededMiB: number;
    exclusive: boolean;
  }): Lease[] {
    const victims: Lease[] = [];
    if (opts.exclusive) {
      for (const l of [...this.leases]) {
        if (l.client === opts.requester) continue;
        if (l.priority < opts.priority) victims.push(l);
      }
    } else {
      let free = this.freeForQueueMiB(opts.requester);
      const candidates = this.leases
        .filter((l) => l.client !== opts.requester && l.priority < opts.priority)
        .sort((a, b) => a.priority - b.priority || b.vramMiB - a.vramMiB);
      for (const l of this.leases) {
        if (l.exclusive && l.client !== opts.requester && l.priority < opts.priority) {
          if (!victims.includes(l)) victims.push(l);
        }
      }
      if (free < opts.neededMiB) {
        for (const v of candidates) {
          if (victims.includes(v)) continue;
          victims.push(v);
          free += v.vramMiB;
          if (free >= opts.neededMiB) break;
        }
      }
    }
    const victimIds = new Set(victims.map((v) => v.id));
    this.leases = this.leases.filter((l) => !victimIds.has(l.id));
    for (const previous of victims) {
      this.enqueue({
        client: previous.client,
        priority: previous.priority,
        vramMiB: previous.vramMiB,
        exclusive: previous.exclusive,
      });
      this.emitGpu("preempted", {
        client: opts.requester,
        from: previous.client,
        lease: null,
        previous,
      });
      this.emitGpu("queued", {
        client: previous.client,
        position: this.positionOf(previous.client),
        holder: opts.requester,
        vramNeeded: previous.vramMiB,
        vramFree: this.freeForQueueMiB(),
      });
    }
    return victims;
  }

  private promoteQueue() {
    if (this.queue.length === 0) return;
    let progressed = true;
    while (progressed && this.queue.length > 0) {
      progressed = false;
      for (let i = 0; i < this.queue.length; i++) {
        const next = this.queue[i];
        if (!this.canGrant(next)) continue;
        const victims = this.preemptHolders({
          requester: next.client,
          priority: next.priority,
          neededMiB: next.vramMiB,
          exclusive: next.exclusive,
        });
        this.queue.splice(i, 1);
        const lease = this.grantLease({
          client: next.client,
          priority: next.priority,
          vramMiB: next.exclusive ? this.gpuSnapshot().total : next.vramMiB,
          exclusive: next.exclusive,
          ttlSeconds: next.ttlSeconds,
          preemptedFrom: victims[0]?.client ?? null,
        });
        this.emitGpu("granted", {
          client: next.client,
          lease,
          reason: victims.length ? "preempted" : "acquired",
        });
        progressed = true;
        break;
      }
    }
    this.emitPositions();
  }

  async acquire(client: string, ttlSeconds?: number, opts: AcquireOptions = {}) {
    await this.ensureSmi();
    this.expireIfNeeded();
    const key = client.trim() || "unknown";
    const priority = this.getPriority(key);
    const exclusive = this.isExclusiveRequest(key, priority, opts.exclusive);
    const { total } = this.gpuSnapshot();
    const available = this.freeForQueueMiB(key);
    const vramMiB = this.resolveVram(opts.vramMiB, exclusive, available, total);

    const existing = this.leases.find((l) => l.client === key);
    if (existing) {
      if (ttlSeconds && ttlSeconds > 0) {
        existing.expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      }
      return this.snapshotResult({
        granted: true,
        reason: "already_held",
        lease: existing,
      });
    }

    const tryGrant = () => {
      const needPreempt =
        exclusive
          ? this.leases.length > 0
          : this.leases.some((l) => l.exclusive) || this.freeForQueueMiB(key) < vramMiB;
      const victims = needPreempt
        ? this.preemptHolders({
            requester: key,
            priority,
            neededMiB: vramMiB,
            exclusive,
          })
        : [];
      if (exclusive && this.leases.length > 0) return null;
      if (!exclusive && (this.leases.some((l) => l.exclusive) || this.freeForQueueMiB(key) < vramMiB)) {
        return null;
      }
      const lease = this.grantLease({
        client: key,
        priority,
        vramMiB: exclusive ? total : vramMiB,
        exclusive,
        ttlSeconds,
        preemptedFrom: victims[0]?.client ?? null,
      });
      const reason = victims.length ? "preempted" : "acquired";
      this.emitGpu("granted", { client: key, lease, reason });
      this.emitPositions();
      return this.snapshotResult({
        granted: true,
        reason,
        lease,
        preempted: victims[0] ?? undefined,
        preemptedList: victims,
      });
    };

    if (this.canGrant({ exclusive, vramMiB, client: key, priority })) {
      const granted = tryGrant();
      if (granted) return granted;
    }

    const queued = this.enqueue({
      client: key,
      priority,
      vramMiB,
      exclusive,
      ttlSeconds,
    });
    const position = this.positionOf(key);
    this.emitGpu("queued", {
      client: key,
      position,
      holder: this.primaryLease?.client ?? null,
      vramNeeded: queued.vramMiB,
      vramFree: this.freeForQueueMiB(),
    });
    this.emitPositions();
    return this.snapshotResult({
      granted: false,
      reason: "queued",
      position,
    });
  }

  async waitForGrant(client: string, timeoutMs = DEFAULT_WAIT_MS, opts: AcquireOptions & { ttlSeconds?: number } = {}): Promise<AcquireResult> {
    const key = client.trim() || "unknown";
    const held = this.leases.find((l) => l.client === key);
    if (held) {
      return this.snapshotResult({ granted: true, reason: "already_held", lease: held });
    }

    const result = await this.acquire(key, opts.ttlSeconds, opts);
    if (result.granted) return result;

    return new Promise<AcquireResult>((resolve) => {
      const finish = (payload: AcquireResult) => {
        cleanup();
        resolve(payload);
      };
      const onGranted = (payload: GpuEventPayload) => {
        if (payload.client === key) {
          finish(
            this.snapshotResult({
              granted: true,
              reason: (payload.reason as string) || "acquired",
              lease: (payload.lease as Lease) ?? this.primaryLease,
            }),
          );
        }
      };
      const timer = setTimeout(() => {
        finish(this.snapshotResult({ granted: false, reason: "timeout" }));
      }, Math.max(0, timeoutMs || DEFAULT_WAIT_MS));
      const cleanup = () => {
        this.bus.off("granted", onGranted);
        clearTimeout(timer);
      };
      this.bus.on("granted", onGranted);
      const now = this.leases.find((l) => l.client === key);
      if (now) {
        finish(this.snapshotResult({ granted: true, reason: "acquired", lease: now }));
      }
    });
  }

  async release(opts: { leaseId?: string; client?: string }) {
    await this.ensureSmi();
    this.expireIfNeeded();
    if (this.leases.length === 0) {
      return this.snapshotResult({ released: false, reason: "idle", previous: null });
    }

    let targets: Lease[];
    if (opts.leaseId || opts.client) {
      targets = this.leases.filter((l) => {
        const matchLease = Boolean(opts.leaseId && l.id === opts.leaseId);
        const matchClient = Boolean(opts.client && l.client === opts.client);
        return matchLease || matchClient;
      });
      if (targets.length === 0) {
        return this.snapshotResult({ released: false, reason: "not_holder" });
      }
    } else {
      targets = [...this.leases];
    }

    const targetIds = new Set(targets.map((t) => t.id));
    this.leases = this.leases.filter((l) => !targetIds.has(l.id));
    if (opts.client) {
      this.queue = this.queue.filter((q) => q.client !== opts.client);
    }
    for (const previous of targets) {
      this.emitGpu("released", { client: previous.client, previous, reason: "released" });
    }
    this.promoteQueue();
    return this.snapshotResult({
      released: true,
      reason: "released",
      previous: targets[0],
      previousList: targets,
    });
  }

  queueList() {
    this.expireIfNeeded();
    return {
      lease: this.primaryLease,
      leases: [...this.leases],
      reservations: this.reservations(),
      reservedMiB: this.reservedMiB(),
      freeForQueueMiB: this.freeForQueueMiB(),
      queue: [...this.queue],
      priorities: { ...this.priorities },
    };
  }

  async status() {
    await this.ensureSmi();
    this.expireIfNeeded();
    const smi = this.lastSmi;
    const gpu = smi.gpus[0];
    const hasExclusive = this.leases.some((l) => l.exclusive);
    return {
      ...smi,
      exclusive: hasExclusive || this.leases.length <= 1,
      lease: this.primaryLease,
      leases: [...this.leases],
      reservations: this.reservations(),
      reservedMiB: this.reservedMiB(),
      memoryTotalMiB: gpu?.memoryTotalMiB ?? 0,
      memoryUsedMiB: gpu?.memoryUsedMiB ?? 0,
      freeForQueueMiB: this.freeForQueueMiB(),
      queue: [...this.queue],
      priorities: { ...this.priorities },
      model: hasExclusive ? "exclusive-lease" : "shared-reservations",
      notes:
        "Popcorn (100) ou exclusive=true prend toute la carte. Sinon reservations partagees (defaut 2048 MiB, ou le reste libre). nvidia-smi est stub si absent.",
    };
  }
}

export const gpuArbiter = new GpuArbiter();
export const DEFAULT_GPU_WAIT_MS = DEFAULT_WAIT_MS;
