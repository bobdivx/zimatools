import { useEffect, useState } from "preact/hooks";
import { jsonFetch } from "../lib/api";

type WatchdogResult = {
  name: string;
  image: string;
  status: "updated" | "unchanged" | "skipped" | "error";
  message?: string;
  at: string;
};

type WatchdogStatus = {
  ok?: boolean;
  config: { enabled: boolean; intervalMinutes: number; excludeNames: string[] };
  lastCheckAt: string | null;
  lastRun: {
    startedAt: string;
    finishedAt: string;
    trigger: string;
    results: WatchdogResult[];
  } | null;
  running: boolean;
  webhookConfigured: boolean;
  webhookSecret: string;
  webhookSecretSource: "env" | "stored";
  webhookUrl: string;
  publicBaseUrl?: string | null;
};

const INTERVALS = [
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 h" },
  { value: 360, label: "6 h" },
  { value: 1440, label: "24 h" },
];

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "jamais";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function CopyButton({ text, label = "Copier" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }
  return (
    <button type="button" class="btn btn-ghost btn-xs" onClick={onCopy}>
      {copied ? "Copié" : label}
    </button>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div class="rounded-xl border border-white/10 bg-black/20 px-3 py-2 min-w-0">
      <div class="flex items-center justify-between gap-2 mb-1">
        <span class="text-xs opacity-60">{label}</span>
        <CopyButton text={value} />
      </div>
      <div class="font-mono text-xs break-all select-all">{value}</div>
    </div>
  );
}

export type WatchdogMap = Record<string, WatchdogResult>;

interface Props {
  onResults?: (byName: WatchdogMap) => void;
}

export default function WatchdogPanel({ onResults }: Props) {
  const [wd, setWd] = useState<WatchdogStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const [showSecret, setShowSecret] = useState(false);

  async function refresh() {
    try {
      setError(null);
      const data = (await jsonFetch("/api/apps/watchdog")) as WatchdogStatus;
      setWd(data);
      if (data.lastRun?.results && onResults) {
        const map: WatchdogMap = {};
        for (const r of data.lastRun.results) map[r.name] = r;
        onResults(map);
      }
    } catch (e: any) {
      setError(e.message || String(e));
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 12_000);
    return () => clearInterval(id);
  }, []);

  async function patch(partial: {
    enabled?: boolean;
    intervalMinutes?: number;
    rotateSecret?: boolean;
  }) {
    setBusy(true);
    try {
      const data = (await jsonFetch("/api/apps/watchdog", {
        method: "PATCH",
        body: JSON.stringify(partial),
      })) as WatchdogStatus;
      setWd(data);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    setBusy(true);
    try {
      const data = (await jsonFetch("/api/apps/watchdog/run", {
        method: "POST",
        body: "{}",
      })) as WatchdogStatus & { run?: WatchdogStatus["lastRun"] };
      setWd(data);
      if (data.lastRun?.results && onResults) {
        const map: WatchdogMap = {};
        for (const r of data.lastRun.results) map[r.name] = r;
        onResults(map);
      }
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl =
    wd?.webhookUrl && !wd.webhookUrl.startsWith("/")
      ? wd.webhookUrl
      : `${origin}/api/apps/webhook`;
  const secret = wd?.webhookSecret || "";
  const baseUrl = wd?.publicBaseUrl || origin;

  const curlSnippet = secret
    ? `curl -fsS -X POST "${webhookUrl}" \\
  -H "Authorization: Bearer ${secret}" \\
  -H "Content-Type: application/json" \\
  -d '{"image":"bobdivx/mon-app:latest"}'`
    : "";

  const ghaSnippet = [
    "# 1. Repo → Settings → Secrets and variables → Actions",
    `#    ZIMA_URL              = ${baseUrl}`,
    `#    IMAGE_WEBHOOK_SECRET  = ${secret}`,
    "",
    "# 2. Après docker push, appeler le webhook :",
    "- name: Notify ZimaTools",
    "  run: |",
    '    curl -fsS -X POST "${{ secrets.ZIMA_URL }}/api/apps/webhook" \\',
    '      -H "Authorization: Bearer ${{ secrets.IMAGE_WEBHOOK_SECRET }}" \\',
    '      -H "Content-Type: application/json" \\',
    "      -d '{\"image\":\"bobdivx/mon-app:latest\"}'",
  ].join("\n");

  const updated = wd?.lastRun?.results.filter((r) => r.status === "updated").length ?? 0;
  const errored = wd?.lastRun?.results.filter((r) => r.status === "error").length ?? 0;

  return (
    <div class="zima-card space-y-4">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div>
          <div class="zima-kicker">Images</div>
          <div class="font-semibold mt-0.5">Watchdog & webhook</div>
        </div>
        <div class="flex items-center gap-2 text-sm opacity-70">
          {wd?.config.enabled ? (
            <span class="zima-pill zima-pill-run">actif · {wd.config.intervalMinutes} min</span>
          ) : (
            <span class="zima-pill zima-pill-stop">inactif</span>
          )}
          <span class="opacity-50">{open ? "▾" : "▸"}</span>
        </div>
      </button>

      {open && (
        <>
          {error && <div class="alert alert-warning text-sm py-2">{error}</div>}
          {!wd && !error && <span class="loading loading-spinner loading-sm" />}

          {wd && (
            <div class="space-y-5">
              <div class="grid gap-4 lg:grid-cols-2">
                <div class="space-y-3">
                  <label class="flex items-center justify-between gap-3 cursor-pointer">
                    <span class="text-sm font-medium">Activer le watchdog</span>
                    <input
                      type="checkbox"
                      class="toggle toggle-primary"
                      checked={wd.config.enabled}
                      disabled={busy}
                      onChange={(e) => patch({ enabled: (e.target as HTMLInputElement).checked })}
                    />
                  </label>

                  <label class="form-control w-full max-w-xs">
                    <span class="label-text text-sm opacity-70 mb-1">Fréquence</span>
                    <select
                      class="select select-bordered select-sm"
                      value={wd.config.intervalMinutes}
                      disabled={busy}
                      onChange={(e) =>
                        patch({ intervalMinutes: Number((e.target as HTMLSelectElement).value) })
                      }
                    >
                      {INTERVALS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div class="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      class="btn btn-primary btn-sm"
                      disabled={busy || wd.running}
                      onClick={runNow}
                    >
                      {wd.running || busy ? (
                        <span class="loading loading-spinner loading-xs" />
                      ) : null}
                      Vérifier maintenant
                    </button>
                    <span class="text-xs opacity-50">
                      Dernière vérif. {formatWhen(wd.lastCheckAt)}
                      {wd.lastRun ? ` · ${wd.lastRun.trigger}` : ""}
                      {updated ? ` · ${updated} maj` : ""}
                      {errored ? ` · ${errored} err` : ""}
                    </span>
                  </div>

                  <p class="text-xs opacity-50 leading-relaxed">
                    Le timer vérifie à intervalle régulier. Le webhook ci-dessous force un pull immédiat
                    (ex. fin de build GitHub Actions). Exclus :{" "}
                    {(wd.config.excludeNames || []).join(", ") || "zimatools-* / infra"}.
                  </p>
                </div>

                <div class="space-y-3 min-w-0">
                  <div class="flex flex-wrap items-center gap-2 text-sm">
                    <span class="font-medium">Point d’entrée webhook</span>
                    <span class="zima-pill zima-pill-run">prêt</span>
                    {wd.webhookSecretSource === "env" ? (
                      <span class="zima-pill zima-pill-hold">secret via .env</span>
                    ) : (
                      <span class="zima-pill zima-pill-gpu">secret auto</span>
                    )}
                  </div>

                  <FieldRow label="URL webhook" value={webhookUrl} />

                  <div class="rounded-xl border border-white/10 bg-black/20 px-3 py-2 min-w-0">
                    <div class="flex items-center justify-between gap-2 mb-1">
                      <span class="text-xs opacity-60">Secret (Bearer / X-Webhook-Secret)</span>
                      <div class="flex items-center gap-1">
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs"
                          onClick={() => setShowSecret((v) => !v)}
                        >
                          {showSecret ? "Masquer" : "Afficher"}
                        </button>
                        <CopyButton text={secret} />
                        {wd.webhookSecretSource !== "env" && (
                          <button
                            type="button"
                            class="btn btn-ghost btn-xs"
                            disabled={busy}
                            onClick={() => {
                              if (confirm("Régénérer le secret ? Les workflows GHA devront être mis à jour.")) {
                                void patch({ rotateSecret: true });
                              }
                            }}
                          >
                            Régénérer
                          </button>
                        )}
                      </div>
                    </div>
                    <div class="font-mono text-xs break-all select-all">
                      {showSecret ? secret : "•".repeat(Math.min(32, secret.length || 24))}
                    </div>
                  </div>
                </div>
              </div>

              <div class="space-y-3">
                <h3 class="text-sm font-semibold">Doc intégration GitHub Actions</h3>
                <ol class="text-xs opacity-70 list-decimal pl-4 space-y-1 leading-relaxed">
                  <li>
                    Créer les secrets repo{" "}
                    <code class="opacity-90">ZIMA_URL</code> ={" "}
                    <span class="font-mono">{baseUrl}</span> et{" "}
                    <code class="opacity-90">IMAGE_WEBHOOK_SECRET</code> = le secret ci-dessus.
                  </li>
                  <li>Après le <code class="opacity-90">docker push</code>, appeler le webhook avec l’image publiée.</li>
                  <li>
                    Body JSON :{" "}
                    <code class="opacity-90">{'{"image":"owner/repo:tag"}'}</code> ou{" "}
                    <code class="opacity-90">{'{"images":["a:tag","b:tag"]}'}</code> — omit pour tout
                    scanner.
                  </li>
                </ol>

                <div>
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-xs opacity-60">curl (valeurs réelles)</span>
                    <CopyButton text={curlSnippet} />
                  </div>
                  <div class="code-block text-[11px]">{curlSnippet}</div>
                </div>

                <div>
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-xs opacity-60">snippet workflow YAML</span>
                    <CopyButton text={ghaSnippet} />
                  </div>
                  <div class="code-block text-[11px]">{ghaSnippet}</div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
