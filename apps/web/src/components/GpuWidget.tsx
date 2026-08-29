interface Gpu {
  index: number;
  name: string;
  memoryTotalMiB: number;
  memoryUsedMiB: number;
  memoryFreeMiB: number;
  utilizationPercent: number | null;
  temperatureC: number | null;
}

interface Props {
  gpu: Gpu;
  stub?: boolean;
  reservedMiB?: number;
  freeForQueueMiB?: number;
}

export default function GpuWidget({ gpu, stub, reservedMiB = 0, freeForQueueMiB }: Props) {
  const total = gpu.memoryTotalMiB || 0;
  const used = gpu.memoryUsedMiB || 0;
  const reserved = reservedMiB || 0;
  const usedPct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const reservedPct = total > 0 ? Math.min(100, Math.round((reserved / total) * 100)) : 0;
  return (
    <div class="zima-card">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="zima-kicker">GPU</div>
          <h3 class="text-lg font-semibold mt-1">{gpu.name}</h3>
        </div>
        {stub ? (
          <span class="zima-pill zima-pill-hold">stub</span>
        ) : (
          <span class="zima-pill zima-pill-gpu">nvidia-smi</span>
        )}
      </div>
      <div class="mt-4 flex flex-wrap items-end justify-between gap-2 text-sm">
        <span class="opacity-80">
          {used} / {total} MiB reels
        </span>
        <span class="opacity-60">{usedPct}%</span>
      </div>
      <div class="vram-track mt-2">
        <div class="vram-fill" style={{ width: `${usedPct}%` }} />
      </div>
      <div class="mt-3 flex flex-wrap items-end justify-between gap-2 text-sm">
        <span class="opacity-80">{reserved} MiB reserves</span>
        <span class="opacity-60">{reservedPct}%</span>
      </div>
      <div class="vram-track mt-2">
        <div class="vram-fill vram-fill-reserved" style={{ width: `${reservedPct}%` }} />
      </div>
      <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm opacity-70">
        <span>Temp. {gpu.temperatureC ?? "—"} °C</span>
        <span>Util. {gpu.utilizationPercent ?? "—"} %</span>
        <span>Libre smi {gpu.memoryFreeMiB} MiB</span>
        {freeForQueueMiB != null && <span>Libre file {freeForQueueMiB} MiB</span>}
      </div>
    </div>
  );
}
