import { useEffect, useRef, useState } from "preact/hooks";
import { jsonFetch, publicHost } from "../lib/api";
import { ArcElement, Chart, DoughnutController, Tooltip } from "chart.js";

Chart.register(DoughnutController, ArcElement, Tooltip);

function HealthDonut({ ok, label }: { ok: boolean; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = new Chart(ref.current, {
      type: "doughnut",
      data: {
        labels: [ok ? "up" : "down"],
        datasets: [
          {
            data: [ok ? 1 : 0.0001, ok ? 0.0001 : 1],
            backgroundColor: [ok ? "#22c55e" : "#ef4444", "rgba(255,255,255,0.06)"],
            borderWidth: 0,
          },
        ],
      },
      options: {
        cutout: "74%",
        animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      },
    });
    return () => chart.destroy();
  }, [ok]);
  return (
    <div class="flex items-center gap-3">
      <div class="relative w-14 h-14">
        <canvas ref={ref} />
      </div>
      <div>
        <div class="text-sm font-semibold">{label}</div>
        <div class={`text-xs ${ok ? "text-success" : "text-error"}`}>{ok ? "up" : "down"}</div>
      </div>
    </div>
  );
}

export default function McpPanel() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    try {
      setError(null);
      setData(await jsonFetch("/api/mcp"));
    } catch (e: any) {
      setError(e.message || String(e));
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  const host = publicHost();
  const mcpUrl = data?.mcp?.url?.replace("127.0.0.1", host) || `http://${host}:8765/mcp`;
  const httpConfig = JSON.stringify(
    { mcpServers: { zimatools: { url: mcpUrl } } },
    null,
    2,
  );
  const stdioConfig = JSON.stringify(
    {
      mcpServers: {
        zimatools: {
          command: "node",
          args: ["<chemin>/apps/mcp/dist/index.js", "--stdio"],
        },
      },
    },
    null,
    2,
  );

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  const restOk = data?.rest?.reachable !== false && !!data?.ok && !error;
  const mcpOk = Boolean(data?.mcp?.reachable);
  const categories = data?.categories || [];

  return (
    <div class="space-y-6">
      {error && <div class="alert alert-warning">API injoignable ({error}).</div>}

      <div class="zima-card">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div class="zima-kicker">Statut live</div>
            <h2 class="text-xl font-semibold mt-1">Serveur MCP ZimaTools</h2>
            <p class="text-sm opacity-60 mt-1">
              version {data?.version || "—"} · transport {data?.mcp?.transport || "http-stream"}
            </p>
          </div>
          <button class="btn btn-primary btn-sm" onClick={copyUrl}>
            {copied ? "URL copiee" : "Copier l'URL MCP"}
          </button>
        </div>
        <div class="mt-5 grid gap-4 md:grid-cols-2">
          <HealthDonut ok={restOk} label={`REST :${data?.rest?.port || 8766}/health`} />
          <HealthDonut ok={mcpOk} label={`HTTP stream :${data?.mcp?.port || 8765}/mcp`} />
        </div>
        <p class="mt-4 font-mono text-sm text-secondary break-all">{mcpUrl}</p>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <div class="zima-card">
          <div class="zima-kicker">Cursor / DevForge</div>
          <h3 class="font-semibold mt-1">Config HTTP (a coller)</h3>
          <p class="text-sm opacity-60 mt-1 mb-3">mcp.json — transport Streamable HTTP vers le NAS.</p>
          <pre class="code-block">{httpConfig}</pre>
        </div>
        <div class="zima-card">
          <div class="zima-kicker">Cursor local</div>
          <h3 class="font-semibold mt-1">Variante stdio</h3>
          <p class="text-sm opacity-60 mt-1 mb-3">Sans NAS : process Node local, meme outils GPU / fichiers.</p>
          <pre class="code-block">{stdioConfig}</pre>
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-3">
        {categories.map((cat: any) => (
          <section class="zima-card" key={cat.id}>
            <div class="zima-kicker">{cat.id}</div>
            <h3 class="text-lg font-semibold mt-1">{cat.title}</h3>
            <p class="text-sm opacity-60 mt-1 mb-2">{cat.description}</p>
            <div>
              {(cat.tools || []).map((tool: any) => (
                <div class={`tool-row ${tool.enabled === false ? "disabled" : ""}`} key={tool.name}>
                  <div class="min-w-0">
                    <div class="font-mono text-xs text-secondary">{tool.name}</div>
                    <div class="text-sm mt-0.5">{tool.summary}</div>
                    {tool.enabled === false && (
                      <div class="text-[11px] opacity-50 mt-0.5">non charge dans le serveur</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
