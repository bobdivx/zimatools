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
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 0,
        cutout: "74%",
        animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      },
    });
    return () => chart.destroy();
  }, [ok]);
  return (
    <div class="flex flex-wrap items-center gap-3 min-w-0">
      <div class="relative w-14 h-14 chart-box">
        <canvas ref={ref} />
      </div>
      <div class="min-w-0">
        <div class="text-sm font-semibold">{label}</div>
        <div class={`text-xs ${ok ? "text-success" : "text-error"}`}>{ok ? "up" : "down"}</div>
      </div>
    </div>
  );
}

function CopyButton({ text, label = "Copier" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button type="button" class="btn btn-primary btn-sm" onClick={onCopy}>
      {copied ? "Copie" : label}
    </button>
  );
}

export default function McpPanel() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

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
  const mcpUrl =
    data?.mcp?.url?.replace("127.0.0.1", host) ||
    (typeof window !== "undefined" ? `${window.location.origin}/mcp` : `http://${host}/mcp`);
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
          args: ["<path>/apps/mcp/dist/index.js", "--stdio"],
          env: {
            ZIMAOS_API_BASE: `http://${host}`,
            ZIMAOS_API_TOKEN: "...",
          },
        },
      },
    },
    null,
    2,
  );

  const restOk = data?.rest?.reachable !== false && !!data?.ok && !error;
  const mcpOk = Boolean(data?.mcp?.reachable);
  const categories = data?.categories || [];

  return (
    <div class="space-y-6">
      {error && <div class="alert alert-warning">API injoignable ({error}).</div>}

      <div class="zima-card">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="zima-kicker">Statut live</div>
            <h2 class="text-xl font-semibold mt-1">Serveur MCP ZimaTools</h2>
            <p class="text-sm opacity-60 mt-1">
              version {data?.version || "—"} · transport {data?.mcp?.transport || "http-stream"}
            </p>
          </div>
          <CopyButton text={mcpUrl} label="Copier l'URL MCP" />
        </div>
        <div class="mt-5 grid gap-4 min-w-0 md:grid-cols-2">
          <HealthDonut ok={restOk} label="REST /health" />
          <HealthDonut ok={mcpOk} label="HTTP stream /mcp" />
        </div>
        <p class="mt-4 font-mono text-sm text-secondary break-all">{mcpUrl}</p>
        <p class="text-xs opacity-50 mt-2">
          Navigateur = cette page d'aide. Clients MCP (Cursor, agents) = meme URL, protocole Streamable HTTP.
        </p>
      </div>

      <div class="zima-card">
        <div class="zima-kicker">Configuration</div>
        <h2 class="text-xl font-semibold mt-1">Cursor / DevForge / agents</h2>
        <ol class="mt-4 space-y-3 text-sm opacity-90 list-decimal list-inside">
          <li>
            Ouvre les reglages MCP de ton client (Cursor : <span class="font-mono text-xs">mcp.json</span>).
          </li>
          <li>Ajoute le serveur HTTP ci-dessous (pas stdio, sauf usage local sans NAS).</li>
          <li>
            Redemarre le client MCP / Cursor, puis verifie que les outils{" "}
            <span class="font-mono text-xs">gpu.*</span> et ZimaOS apparaissent.
          </li>
        </ol>
        <div class="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p class="text-sm opacity-60">Colle ceci dans mcp.json :</p>
          <CopyButton text={httpConfig} label="Copier le JSON" />
        </div>
        <pre class="code-block mt-2">{httpConfig}</pre>
        <p class="text-xs opacity-50 mt-3">
          Health check REST (optionnel) :{" "}
          <span class="font-mono text-secondary">
            {typeof window !== "undefined" ? `${window.location.origin}/health` : `http://${host}/health`}
          </span>
        </p>
      </div>

      <div class="grid gap-4 min-w-0 lg:grid-cols-2">
        <div class="zima-card">
          <div class="zima-kicker">Astuce</div>
          <h3 class="font-semibold mt-1">Meme URL pour tout</h3>
          <p class="text-sm opacity-60 mt-2">
            Sur ZimaOS, un seul port public sert l'UI, l'API et le MCP. Les agents doivent pointer vers{" "}
            <span class="font-mono text-xs break-all">{mcpUrl}</span> — pas vers :8765.
          </p>
        </div>
        <div class="zima-card">
          <div class="zima-kicker">Cursor local</div>
          <div class="flex flex-wrap items-center justify-between gap-2 mt-1">
            <h3 class="font-semibold">Variante stdio</h3>
            <CopyButton text={stdioConfig} label="Copier" />
          </div>
          <p class="text-sm opacity-60 mt-1 mb-3">Sans NAS : process Node local.</p>
          <pre class="code-block">{stdioConfig}</pre>
        </div>
      </div>

      <div class="grid gap-4 min-w-0 lg:grid-cols-3">
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
