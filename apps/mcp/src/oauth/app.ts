import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { SCOPE, ADMIN_COOKIE, ADMIN_COOKIE_TTL_MS, readCookie, signAdminCookie, tokenMatches, verifyAdminCookie } from "./crypto.js";
import { appsPage, consentPage, errorPage } from "./html.js";
import { ICON_180, ICON_192, ICON_512, ICON_ICO, ICON_SVG, iconsJson } from "./icons.js";
import { authorizationServerDoc, fetchClientMetadata, protectedResourceDoc, wwwAuthenticate } from "./metadata.js";
import {
  appendQuery,
  clientFromUrl,
  isLoopbackHost,
  redirectMatches,
  resourceOk,
  validChallenge,
} from "./policy.js";
import { OauthStore, resolveOauthFile, type ClientRecord } from "./store.js";

const MAX_MCP_BODY = 8 * 1024 * 1024;
const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length"]);

export interface ConnectorConfig {
  upstreamBase: string;
  endpoint: string;
  publicBaseUrl: string | null;
  adminPassword: string | null;
  staticToken: string | null;
  loadClientMetadata: (url: string) => Promise<unknown | null>;
}

export function blank(value: string | undefined): string | null {
  const trimmed = (value || "").trim();
  return trimmed ? trimmed : null;
}

export function configFromEnv(upstreamBase: string, endpoint: string): ConnectorConfig {
  const configured = blank(process.env.PUBLIC_BASE_URL);
  return {
    upstreamBase: upstreamBase.replace(/\/$/, ""),
    endpoint: endpoint.startsWith("/") ? endpoint : `/${endpoint}`,
    publicBaseUrl: configured ? configured.replace(/\/$/, "") : null,
    adminPassword: blank(process.env.ZIMATOOLS_ADMIN_PASSWORD),
    staticToken: blank(process.env.ZIMATOOLS_MCP_TOKEN),
    loadClientMetadata: fetchClientMetadata,
  };
}

function firstHeader(value: string | undefined): string {
  return (value || "").split(",")[0].trim();
}

export function requestPublicBase(c: Context, configured: string | null): string | null {
  if (configured) return configured.replace(/\/$/, "");
  const xfHost = firstHeader(c.req.header("x-forwarded-host"));
  const host = firstHeader(c.req.header("host"));
  const proto = firstHeader(c.req.header("x-forwarded-proto")) || "http";
  const chosen = xfHost && !isLoopbackHost(xfHost) ? xfHost : host;
  if (!chosen) return null;
  if (isLoopbackHost(chosen)) return `http://${chosen}`;
  return `${proto}://${chosen}`;
}

function clientIp(c: Context): string {
  const xf = firstHeader(c.req.header("x-forwarded-for"));
  return (xf || "local").slice(0, 64);
}

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  return match ? match[1] : null;
}

async function readForm(c: Context): Promise<URLSearchParams> {
  const type = c.req.header("content-type") || "";
  if (type.includes("application/json")) {
    const json = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(json || {})) {
      if (typeof value === "string") params.set(key, value);
    }
    return params;
  }
  return new URLSearchParams(await c.req.text());
}

function clientCredentials(c: Context, form: URLSearchParams): { id: string; secret: string | null } {
  const auth = c.req.header("authorization") || "";
  if (/^Basic\s+/i.test(auth)) {
    try {
      const decoded = Buffer.from(auth.replace(/^Basic\s+/i, "").trim(), "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      if (idx >= 0) {
        return {
          id: decodeURIComponent(decoded.slice(0, idx)),
          secret: decodeURIComponent(decoded.slice(idx + 1)),
        };
      }
    } catch {
      /* corps du formulaire */
    }
  }
  return { id: form.get("client_id") || "", secret: form.get("client_secret") || null };
}

type HttpStatus = 200 | 201 | 400 | 401 | 404 | 413 | 429 | 500 | 502 | 503;

function html(c: Context, status: HttpStatus, body: string) {
  c.header("cache-control", "no-store");
  return c.html(body, status);
}

function oauthError(c: Context, status: HttpStatus, error: string, description: string) {
  c.header("cache-control", "no-store");
  return c.json({ error, error_description: description }, status);
}

function secureCookie(c: Context, config: ConnectorConfig): boolean {
  if (config.publicBaseUrl?.startsWith("https://")) return true;
  return firstHeader(c.req.header("x-forwarded-proto")) === "https";
}

function adminCookie(c: Context, config: ConnectorConfig, store: OauthStore): boolean {
  return verifyAdminCookie(config.adminPassword, readCookie(c.req.header("cookie"), ADMIN_COOKIE), store.now());
}

function setAdminCookie(c: Context, config: ConnectorConfig, store: OauthStore): void {
  if (!config.adminPassword) return;
  const exp = store.now() + ADMIN_COOKIE_TTL_MS;
  const value = encodeURIComponent(signAdminCookie(config.adminPassword, exp));
  const parts = [
    `${ADMIN_COOKIE}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.floor(ADMIN_COOKIE_TTL_MS / 1000)}`,
  ];
  if (secureCookie(c, config)) parts.push("Secure");
  c.header("set-cookie", parts.join("; "));
}

interface ResolvedClient {
  id: string;
  name: string;
  redirectUris: string[];
  originRule: string | null;
  local: ClientRecord | null;
}

function redirectHost(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return "";
  }
}

export function isInitializeBody(body: Buffer): boolean {
  return /"method"\s*:\s*"initialize"/.test(body.subarray(0, 8192).toString("utf8"));
}

export function patchInitializeBody(text: string, contentType: string, base: string): string {
  const apply = (json: string): string => {
    try {
      const obj = JSON.parse(json) as { result?: { serverInfo?: Record<string, unknown> } };
      const info = obj?.result?.serverInfo;
      if (info && typeof info === "object" && base) {
        info.title = info.title || "ZimaTools";
        info.websiteUrl = base;
        info.icons = iconsJson(base);
      }
      return JSON.stringify(obj);
    } catch {
      return json;
    }
  };
  if (contentType.includes("text/event-stream") || text.startsWith("data:") || text.includes("\ndata:")) {
    return text.replace(/^data: (.*)$/gm, (_line, json: string) => `data: ${apply(json)}`);
  }
  return apply(text);
}

export function createConnectorApp(store: OauthStore, config: ConnectorConfig): Hono {
  const app = new Hono();
  const endpoint = config.endpoint.startsWith("/") ? config.endpoint : `/${config.endpoint}`;

  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS") {
      c.header("access-control-allow-origin", "*");
      c.header("access-control-allow-headers", "Content-Type, Accept, Authorization, Mcp-Session-Id, Last-Event-ID");
      c.header("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
      c.header("access-control-max-age", "600");
      return c.body(null, 204);
    }
    await next();
    c.header("access-control-allow-origin", "*");
    c.header("access-control-expose-headers", "WWW-Authenticate, Mcp-Session-Id, Content-Type");
    c.header("access-control-allow-headers", "Content-Type, Accept, Authorization, Mcp-Session-Id, Last-Event-ID");
  });

  const baseOf = (c: Context) => requestPublicBase(c, config.publicBaseUrl);

  app.get("/.well-known/oauth-protected-resource", (c) => sendResource(c));
  app.get("/.well-known/oauth-protected-resource/*", (c) => sendResource(c));
  app.get("/.well-known/oauth-authorization-server", (c) => sendServer(c));
  app.get("/.well-known/oauth-authorization-server/*", (c) => sendServer(c));
  app.get("/.well-known/openid-configuration", (c) => sendServer(c));

  function sendResource(c: Context) {
    const base = baseOf(c);
    if (!base) return oauthError(c, 503, "server_error", "PUBLIC_BASE_URL non défini");
    return c.json(protectedResourceDoc(base, endpoint));
  }
  function sendServer(c: Context) {
    const base = baseOf(c);
    if (!base) return oauthError(c, 503, "server_error", "PUBLIC_BASE_URL non défini");
    return c.json(authorizationServerDoc(base));
  }

  const icon = (bytes: Buffer, mime: string) => (c: Context) => {
    c.header("cache-control", "public, max-age=86400");
    c.header("x-content-type-options", "nosniff");
    return c.body(new Uint8Array(bytes), 200, { "content-type": mime });
  };
  app.get("/logo.png", icon(ICON_512, "image/png"));
  app.get("/icon.png", icon(ICON_512, "image/png"));
  app.get("/logo.svg", icon(ICON_SVG, "image/svg+xml"));
  app.get("/favicon.ico", icon(ICON_ICO, "image/x-icon"));
  app.get("/favicon.png", icon(ICON_192, "image/png"));
  app.get("/apple-touch-icon.png", icon(ICON_180, "image/png"));
  app.get("/icons/zimatools-512.png", icon(ICON_512, "image/png"));
  app.get("/icons/zimatools-192.png", icon(ICON_192, "image/png"));
  app.get("/icons/zimatools.svg", icon(ICON_SVG, "image/svg+xml"));

  async function resolveClient(id: string): Promise<ResolvedClient | null> {
    const trimmed = id.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("https://")) {
      const doc = await config.loadClientMetadata(trimmed);
      const parsed = clientFromUrl(trimmed, doc);
      if (!parsed.ok) return null;
      return {
        id: trimmed,
        name: parsed.client.name,
        redirectUris: parsed.client.redirectUris,
        originRule: parsed.client.originRule,
        local: null,
      };
    }
    const local = store.clientById(trimmed);
    if (!local) return null;
    return {
      id: local.id,
      name: local.name,
      redirectUris: local.redirectUris,
      originRule: null,
      local,
    };
  }

  app.post("/oauth/register", async (c) => {
    const declared = Number(c.req.header("content-length") || 0);
    if (declared > 16 * 1024) return oauthError(c, 400, "invalid_client_metadata", "corps trop long");
    const text = await c.req.text();
    if (text.length > 16 * 1024) return oauthError(c, 400, "invalid_client_metadata", "corps trop long");
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("objet");
      body = parsed as Record<string, unknown>;
    } catch {
      return oauthError(c, 400, "invalid_client_metadata", "JSON attendu");
    }
    const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((item): item is string => typeof item === "string") : [];
    const method = typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : undefined;
    const name = typeof body.client_name === "string" ? body.client_name : undefined;
    const created = store.register(clientIp(c), { name, redirectUris: uris, authMethod: method });
    if ("error" in created) {
      if (created.error === "rate") return oauthError(c, 429, "invalid_client_metadata", "trop d'enregistrements, réessaie plus tard");
      if (created.error === "method") return oauthError(c, 400, "invalid_client_metadata", "token_endpoint_auth_method non pris en charge");
      return oauthError(c, 400, "invalid_redirect_uri", "redirect_uris : https, http loopback, ou schéma natif (5 au plus)");
    }
    console.info(`[zimatools] client OAuth enregistré (${created.client.name})`);
    const out: Record<string, unknown> = {
      client_id: created.client.id,
      client_id_issued_at: Math.floor(created.client.created / 1000),
      client_name: created.client.name,
      redirect_uris: created.client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: SCOPE,
      token_endpoint_auth_method: created.client.authMethod,
    };
    if (created.secret) {
      out.client_secret = created.secret;
      out.client_secret_expires_at = 0;
    }
    c.header("cache-control", "no-store");
    return c.json(out, 201);
  });

  app.get("/oauth/authorize", async (c) => {
    const base = baseOf(c);
    if (!base) return html(c, 503, errorPage("Autorisation indisponible", "Définis PUBLIC_BASE_URL."));
    const clientId = (c.req.query("client_id") || "").trim();
    const client = await resolveClient(clientId);
    if (!client) return html(c, 400, errorPage("Client inconnu", "L'application doit d'abord s'enregistrer, ou présenter un client_id https."));
    const requested = (c.req.query("redirect_uri") || "").trim();
    const redirect = requested
      ? redirectMatches(client, requested) ? requested : ""
      : client.redirectUris.length === 1 ? client.redirectUris[0] : "";
    if (!redirect) return html(c, 400, errorPage("Adresse de retour refusée", "Cette redirect_uri n'est pas enregistrée pour ce client."));
    const stateRaw = c.req.query("state") || "";
    const state = stateRaw ? stateRaw.slice(0, 512) : null;
    const fail = (code: string) => {
      const params: Array<[string, string]> = [["error", code]];
      if (state) params.push(["state", state]);
      params.push(["iss", base]);
      return c.redirect(appendQuery(redirect, params));
    };
    if ((c.req.query("response_type") || "") !== "code") return fail("unsupported_response_type");
    const challenge = c.req.query("code_challenge") || "";
    if (c.req.query("code_challenge_method") !== "S256" || !validChallenge(challenge)) return fail("invalid_request");
    const resource = (c.req.query("resource") || "").trim();
    if (!resourceOk(base, resource || null)) return fail("invalid_target");
    const id = store.openRequest({
      clientId: client.id,
      clientName: client.name,
      redirectUri: redirect,
      state,
      challenge,
      resource: resource || null,
    });
    return c.redirect(`/oauth/consent?request=${encodeURIComponent(id)}`);
  });

  app.get("/oauth/consent", (c) => {
    const id = c.req.query("request") || "";
    const req = store.peekRequest(id);
    if (!req) return html(c, 400, errorPage("Demande expirée", "Relance l'ajout du connecteur depuis l'application."));
    return html(c, 200, consentPage({ requestId: id, clientName: req.clientName, redirectHost: redirectHost(req.redirectUri) }));
  });

  app.post("/oauth/consent", async (c) => {
    const ip = clientIp(c);
    if (store.consentLimited(ip)) return html(c, 429, errorPage("Trop de tentatives", "Réessaie dans quelques minutes."));
    const form = await readForm(c);
    const id = form.get("request") || "";
    const decision = form.get("decision") || "";
    const password = form.get("password") || "";
    const req = store.peekRequest(id);
    if (!req) return html(c, 400, errorPage("Demande expirée", "Relance l'ajout du connecteur depuis l'application."));
    const again = (error: string) => html(c, 401, consentPage({ requestId: id, clientName: req.clientName, redirectHost: redirectHost(req.redirectUri), error }));
    if (!config.adminPassword) {
      return html(c, 503, errorPage("Consentement bloqué", "Définis ZIMATOOLS_ADMIN_PASSWORD sur le serveur, puis relance la connexion."));
    }
    if (decision !== "approve" && decision !== "deny") return again("Choisis autoriser ou refuser.");
    if (!tokenMatches(password, config.adminPassword)) {
      store.noteConsentFailure(ip);
      return again("Mot de passe incorrect.");
    }
    const base = baseOf(c);
    if (!base) return html(c, 503, errorPage("Autorisation indisponible", "Définis PUBLIC_BASE_URL."));
    const result = store.decide(id, decision === "approve");
    if (!result) return html(c, 400, errorPage("Demande expirée", "Relance l'ajout du connecteur depuis l'application."));
    const params: Array<[string, string]> = [];
    if (result.code) {
      params.push(["code", result.code]);
      console.info(`[zimatools] accès OAuth accordé à ${req.clientName}`);
    } else {
      params.push(["error", "access_denied"]);
    }
    if (result.state) params.push(["state", result.state]);
    params.push(["iss", base]);
    return c.redirect(appendQuery(result.redirectUri, params));
  });

  app.post("/oauth/token", async (c) => {
    const form = await readForm(c);
    const { id, secret } = clientCredentials(c, form);
    const client = await resolveClient(id);
    if (!client) return oauthError(c, 401, "invalid_client", "client inconnu ou secret invalide");
    if (client.local && !store.clientSecretOk(client.local, secret)) {
      return oauthError(c, 401, "invalid_client", "client inconnu ou secret invalide");
    }
    const grant = form.get("grant_type") || "";
    if (grant === "authorization_code") {
      const code = form.get("code") || "";
      const verifier = form.get("code_verifier") || "";
      if (!code || !verifier) return oauthError(c, 400, "invalid_request", "code et code_verifier requis");
      const exchanged = store.exchangeCode({
        clientId: client.id,
        code,
        redirectUri: form.get("redirect_uri"),
        verifier,
      });
      if (!exchanged.ok) return oauthError(c, 400, "invalid_grant", "code, vérificateur ou jeton invalide ou expiré");
      return tokenResponse(c, exchanged.tokens.access, exchanged.tokens.refresh, exchanged.tokens.expiresIn);
    }
    if (grant === "refresh_token") {
      const refresh = form.get("refresh_token") || "";
      if (!refresh) return oauthError(c, 400, "invalid_request", "refresh_token requis");
      const rotated = store.refresh(client.id, refresh);
      if (!rotated.ok) return oauthError(c, 400, "invalid_grant", "code, vérificateur ou jeton invalide ou expiré");
      return tokenResponse(c, rotated.tokens.access, rotated.tokens.refresh, rotated.tokens.expiresIn);
    }
    return oauthError(c, 400, "unsupported_grant_type", "authorization_code ou refresh_token");
  });

  app.post("/oauth/revoke", async (c) => {
    const form = await readForm(c);
    const token = form.get("token") || "";
    if (!token) return oauthError(c, 400, "invalid_request", "token requis");
    const { id, secret } = clientCredentials(c, form);
    let clientId: string | null = null;
    if (id) {
      const client = await resolveClient(id);
      if (client && (!client.local || store.clientSecretOk(client.local, secret))) clientId = client.id;
    }
    store.revokeToken(token, clientId);
    c.header("cache-control", "no-store");
    return c.body(null, 200);
  });

  app.get("/oauth/apps", (c) => {
    const loggedIn = adminCookie(c, config, store);
    return html(c, 200, appsPage({ loggedIn, grants: loggedIn ? store.listGrants() : [] }));
  });

  app.post("/oauth/apps/login", async (c) => {
    const ip = clientIp(c);
    if (store.consentLimited(ip)) return html(c, 429, errorPage("Trop de tentatives", "Réessaie dans quelques minutes."));
    if (!config.adminPassword) return html(c, 503, errorPage("Mot de passe absent", "Définis ZIMATOOLS_ADMIN_PASSWORD."));
    const form = await readForm(c);
    if (!tokenMatches(form.get("password") || "", config.adminPassword)) {
      store.noteConsentFailure(ip);
      return html(c, 401, appsPage({ loggedIn: false, grants: [], error: "Mot de passe incorrect." }));
    }
    setAdminCookie(c, config, store);
    return c.redirect("/oauth/apps");
  });

  app.post("/oauth/apps/revoke", async (c) => {
    if (!adminCookie(c, config, store)) return html(c, 401, appsPage({ loggedIn: false, grants: [], error: "Session expirée." }));
    const form = await readForm(c);
    const id = form.get("id") || "";
    if (!store.revokeGrant(id)) return html(c, 404, errorPage("Introuvable", "Cette autorisation n'existe plus."));
    console.info("[zimatools] autorisation OAuth révoquée");
    return c.redirect("/oauth/apps");
  });

  app.post("/oauth/session", async (c) => {
    const ip = clientIp(c);
    if (!config.adminPassword) return oauthError(c, 503, "server_error", "ZIMATOOLS_ADMIN_PASSWORD non défini");
    if (store.consentLimited(ip)) return oauthError(c, 429, "invalid_grant", "trop de tentatives");
    const body = (await c.req.json().catch(() => ({}))) as { password?: string };
    if (!tokenMatches(String(body.password || ""), config.adminPassword)) {
      store.noteConsentFailure(ip);
      return oauthError(c, 401, "access_denied", "mot de passe incorrect");
    }
    setAdminCookie(c, config, store);
    return c.json({ ok: true });
  });

  app.get("/oauth/grants", (c) => {
    if (!adminCookie(c, config, store)) return oauthError(c, 401, "access_denied", "session requise");
    return c.json({ grants: store.listGrants() });
  });

  app.delete("/oauth/grants/:id", (c) => {
    if (!adminCookie(c, config, store)) return oauthError(c, 401, "access_denied", "session requise");
    if (!store.revokeGrant(c.req.param("id"))) return oauthError(c, 404, "invalid_request", "autorisation introuvable");
    console.info("[zimatools] autorisation OAuth révoquée");
    return c.json({ ok: true });
  });

  const mcp = (c: Context) => handleMcp(c, store, config, endpoint);
  app.all(endpoint, mcp);
  if (!endpoint.endsWith("/")) app.all(`${endpoint}/*`, mcp);

  return app;
}

function tokenResponse(c: Context, access: string, refresh: string, expiresIn: number) {
  c.header("cache-control", "no-store");
  c.header("pragma", "no-cache");
  return c.json({
    access_token: access,
    token_type: "Bearer",
    expires_in: expiresIn,
    refresh_token: refresh,
    scope: SCOPE,
  });
}

async function handleMcp(c: Context, store: OauthStore, config: ConnectorConfig, endpoint: string) {
  const token = bearer(c.req.header("authorization"));
  const base = requestPublicBase(c, config.publicBaseUrl);
  const allowed = token !== null && (tokenMatches(token, config.staticToken) || store.accessGrant(token) !== null);
  if (!allowed) {
    c.header("WWW-Authenticate", wwwAuthenticate(base, endpoint, token !== null));
    c.header("cache-control", "no-store");
    return c.json(
      { error: "invalid_token", error_description: "Jeton absent, invalide ou révoqué." },
      401,
    );
  }
  const method = c.req.method.toUpperCase();
  let body: Buffer | null = null;
  if (method !== "GET" && method !== "HEAD") {
    const declared = Number(c.req.header("content-length") || 0);
    if (Number.isFinite(declared) && declared > MAX_MCP_BODY) {
      return c.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "requête trop longue" } }, 413);
    }
    body = Buffer.from(await c.req.arrayBuffer());
    if (body.length > MAX_MCP_BODY) {
      return c.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "requête trop longue" } }, 413);
    }
  }
  const search = new URL(c.req.url).search || "";
  const target = `${config.upstreamBase}${c.req.path}${search}`;
  const headers = new Headers(c.req.raw.headers);
  headers.delete("host");
  headers.delete("content-length");
  const patch = Boolean(body && isInitializeBody(body));
  try {
    const init: RequestInit & { duplex?: "half" } = { method, headers, redirect: "manual" };
    if (body) {
      init.body = new Uint8Array(body);
    }
    const upstream = await fetch(target, init);
    if (!patch) return passthrough(upstream);
    const raw = Buffer.from(await upstream.arrayBuffer()).toString("utf8");
    const type = upstream.headers.get("content-type") || "application/json";
    const headersOut = filteredHeaders(upstream.headers);
    headersOut.set("content-type", type);
    return new Response(patchInitializeBody(raw, type, base || ""), { status: upstream.status, headers: headersOut });
  } catch {
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "MCP upstream indisponible" } }, 502);
  }
}

function filteredHeaders(source: Headers): Headers {
  const out = new Headers();
  source.forEach((value, key) => {
    if (!HOP.has(key.toLowerCase())) out.set(key, value);
  });
  return out;
}

function passthrough(upstream: Response): Response {
  return new Response(upstream.body, { status: upstream.status, headers: filteredHeaders(upstream.headers) });
}

export function startConnector(opts: {
  port: number;
  host: string;
  upstreamBase: string;
  endpoint: string;
  store?: OauthStore;
  config?: ConnectorConfig;
}): { app: Hono; store: OauthStore; config: ConnectorConfig } {
  const config = opts.config || configFromEnv(opts.upstreamBase, opts.endpoint);
  const store = opts.store || OauthStore.load(resolveOauthFile());
  const app = createConnectorApp(store, config);
  serve({ fetch: app.fetch, port: opts.port, hostname: opts.host }, (info) => {
    console.log(`[zimatools] connecteur OAuth + MCP : http://${info.address}:${info.port}${config.endpoint}`);
  });
  if (!config.publicBaseUrl) {
    console.warn("[zimatools] PUBLIC_BASE_URL absent — l'issuer OAuth suivra les en-têtes du proxy. En production : https://zimatools.jeser.app");
  } else {
    console.log(`[zimatools] issuer OAuth : ${config.publicBaseUrl}`);
  }
  if (!config.adminPassword) {
    console.warn("[zimatools] ZIMATOOLS_ADMIN_PASSWORD absent — le consentement OAuth est bloqué.");
  } else if (config.adminPassword.length < 12) {
    console.warn("[zimatools] ZIMATOOLS_ADMIN_PASSWORD court : 12 caractères minimum recommandés.");
  }
  if (config.staticToken) {
    console.log("[zimatools] jeton statique MCP actif (automatisation).");
    if (config.staticToken.length < 16) console.warn("[zimatools] ZIMATOOLS_MCP_TOKEN court : 16 caractères minimum recommandés.");
  }
  return { app, store, config };
}
