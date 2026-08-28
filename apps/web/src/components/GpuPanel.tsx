import { useEffect, useState } from "preact/hooks";
import { jsonFetch } from "../lib/api";
import AppTile, { type AppInfo } from "./AppTile";
import GpuWidget from "./GpuWidget";
import GpuCharts, { type GpuSample } from "./GpuCharts";

const MAX_SAMPLES = 30;

function holderClient(lease: any): string | null {
  return lease?.client ? String(lease.client) : null;
}

function appHoldsLease(app: AppInfo, client: string | null) {
  if (!client) return false;
  return app.gpuClient === client || app.name === client;
}

export default function GpuPanel() {
  const [data, setData] = useState<any>(null);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [samples, setSamples] = useState<GpuSample[]>([]);
  const [prioClient, setPrioClient] = useState("popcorn");
  const [prio, setPrio] = useState(100);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    try {
      setError(null);
      const [status, listed] = await Promise.all([
        jsonFetch("/api/gpu/status"),
        jsonFetch("/api/apps").catch(() => ({ apps: [] })),
      ]);
      setData(status);
      setApps(listed.apps || []);
      const gpu = status?.gpus?.[0];
      if (gpu) {
        const point: GpuSample = {
          t: Date.now(),
          used: gpu.memoryUsedMiB || 0,
          total: gpu.memoryTotalMiB || 0,
          util: gpu.utilizationPercent,
          temp: gpu.temperatureC,
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

  async function acquireApp(app: AppInfo) {
    setBusy(true);
    setMessage(null);
    try {
      const client = app.gpuClient || app.name;
      if (client !== "popcorn" && client !== "ollama" && client !== "agents") {
        await jsonFetch("/api/gpu/priority", {
          method: "POST",
          body: JSON.stringify({ client, priority: app.gpuPriority || 25 }),
        });
      }
      const res = await jsonFetch("/api/gpu/acquire", {
        method: "POST",
        body: JSON.stringify({ client }),
      });
      setMessage(
        res.granted
          ? `Lease accorde a ${client} (${res.reason})`
          : `En file pour ${client} (${res.reason})`,
      );
      await refresh();
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    setBusy(true);
    setMessage(null);
    try {
      const client = data?.lease?.client;
      await jsonFetch("/api/gpu/release", {
        method: "POST",
        body: JSON.stringify(client ? { client } : {}),
      });
      setMessage("Lease libere");
      await refresh();
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function savePriority() {
    setBusy(true);
    try {
      await jsonFetch("/api/gpu/priority", {
        method: "POST",
        body: JSON.stringify({ client: prioClient, priority: prio }),
      });
      await refresh();
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const gpus = data?.gpus || [];
  const gpu = gpus[0];
  const lease = data?.lease;
  const queue = data?.queue || [];
  const client = holderClient(lease);
  const holderApp = apps.find((a) => appHoldsLease(a, client));
  const gpuApps = apps.filter((a) => a.gpu);
  const otherApps = apps.filter((a) => !a.gpu);
  const picker = [...gpuApps, ...otherApps];

  return (
    <div class="space-y-5">
      {error && (
        <div class="alert alert-warning">
          <span>API injoignable ({error}).</span>
        </div>
      )}
      {message && (
        <div class="alert alert-info text-sm">
          <span>{message}</span>
        </div>
      )}

      {gpu && <GpuWidget gpu={gpu} stub={data?.stub} />}

      {samples.length > 0 && <GpuCharts samples={samples} />}

      <div class="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div class="zima-card">
          <div class="zima-kicker">Lease exclusif</div>
          <h2 class="text-xl font-semibold mt-1">Detenteur actuel</h2>
          {lease ? (
            <div class="mt-3 space-y-1">
              <p class="text-lg font-semibold">{holderApp?.title || lease.client}</p>
              <p class="text-sm opacity-60">
                client {lease.client} · priorite {lease.priority}
                {lease.preemptedFrom ? ` · a preempté ${lease.preemptedFrom}` : ""}
              </p>
              <p class="text-xs opacity-40">depuis {new Date(lease.acquiredAt).toLocaleString("fr-FR")}</p>
            </div>
          ) : (
            <p class="mt-3 opacity-60">Aucun lease — le GPU est libre.</p>
          )}
          <div class="mt-4 flex flex-wrap gap-2">
            <button class="btn btn-primary btn-sm" onClick={release} disabled={busy || !lease}>
              Liberer
            </button>
            <button class="btn btn-ghost btn-sm" onClick={refresh} disabled={busy}>
              Rafraichir
            </button>
          </div>
        </div>

        <div class="zima-card">
          <div class="zima-kicker">File d'attente</div>
          <h2 class="text-xl font-semibold mt-1">Queue</h2>
          {queue.length === 0 ? (
            <p class="mt-3 opacity-60">File vide.</p>
          ) : (
            <ul class="mt-3 space-y-2">
              {queue.map((item: any) => (
                <li class="flex justify-between text-sm" key={item.id}>
                  <span>{item.client}</span>
                  <span class="opacity-60">prio {item.priority}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <section>
        <div class="mb-3">
          <div class="zima-kicker">Applications ZimaOS</div>
          <h2 class="text-xl font-semibold mt-1">Choisir une app pour acquerir le GPU</h2>
          <p class="text-sm opacity-60 mt-1">
            Cliquez une tuile presente sur le NAS. popcorn* → client popcorn (100), ollama → 50, le reste → nom du
            conteneur (25).
          </p>
        </div>
        {picker.length === 0 ? (
          <div class="zima-card opacity-70">Aucune app renvoyee par /api/apps.</div>
        ) : (
          <div class="app-grid">
            {picker.map((app) => (
              <AppTile
                key={app.id}
                app={app}
                selectable
                holder={appHoldsLease(app, client)}
                onSelect={busy ? undefined : acquireApp}
              />
            ))}
          </div>
        )}
      </section>

      <details class="zima-card">
        <summary class="cursor-pointer font-semibold">Avance — priorites de l'arbitre</summary>
        <p class="text-sm opacity-60 mt-2 mb-3">
          Popcorn (100) preempte Ollama (50) et agents (25). Modifier uniquement si vous savez ce que vous faites.
        </p>
        <div class="flex flex-wrap gap-2 items-end">
          <input
            class="input input-bordered input-sm"
            value={prioClient}
            onInput={(e) => setPrioClient(e.currentTarget.value)}
            placeholder="client"
          />
          <input
            class="input input-bordered input-sm w-24"
            type="number"
            value={prio}
            onInput={(e) => setPrio(Number(e.currentTarget.value))}
          />
          <button class="btn btn-sm btn-secondary" onClick={savePriority} disabled={busy}>
            Enregistrer
          </button>
        </div>
      </details>
    </div>
  );
}
