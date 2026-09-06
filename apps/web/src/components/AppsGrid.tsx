import { useEffect, useMemo, useState } from "preact/hooks";
import { jsonFetch } from "../lib/api";
import AppTile, { type AppInfo, type UpdateHint } from "./AppTile";
import WatchdogPanel, { type WatchdogMap } from "./WatchdogPanel";

type FilterId = "all" | "running" | "stopped" | "gpu";

export default function AppsGrid() {
  const [data, setData] = useState<any>(null);
  const [leaseClient, setLeaseClient] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  const [wdResults, setWdResults] = useState<WatchdogMap>({});

  async function refresh() {
    try {
      setError(null);
      const [listed, status] = await Promise.all([
        jsonFetch("/api/apps"),
        jsonFetch("/api/gpu/status").catch(() => null),
      ]);
      setData(listed);
      setLeaseClient(status?.lease?.client || null);
    } catch (e: any) {
      setError(e.message || String(e));
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  const apps: AppInfo[] = data?.apps || [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return apps.filter((app) => {
      if (filter === "running" && !app.running) return false;
      if (filter === "stopped" && app.running) return false;
      if (filter === "gpu" && !app.gpu) return false;
      if (!q) return true;
      const hay = `${app.title} ${app.name} ${app.image}`.toLowerCase();
      return hay.includes(q);
    });
  }, [apps, filter, query]);

  const running = filtered.filter((a) => a.running);
  const stopped = filtered.filter((a) => !a.running);

  const holder = (app: AppInfo) =>
    Boolean(leaseClient && (app.gpuClient === leaseClient || app.name === leaseClient));

  function hintFor(app: AppInfo): UpdateHint | undefined {
    const r = wdResults[app.name];
    if (!r) return undefined;
    if (r.status === "updated") return "updated";
    if (r.status === "error") return "error";
    return undefined;
  }

  const counts = {
    all: apps.length,
    running: apps.filter((a) => a.running).length,
    stopped: apps.filter((a) => !a.running).length,
    gpu: apps.filter((a) => a.gpu).length,
  };

  if (error) return <div class="alert alert-warning">API injoignable ({error}).</div>;
  if (!data) return <span class="loading loading-spinner" />;

  return (
    <div class="space-y-6">
      <WatchdogPanel onResults={setWdResults} />

      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex flex-wrap items-center gap-2 text-sm opacity-70">
          <span>source {data.source}</span>
          <span>·</span>
          <span>
            {counts.running} en cours / {counts.all}
          </span>
          {leaseClient && <span class="zima-pill zima-pill-hold">lease {leaseClient}</span>}
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <input
            type="search"
            class="input input-bordered input-sm w-full sm:w-56"
            placeholder="Rechercher…"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
          {(
            [
              ["all", "Tous", counts.all],
              ["running", "En cours", counts.running],
              ["stopped", "Arrêtés", counts.stopped],
              ["gpu", "GPU", counts.gpu],
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              class={`btn btn-sm ${filter === id ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setFilter(id)}
            >
              {label}
              <span class="opacity-60">{n}</span>
            </button>
          ))}
        </div>
      </div>

      {data.error && <p class="text-sm opacity-50">{data.error}</p>}

      {filtered.length === 0 ? (
        <div class="zima-card opacity-70">Aucun conteneur ne correspond.</div>
      ) : (
        <div class="space-y-8">
          {(filter === "all" || filter === "running" || filter === "gpu") && running.length > 0 && (
            <section class="space-y-3">
              <h2 class="text-sm font-semibold uppercase tracking-wide opacity-60">
                En cours
                <span class="ml-2 opacity-50 font-normal normal-case tracking-normal">
                  {running.length}
                </span>
              </h2>
              <div class="app-grid">
                {running.map((app) => (
                  <AppTile
                    key={app.id}
                    app={app}
                    showMeta
                    holder={holder(app)}
                    updateHint={hintFor(app)}
                  />
                ))}
              </div>
            </section>
          )}

          {(filter === "all" || filter === "stopped" || filter === "gpu") && stopped.length > 0 && (
            <section class="space-y-3">
              <h2 class="text-sm font-semibold uppercase tracking-wide opacity-60">
                Arrêtés
                <span class="ml-2 opacity-50 font-normal normal-case tracking-normal">
                  {stopped.length}
                </span>
              </h2>
              <div class="app-grid">
                {stopped.map((app) => (
                  <AppTile
                    key={app.id}
                    app={app}
                    showMeta
                    holder={holder(app)}
                    updateHint={hintFor(app)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
