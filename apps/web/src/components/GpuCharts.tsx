import { useEffect, useRef } from "preact/hooks";
import {
  ArcElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  DoughnutController,
  ArcElement,
  Tooltip,
  Legend,
);

export interface GpuSample {
  t: number;
  used: number;
  total: number;
  util: number | null;
  temp: number | null;
}

const ice = "#3b82f6";
const ice2 = "#4da3ff";
const muted = "rgba(154, 163, 178, 0.35)";
const text = "#9aa3b2";

function labelsOf(samples: GpuSample[]) {
  return samples.map((s) => {
    const d = new Date(s.t);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  });
}

const grid = { color: "rgba(255,255,255,0.04)" };
const ticks = { color: text, font: { size: 10 } };

interface Props {
  samples: GpuSample[];
  compact?: boolean;
}

export default function GpuCharts({ samples, compact }: Props) {
  const vramRef = useRef<HTMLCanvasElement>(null);
  const utilRef = useRef<HTMLCanvasElement>(null);
  const tempRef = useRef<HTMLCanvasElement>(null);
  const donutRef = useRef<HTMLCanvasElement>(null);
  const charts = useRef<Chart[]>([]);

  useEffect(() => {
    charts.current.forEach((c) => c.destroy());
    charts.current = [];
    const last = samples[samples.length - 1];
    const labels = labelsOf(samples);

    if (donutRef.current && last) {
      const used = last.used;
      const free = Math.max(0, last.total - last.used);
      charts.current.push(
        new Chart(donutRef.current, {
          type: "doughnut",
          data: {
            labels: ["VRAM utilisee", "Libre"],
            datasets: [{ data: [used, free || 1], backgroundColor: [ice, muted], borderWidth: 0 }],
          },
          options: {
            cutout: "72%",
            plugins: { legend: { display: false }, tooltip: { enabled: true } },
            animation: false,
          },
        }),
      );
    }

    if (vramRef.current) {
      charts.current.push(
        new Chart(vramRef.current, {
          type: "line",
          data: {
            labels,
            datasets: [
              {
                label: "VRAM utilisee (MiB)",
                data: samples.map((s) => s.used),
                borderColor: ice,
                backgroundColor: "rgba(59,130,246,0.18)",
                fill: true,
                tension: 0.35,
                pointRadius: 0,
                borderWidth: 2,
              },
              {
                label: "VRAM totale (MiB)",
                data: samples.map((s) => s.total),
                borderColor: ice2,
                borderDash: [4, 4],
                fill: false,
                tension: 0.2,
                pointRadius: 0,
                borderWidth: 1.5,
              },
            ],
          },
          options: {
            animation: false,
            plugins: { legend: { display: !compact, labels: { color: text, boxWidth: 10 } } },
            scales: {
              x: { display: !compact, grid, ticks },
              y: { display: true, grid, ticks, beginAtZero: true },
            },
          },
        }),
      );
    }

    if (utilRef.current) {
      charts.current.push(
        new Chart(utilRef.current, {
          type: "line",
          data: {
            labels,
            datasets: [
              {
                label: "Utilisation %",
                data: samples.map((s) => s.util ?? 0),
                borderColor: ice2,
                backgroundColor: "rgba(77,163,255,0.16)",
                fill: true,
                tension: 0.35,
                pointRadius: 0,
                borderWidth: 2,
              },
            ],
          },
          options: {
            animation: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { display: !compact, grid, ticks },
              y: { min: 0, max: 100, grid, ticks },
            },
          },
        }),
      );
    }

    if (tempRef.current) {
      charts.current.push(
        new Chart(tempRef.current, {
          type: "line",
          data: {
            labels,
            datasets: [
              {
                label: "Temperature C",
                data: samples.map((s) => s.temp ?? 0),
                borderColor: "#60a5fa",
                backgroundColor: "rgba(96,165,250,0.14)",
                fill: true,
                tension: 0.35,
                pointRadius: 0,
                borderWidth: 2,
              },
            ],
          },
          options: {
            animation: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { display: !compact, grid, ticks },
              y: { grid, ticks },
            },
          },
        }),
      );
    }

    return () => {
      charts.current.forEach((c) => c.destroy());
      charts.current = [];
    };
  }, [samples, compact]);

  const last = samples[samples.length - 1];
  const pct = last && last.total > 0 ? Math.round((last.used / last.total) * 100) : 0;

  if (compact) {
    return (
      <div class="grid gap-3 md:grid-cols-[140px_1fr]">
        <div class="relative">
          <canvas ref={donutRef} height={140} />
          <div class="absolute inset-0 grid place-items-center pointer-events-none">
            <div class="text-center">
              <div class="text-lg font-semibold">{pct}%</div>
              <div class="text-[10px] opacity-50">VRAM</div>
            </div>
          </div>
        </div>
        <div class="h-36">
          <canvas ref={vramRef} />
        </div>
      </div>
    );
  }

  return (
    <div class="grid gap-4 lg:grid-cols-3">
      <div class="zima-card lg:col-span-2">
        <div class="zima-kicker mb-2">Historique VRAM</div>
        <div class="h-48">
          <canvas ref={vramRef} />
        </div>
      </div>
      <div class="zima-card">
        <div class="zima-kicker mb-2">Occupation actuelle</div>
        <div class="relative h-40">
          <canvas ref={donutRef} />
          <div class="absolute inset-0 grid place-items-center pointer-events-none">
            <div class="text-center">
              <div class="text-xl font-semibold">{pct}%</div>
              <div class="text-xs opacity-50">{last?.used ?? 0} MiB</div>
            </div>
          </div>
        </div>
      </div>
      <div class="zima-card">
        <div class="zima-kicker mb-2">Utilisation GPU</div>
        <div class="h-36">
          <canvas ref={utilRef} />
        </div>
      </div>
      <div class="zima-card">
        <div class="zima-kicker mb-2">Temperature</div>
        <div class="h-36">
          <canvas ref={tempRef} />
        </div>
      </div>
    </div>
  );
}
