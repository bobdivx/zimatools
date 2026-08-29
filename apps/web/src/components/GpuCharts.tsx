import { useEffect, useRef, useState } from "preact/hooks";
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
  reserved?: number;
  total: number;
  util: number | null;
  temp: number | null;
}

const ice = "#3b82f6";
const ice2 = "#4da3ff";
const reservedColor = "#f59e0b";
const muted = "rgba(154, 163, 178, 0.35)";
const text = "#9aa3b2";

function useMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const apply = () => setMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      mq.removeEventListener("change", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);
  return mobile;
}

function labelsOf(samples: GpuSample[], mobile: boolean) {
  return samples.map((s) => {
    const d = new Date(s.t);
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    if (mobile) return `${mm}:${ss}`;
    return `${String(d.getHours()).padStart(2, "0")}:${mm}:${ss}`;
  });
}

const grid = { color: "rgba(255,255,255,0.04)" };

function tickFont(mobile: boolean) {
  return { color: text, font: { size: mobile ? 9 : 10 }, maxRotation: 0, autoSkip: true };
}

function chartBase() {
  return { responsive: true as const, maintainAspectRatio: false as const, resizeDelay: 0, animation: false as const };
}

function lineLegend(mobile: boolean, compact: boolean) {
  return {
    display: !compact,
    position: (mobile ? "bottom" : "top") as "bottom" | "top",
    labels: { color: text, boxWidth: mobile ? 8 : 10, font: { size: mobile ? 9 : 11 } },
  };
}

function xScale(mobile: boolean, compact: boolean) {
  return {
    display: !compact,
    grid,
    ticks: { ...tickFont(mobile), maxTicksLimit: mobile ? 4 : 8 },
  };
}

interface Props {
  samples: GpuSample[];
  compact?: boolean;
}

export default function GpuCharts({ samples, compact }: Props) {
  const mobile = useMobile();
  const vramRef = useRef<HTMLCanvasElement>(null);
  const utilRef = useRef<HTMLCanvasElement>(null);
  const tempRef = useRef<HTMLCanvasElement>(null);
  const donutRef = useRef<HTMLCanvasElement>(null);
  const charts = useRef<Chart[]>([]);

  useEffect(() => {
    charts.current.forEach((c) => c.destroy());
    charts.current = [];
    const last = samples[samples.length - 1];
    const labels = labelsOf(samples, mobile);
    const ticks = tickFont(mobile);

    if (donutRef.current && last) {
      const used = last.used;
      const reserved = last.reserved || 0;
      const free = Math.max(0, last.total - Math.max(used, reserved));
      charts.current.push(
        new Chart(donutRef.current, {
          type: "doughnut",
          data: {
            labels: ["VRAM utilisee", "VRAM reservee", "Libre"],
            datasets: [
              {
                data: [used, Math.max(0, reserved - used), free || 1],
                backgroundColor: [ice, reservedColor, muted],
                borderWidth: 0,
              },
            ],
          },
          options: {
            ...chartBase(),
            cutout: "72%",
            plugins: { legend: { display: false }, tooltip: { enabled: true } },
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
                label: "VRAM reservee (MiB)",
                data: samples.map((s) => s.reserved ?? 0),
                borderColor: reservedColor,
                backgroundColor: "rgba(245,158,11,0.10)",
                fill: false,
                tension: 0.3,
                pointRadius: 0,
                borderWidth: 1.5,
                borderDash: [6, 3],
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
            ...chartBase(),
            plugins: { legend: lineLegend(mobile, !!compact) },
            scales: {
              x: xScale(mobile, !!compact),
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
            ...chartBase(),
            plugins: { legend: { display: false } },
            scales: {
              x: xScale(mobile, !!compact),
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
            ...chartBase(),
            plugins: { legend: { display: false } },
            scales: {
              x: xScale(mobile, !!compact),
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
  }, [samples, compact, mobile]);

  const last = samples[samples.length - 1];
  const pct = last && last.total > 0 ? Math.round((last.used / last.total) * 100) : 0;

  if (compact) {
    return (
      <div class="grid grid-cols-1 gap-3 min-w-0 md:grid-cols-[140px_1fr]">
        <div class="relative chart-box mx-auto w-full max-w-[160px] h-40 md:max-w-none md:mx-0 md:h-36">
          <canvas ref={donutRef} />
          <div class="absolute inset-0 grid place-items-center pointer-events-none">
            <div class="text-center">
              <div class="text-lg font-semibold">{pct}%</div>
              <div class="text-[10px] opacity-50">VRAM</div>
            </div>
          </div>
        </div>
        <div class="h-36 chart-box">
          <canvas ref={vramRef} />
        </div>
      </div>
    );
  }

  return (
    <div class="grid gap-4 min-w-0 lg:grid-cols-3">
      <div class="zima-card lg:col-span-2 min-w-0">
        <div class="zima-kicker mb-2">Historique VRAM</div>
        <div class="h-48 chart-box">
          <canvas ref={vramRef} />
        </div>
      </div>
      <div class="zima-card min-w-0">
        <div class="zima-kicker mb-2">Occupation actuelle</div>
        <div class="relative h-40 chart-box">
          <canvas ref={donutRef} />
          <div class="absolute inset-0 grid place-items-center pointer-events-none">
            <div class="text-center">
              <div class="text-xl font-semibold">{pct}%</div>
              <div class="text-xs opacity-50">{last?.used ?? 0} MiB</div>
            </div>
          </div>
        </div>
      </div>
      <div class="zima-card min-w-0">
        <div class="zima-kicker mb-2">Utilisation GPU</div>
        <div class="h-36 chart-box">
          <canvas ref={utilRef} />
        </div>
      </div>
      <div class="zima-card min-w-0">
        <div class="zima-kicker mb-2">Temperature</div>
        <div class="h-36 chart-box">
          <canvas ref={tempRef} />
        </div>
      </div>
    </div>
  );
}
