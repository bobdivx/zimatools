import { useEffect, useState } from "preact/hooks";

type Phase = "loading" | "in" | "out" | "unconfigured";

export default function AdminGate() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/session")
      .then(async (res) => {
        if (!res.ok) return { authenticated: false, passwordConfigured: true };
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (data.authenticated) setPhase("in");
        else if (data.passwordConfigured === false) setPhase("unconfigured");
        else setPhase("out");
      })
      .catch(() => {
        if (!cancelled) setPhase("out");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: Event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.status === 429) {
        setError("Trop de tentatives. Réessaie dans quelques minutes.");
        return;
      }
      if (!res.ok) {
        setError("Mot de passe incorrect.");
        return;
      }
      location.reload();
    } catch {
      setError("API injoignable.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/session/logout", { method: "POST" });
    location.reload();
  }

  if (phase === "loading") return null;

  if (phase === "in") {
    return (
      <div class="flex justify-end mb-4">
        <button type="button" class="btn btn-ghost btn-sm" onClick={logout}>
          Déconnexion
        </button>
      </div>
    );
  }

  return (
    <form class="zima-card mb-6 max-w-md" onSubmit={submit}>
      <div class="zima-kicker">Session</div>
      <h2 class="text-xl font-semibold mt-1">Tableau de bord</h2>
      <p class="text-sm opacity-70 mt-2">
        Docker, les apps et le GPU exigent ce mot de passe (le même que le consentement OAuth). Le catalogue MCP
        reste lisible sans session.
      </p>
      {phase === "unconfigured" && (
        <div class="alert alert-warning mt-3">
          ZIMATOOLS_ADMIN_PASSWORD n'est pas défini : le tableau de bord ne peut pas s'ouvrir.
        </div>
      )}
      {phase === "out" && (
        <label class="form-control mt-4">
          <span class="text-sm opacity-70 mb-1">Mot de passe admin</span>
          <input
            class="input input-bordered w-full"
            type="password"
            name="password"
            autocomplete="current-password"
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            required
          />
        </label>
      )}
      {error && <p class="text-error text-sm mt-3">{error}</p>}
      {phase === "out" && (
        <button class="btn btn-primary btn-sm mt-4" type="submit" disabled={busy}>
          {busy ? "Connexion…" : "Se connecter"}
        </button>
      )}
    </form>
  );
}
