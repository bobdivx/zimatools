import { useEffect, useState } from "preact/hooks";

function apiBase() {
  const env = import.meta.env.PUBLIC_API_URL;
  if (env) return env.replace(/\/$/, "");
  if (typeof window === "undefined") return "http://127.0.0.1:8766";
  return `${window.location.protocol}//${window.location.hostname}:8766`;
}

export default function DockerList() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiBase()}/api/docker/containers`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message || String(e)));
  }, []);

  if (error) {
    return <div class="alert alert-warning">API injoignable ({error}).</div>;
  }

  if (!data) return <span class="loading loading-spinner" />;

  const containers = data.containers || [];

  return (
    <div class="card bg-base-100 shadow">
      <div class="card-body">
        {data.stub && (
          <div class="badge badge-warning mb-2">placeholder / SSH Docker indisponible</div>
        )}
        {data.error && <p class="text-sm opacity-70">{data.error}</p>}
        {containers.length === 0 ? (
          <p class="opacity-70">Aucun conteneur (ou API stub).</p>
        ) : (
          <div class="overflow-x-auto">
            <table class="table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Image</th>
                  <th>Etat</th>
                  <th>Ports</th>
                </tr>
              </thead>
              <tbody>
                {containers.map((c: any) => (
                  <tr key={c.id || c.name}>
                    <td>{c.name}</td>
                    <td>{c.image}</td>
                    <td>{c.state || c.status}</td>
                    <td>{c.ports}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
