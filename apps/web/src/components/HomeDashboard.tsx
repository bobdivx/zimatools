import { useEffect, useState } from "preact/hooks";
import { jsonFetch } from "../lib/api";
import GpuWidget from "./GpuWidget";
import GpuCharts, { type GpuSample } from "./GpuCharts";

const MAX_SAMPLES = 30;

export default function HomeDashboard() {
  const [health, setHealth] = useState<any>(null);
  const [gpu, setGpu] = useState<any>(null);
  const [apps, setApps] = useState<any>(null);
  const [mcp, setMcp] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<GpuSample[]>([]);

  async function refresh() {
    try {
      setError(null);
      const [h, g, a, m] = await Promise.all([
        jsonFetch("/health"),
        jsonFetch("/api/gpu/status"),
        jsonFetch("/api/apps"),
        jsonFetch("/api/mcp").catch(() => null),
      ]);
      setHealth(h);
      setGpu(g);
      setApps(a);
      setMcp(m);
      const card = g?.gpus?.[0];
      if (card) {
        const point: GpuSample = {
          t: Date.now(),
          used: card.memoryUsedMiB || 0,
          total: card.memoryTotalMiB || 0,
          util: card.utilizationPercent,
          temp: card.temperatureC,
        };
        setSamples((prev) => [...prev, point].slice(-MAX_SAMPLES));
      }
    } catch (e: any) {
      setError(e.message || String(e));
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  const running = (apps?.apps || []).filter((x: any) => x.running).length;
  const totalApps = (apps?.apps || []).length;
  const lease = gpu?.lease;
  const card = gpu?.gpus?.[0];
  const mcpUp = mcp?.mcp?.reachable !== false && !!health?.ok;

  return (
    <div class="space-y-6">
      <header>
        <div class="zima-kicker">ZimaTools</div>
        <h1 class="text-3xl font-bold mt-1">Tableau de bord</h1>
        <p class="opacity-60 mt-2 max-w-2xl">
          Console NAS : sante MCP, lease GPU exclusif, applications ZimaOS. Un seul detenteur de VRAM a la fois.
        </p>
      </header>

      {error && <div class="alert alert-warning">API injoignable ({error}).</div>}

      <div class="status-row">
        <div class="zima-card">
          <div class="zima-kicker">MCP</div>
          <p class="text-2xl font-semibold mt-2">{mcpUp ? "En ligne" : "Hors ligne"}</p>
          <p class="text-sm opacity-60 mt-1">
            REST /health {health?.ok ? "OK" : "—"} · stream /mcp{" "}
            {mcp?.mcp?.reachable ? "up" : mcp ? "down" : "…"}
          </p>
        </div>
        <div class="zima-card">
          <div class="zima-kicker">GPU</div>
          <p class="text-2xl font-semibold mt-2">{lease ? `Reserve (${lease.client})` : "Libre"}</p>
          <p class="text-sm opacity-60 mt-1">
            {card ? `${card.memoryUsedMiB} / ${card.memoryTotalMiB} MiB` : "en attente"}
            {gpu?.stub ? " · stub" : ""}
          </p>
        </div>
        <div class="zima-card">
          <div class="zima-kicker">Apps ZimaOS</div>
          <p class="text-2xl font-semibold mt-2">
            {totalApps ? `${running} en cours` : "—"}
          </p>
          <p class="text-sm opacity-60 mt-1">{totalApps} conteneurs · source {apps?.source || "…"}</p>
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        {card && <GpuWidget gpu={card} stub={gpu?.stub} />}
        <div class="zima-card">
          <div class="zima-kicker mb-2">Tendance VRAM</div>
          {samples.length > 0 ? (
            <GpuCharts samples={samples} compact />
          ) : (
            <p class="opacity-60 text-sm">En attente des premiers echantillons…</p>
          )}
        </div>
      </div>

      <div class="grid gap-4 md:grid-cols-3">
        <a href="/gpu" class="zima-card block hover:border-[rgba(77,163,255,0.4)]">
          <div class="zima-kicker">Outil</div>
          <h2 class="text-lg font-semibold mt-1">Console GPU</h2>
          <p class="text-sm opacity-60 mt-2">nvidia-smi live, lease, file, et choix d'une app ZimaOS.</p>
        </a>
        <a href="/apps" class="zima-card block hover:border-[rgba(77,163,255,0.4)]">
          <div class="zima-kicker">Outil</div>
          <h2 class="text-lg font-semibold mt-1">Apps ZimaOS</h2>
          <p class="text-sm opacity-60 mt-2">Tuiles des conteneurs CasaOS / Docker, etat et ports.</p>
        </a>
        <a href="/mcp" class="zima-card block hover:border-[rgba(77,163,255,0.4)]">
          <div class="zima-kicker">Outil</div>
          <h2 class="text-lg font-semibold mt-1">Serveur MCP</h2>
          <p class="text-sm opacity-60 mt-2">Sante HTTP stream, URL a coller, catalogue d'outils.</p>
        </a>
      </div>
    </div>
  );
}
