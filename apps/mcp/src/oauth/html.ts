export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page(title: string, body: string, statusNote?: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: #101216; color: #e8eaed; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    main { width: min(28rem, calc(100% - 2rem)); background: #1c1f26; border: 1px solid rgba(255,255,255,.08);
      border-radius: 1.125rem; padding: 1.5rem; }
    img.logo { width: 64px; height: 64px; border-radius: 16px; }
    h1 { font-size: 1.25rem; margin: .75rem 0 .25rem; }
    p, li { color: #9aa3b2; font-size: .92rem; line-height: 1.5; }
    .client { color: #e8eaed; font-weight: 600; }
    label { display: block; font-size: .8rem; margin: 1rem 0 .35rem; color: #cfd6e0; }
    input[type=password] { width: 100%; box-sizing: border-box; background: #101216; color: #e8eaed;
      border: 1px solid rgba(255,255,255,.12); border-radius: .75rem; padding: .7rem .8rem; font-size: 1rem; }
    .row { display: flex; gap: .6rem; margin-top: 1rem; }
    button { border: 0; border-radius: .75rem; padding: .7rem 1rem; font-weight: 600; cursor: pointer; }
    button.yes { background: #3b82f6; color: white; }
    button.no, a.btn { background: transparent; color: #e8eaed; border: 1px solid rgba(255,255,255,.16); text-decoration: none; }
    .err { color: #fca5a5; }
    ul { padding-left: 1.1rem; }
    form.inline { display: inline; }
    table { width: 100%; border-collapse: collapse; font-size: .85rem; }
    td { padding: .45rem 0; border-top: 1px solid rgba(255,255,255,.06); vertical-align: top; }
    code { color: #4da3ff; }
  </style>
</head>
<body>
  <main>
    <img class="logo" src="/logo.png" alt="">
    <h1>${escapeHtml(title)}</h1>
    ${statusNote ? `<p class="err">${escapeHtml(statusNote)}</p>` : ""}
    ${body}
  </main>
</body>
</html>`;
}

export function errorPage(title: string, detail: string): string {
  return page(title, `<p>${escapeHtml(detail)}</p>`);
}

export function consentPage(input: {
  requestId: string;
  clientName: string;
  redirectHost: string;
  error?: string;
}): string {
  const body = `
    <p><span class="client">${escapeHtml(input.clientName)}</span> demande l'accès aux outils ZimaTools
    (fichiers, Docker, GPU) sur ce NAS.</p>
    <p>Retour vers <code>${escapeHtml(input.redirectHost || "—")}</code>. Le jeton ne quitte pas ce serveur :
    le mot de passe admin n'est pas envoyé à l'application.</p>
    <form method="post" action="/oauth/consent">
      <input type="hidden" name="request" value="${escapeHtml(input.requestId)}">
      <label for="password">Mot de passe admin (ZIMATOOLS_ADMIN_PASSWORD)</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <div class="row">
        <button class="yes" type="submit" name="decision" value="approve">Autoriser</button>
        <button class="no" type="submit" name="decision" value="deny">Refuser</button>
      </div>
    </form>`;
  return page("Autoriser l'application", body, input.error);
}

export function appsPage(input: {
  grants: Array<{ id: string; clientName: string; created: number; lastUsed: number | null }>;
  error?: string;
  loggedIn: boolean;
}): string {
  if (!input.loggedIn) {
    const body = `
      <p>Liste des applications OAuth reliées à ce ZimaTools. Le mot de passe n'est pas le jeton MCP.</p>
      <form method="post" action="/oauth/apps/login">
        <label for="password">Mot de passe admin</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
        <div class="row"><button class="yes" type="submit">Afficher</button></div>
      </form>`;
    return page("Applications connectées", body, input.error);
  }
  const rows = input.grants.length
    ? `<table>${input.grants
        .map((g) => {
          const when = new Date(g.created).toLocaleString("fr-FR");
          const used = g.lastUsed ? new Date(g.lastUsed).toLocaleString("fr-FR") : "jamais";
          return `<tr><td><div class="client">${escapeHtml(g.clientName)}</div><div>créée ${escapeHtml(when)} · dernier usage ${escapeHtml(used)}</div></td>
            <td><form class="inline" method="post" action="/oauth/apps/revoke">
              <input type="hidden" name="id" value="${escapeHtml(g.id)}">
              <button class="no" type="submit">Révoquer</button>
            </form></td></tr>`;
        })
        .join("")}</table>`
    : `<p>Aucune application connectée.</p>`;
  const body = `${rows}<p><a class="btn" href="/mcp">Retour à l'aide MCP</a></p>`;
  return page("Applications connectées", body, input.error);
}
