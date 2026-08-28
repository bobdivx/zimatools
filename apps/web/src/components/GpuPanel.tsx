import { useEffect, useState } from "preact/hooks";

function apiBase() {
  const env = import.meta.env.PUBLIC_API_URL;
  if (env) return env.replace(/\/$/, "");
  if (typeof window === "undefined") return "http://127.0.0.1:8766";
  return `${window.location.protocol}//${window.location.hostname}:8766`;
}

async function jsonFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export default function GpuPanel() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState("popcorn");
  const [priorityClient, setPriorityClient] = useState("popcorn");
  const [priority, setPriority] = useState(100);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setError(null);
      setData(await jsonFetch("/api/gpu/status"));
    } catch (e: any) {
      setError(e.message || String(e));
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  async function acquire() {
    setBusy(true);
    try {
      await jsonFetch("/api/gpu/acquire", {
        method: "POST",
        body: JSON.stringify({ client }),
      });
      await refresh();
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    setBusy(true);
    try {
      await jsonFetch("/api/gpu/release", {
        method: "POST",
        body: JSON.stringify({ client }),
      });
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
        body: JSON.stringify({ client: priorityClient, priority }),
      });
      await refresh();
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const gpus = data?.gpus || [];
  const queue = data?.queue || [];
  const lease = data?.lease;

  return (
    <div class="space-y-4">
      {error && (
        <div class="alert alert-warning">
          <span>API injoignable ({error}). Lancez <code>pnpm dev:mcp</code> puis reessayez.</span>
        </div>
      )}

      <div class="grid gap-4 lg:grid-cols-2">
        <div class="card bg-base-100 shadow">
          <div class="card-body">
            <h2 class="card-title">Statut</h2>
            {data?.stub && <div class="badge badge-warning">nvidia-smi stub</div>}
            {gpus.map((gpu: any) => (
              <div class="stats shadow mt-2" key={gpu.index}>
                <div class="stat">
                  <div class="stat-title">{gpu.name}</div>
                  <div class="stat-value text-lg">
                    {gpu.memoryUsedMiB} / {gpu.memoryTotalMiB} MiB
                  </div>
                  <div class="stat-desc">
                    GPU {gpu.utilizationPercent ?? "?"}% · {gpu.temperatureC ?? "?"} °C
                  </div>
                </div>
              </div>
            ))}
            <p class="text-sm opacity-70 mt-2">
              Lease: {lease ? `${lease.client} (${lease.id.slice(0, 8)}) prio ${lease.priority}` : "aucun"}
            </p>
          </div>
        </div>

        <div class="card bg-base-100 shadow">
          <div class="card-body">
            <h2 class="card-title">Lease</h2>
            <label class="form-control">
              <span class="label-text">Client</span>
              <select class="select select-bordered" value={client} onChange={(e) => setClient(e.currentTarget.value)}>
                <option value="popcorn">popcorn</option>
                <option value="ollama">ollama</option>
                <option value="agents">agents</option>
              </select>
            </label>
            <div class="card-actions mt-4">
              <button class="btn btn-primary" onClick={acquire} disabled={busy}>
                Acquerir
              </button>
              <button class="btn" onClick={release} disabled={busy}>
                Liberer
              </button>
              <button class="btn btn-ghost" onClick={refresh} disabled={busy}>
                Rafraichir
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="card bg-base-100 shadow">
        <div class="card-body">
          <h2 class="card-title">File d'attente</h2>
          {queue.length === 0 ? (
            <p class="opacity-70">File vide.</p>
          ) : (
            <div class="overflow-x-auto">
              <table class="table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Priorite</th>
                    <th>Demande</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((item: any) => (
                    <tr key={item.id}>
                      <td>{item.client}</td>
                      <td>{item.priority}</td>
                      <td>{item.requestedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div class="card bg-base-100 shadow">
        <div class="card-body">
          <h2 class="card-title">Priorites</h2>
          <pre class="text-sm bg-base-200 p-3 rounded">{JSON.stringify(data?.priorities || {}, null, 2)}</pre>
          <div class="flex flex-wrap gap-2 items-end">
            <input
              class="input input-bordered"
              value={priorityClient}
              onInput={(e) => setPriorityClient(e.currentTarget.value)}
              placeholder="client"
            />
            <input
              class="input input-bordered w-28"
              type="number"
              value={priority}
              onInput={(e) => setPriority(Number(e.currentTarget.value))}
            />
            <button class="btn btn-secondary" onClick={savePriority} disabled={busy}>
              Enregistrer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
