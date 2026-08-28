import { useEffect, useState } from "preact/hooks";
import { jsonFetch } from "../lib/api";
import AppTile, { type AppInfo } from "./AppTile";

export default function AppsGrid() {
  const [data, setData] = useState<any>(null);
  const [leaseClient, setLeaseClient] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (error) return <div class="alert alert-warning">API injoignable ({error}).</div>;
  if (!data) return <span class="loading loading-spinner" />;

  const apps: AppInfo[] = data.apps || [];
  const holder = (app: AppInfo) =>
    Boolean(leaseClient && (app.gpuClient === leaseClient || app.name === leaseClient));

  return (
    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-2 text-sm opacity-70">
        <span>source {data.source}</span>
        <span>·</span>
        <span>{apps.filter((a) => a.running).length} en cours / {apps.length}</span>
        {leaseClient && <span class="zima-pill zima-pill-hold">lease {leaseClient}</span>}
      </div>
      {data.error && <p class="text-sm opacity-50">{data.error}</p>}
      {apps.length === 0 ? (
        <div class="zima-card opacity-70">Aucun conteneur (ou API stub).</div>
      ) : (
        <div class="app-grid">
          {apps.map((app) => (
            <AppTile key={app.id} app={app} showMeta holder={holder(app)} />
          ))}
        </div>
      )}
    </div>
  );
}
