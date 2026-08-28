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
}

export default function GpuWidget({ gpu, stub }: Props) {
  const total = gpu.memoryTotalMiB || 0;
  const used = gpu.memoryUsedMiB || 0;
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div class="zima-card">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="zima-kicker">GPU</div>
          <h3 class="text-lg font-semibold mt-1">{gpu.name}</h3>
        </div>
        {stub ? (
          <span class="zima-pill zima-pill-hold">stub</span>
        ) : (
          <span class="zima-pill zima-pill-gpu">nvidia-smi</span>
        )}
      </div>
      <div class="mt-4 flex items-end justify-between text-sm">
        <span class="opacity-80">
          {used} / {total} MiB
        </span>
        <span class="opacity-60">{pct}%</span>
      </div>
      <div class="vram-track mt-2">
        <div class="vram-fill" style={{ width: `${pct}%` }} />
      </div>
      <div class="mt-3 flex gap-4 text-sm opacity-70">
        <span>Temp. {gpu.temperatureC ?? "—"} °C</span>
        <span>Util. {gpu.utilizationPercent ?? "—"} %</span>
        <span>Libre {gpu.memoryFreeMiB} MiB</span>
      </div>
    </div>
  );
}
