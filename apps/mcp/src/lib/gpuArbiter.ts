import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

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
}

export interface QueueItem {
  id: string;
  client: string;
  priority: number;
  requestedAt: string;
}

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

class GpuArbiter {
  private lease: Lease | null = null;
  private queue: QueueItem[] = [];
  private priorities: Record<string, number> = { ...DEFAULT_PRIORITIES };

  getPriority(client: string): number {
    const key = client.toLowerCase();
    return this.priorities[key] ?? 10;
  }

  setPriority(client: string, priority: number) {
    const p = Math.max(0, Math.min(1000, Math.floor(priority)));
    this.priorities[client.toLowerCase()] = p;
    this.queue.sort((a, b) => b.priority - a.priority || a.requestedAt.localeCompare(b.requestedAt));
    return { client: client.toLowerCase(), priority: p, priorities: { ...this.priorities } };
  }

  private expireIfNeeded() {
    if (this.lease?.expiresAt && Date.parse(this.lease.expiresAt) <= Date.now()) {
      this.lease = null;
      this.promoteQueue();
    }
  }

  private promoteQueue() {
    if (this.lease || this.queue.length === 0) return;
    const next = this.queue.shift()!;
    this.lease = {
      id: randomUUID(),
      client: next.client,
      priority: next.priority,
      acquiredAt: nowIso(),
      expiresAt: null,
      preemptedFrom: null,
    };
  }

  acquire(client: string, ttlSeconds?: number) {
    this.expireIfNeeded();
    const key = client.trim() || "unknown";
    const priority = this.getPriority(key);
    const expiresAt =
      ttlSeconds && ttlSeconds > 0 ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null;

    if (this.lease && this.lease.client === key) {
      if (expiresAt) this.lease.expiresAt = expiresAt;
      return { granted: true, reason: "already_held", lease: this.lease, queue: this.queue };
    }

    if (!this.lease) {
      this.lease = {
        id: randomUUID(),
        client: key,
        priority,
        acquiredAt: nowIso(),
        expiresAt,
        preemptedFrom: null,
      };
      return { granted: true, reason: "acquired", lease: this.lease, queue: this.queue };
    }

    if (priority > this.lease.priority) {
      const previous = this.lease;
      this.queue.unshift({
        id: randomUUID(),
        client: previous.client,
        priority: previous.priority,
        requestedAt: nowIso(),
      });
      this.lease = {
        id: randomUUID(),
        client: key,
        priority,
        acquiredAt: nowIso(),
        expiresAt,
        preemptedFrom: previous.client,
      };
      return {
        granted: true,
        reason: "preempted",
        lease: this.lease,
        preempted: previous,
        queue: this.queue,
      };
    }

    const existing = this.queue.find((q) => q.client === key);
    if (existing) {
      existing.priority = Math.max(existing.priority, priority);
      this.queue.sort((a, b) => b.priority - a.priority || a.requestedAt.localeCompare(b.requestedAt));
      return { granted: false, reason: "queued", lease: this.lease, queue: this.queue };
    }

    this.queue.push({
      id: randomUUID(),
      client: key,
      priority,
      requestedAt: nowIso(),
    });
    this.queue.sort((a, b) => b.priority - a.priority || a.requestedAt.localeCompare(b.requestedAt));
    return { granted: false, reason: "queued", lease: this.lease, queue: this.queue };
  }

  release(opts: { leaseId?: string; client?: string }) {
    this.expireIfNeeded();
    if (!this.lease) {
      return { released: false, reason: "idle", lease: null, queue: this.queue };
    }
    const matchLease = Boolean(opts.leaseId && this.lease.id === opts.leaseId);
    const matchClient = Boolean(opts.client && this.lease.client === opts.client);
    if ((opts.leaseId || opts.client) && !matchLease && !matchClient) {
      return { released: false, reason: "not_holder", lease: this.lease, queue: this.queue };
    }
    const previous = this.lease;
    this.lease = null;
    if (opts.client) {
      this.queue = this.queue.filter((q) => q.client !== opts.client);
    }
    this.promoteQueue();
    return { released: true, reason: "released", previous, lease: this.lease, queue: this.queue };
  }

  queueList() {
    this.expireIfNeeded();
    return {
      lease: this.lease,
      queue: [...this.queue],
      priorities: { ...this.priorities },
    };
  }

  async status() {
    this.expireIfNeeded();
    const smi = await queryNvidiaSmi();
    return {
      ...smi,
      exclusive: true,
      lease: this.lease,
      queue: [...this.queue],
      priorities: { ...this.priorities },
      model: "exclusive-lease",
      notes:
        "Popcorn (100) preempte Ollama (50) et agents (25). nvidia-smi est stub si absent.",
    };
  }
}

export const gpuArbiter = new GpuArbiter();
