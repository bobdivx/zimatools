import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import { createConnectorApp, type ConnectorConfig } from "../src/oauth/app.js";
import { pkceS256 } from "../src/oauth/crypto.js";
import { mcpPublicUrl } from "../src/lib/mcpCatalog.js";
import { isPublicIp, pkceOk, redirectMatches, redirectUriAllowed } from "../src/oauth/policy.js";
import { OauthStore } from "../src/oauth/store.js";

const VERIFIER = "a".repeat(50);
const CHALLENGE = pkceS256(VERIFIER);
const BASE = "https://zimatools.jeser.app";
const PASSWORD = "phrase-admin-test";
const STATIC = "static-token-test-value";

describe("règles OAuth", () => {
  it("refuse les redirects dangereuses et accepte loopback, https et cursor://", () => {
    assert.equal(redirectUriAllowed("javascript:alert(1)"), false);
    assert.equal(redirectUriAllowed("http://evil.example/cb"), false);
    assert.equal(redirectUriAllowed("http://127.0.0.1:3456/cb"), true);
    assert.equal(redirectUriAllowed("https://example.com/cb"), true);
    assert.equal(redirectUriAllowed("cursor://anysphere.cursor-mcp/oauth/callback"), true);
    assert.equal(redirectUriAllowed("https://example.com/cb#frag"), false);
  });

  it("aligne https://grok.com sur la même origine", () => {
    const client = { redirectUris: [] as string[], originRule: "https://grok.com" };
    assert.equal(redirectMatches(client, "https://grok.com/oauth/callback"), true);
    assert.equal(redirectMatches(client, "https://app.grok.com/cb"), true);
    assert.equal(redirectMatches(client, "https://evil.example/cb"), false);
    assert.equal(redirectMatches(client, "https://grok.com.evil.example/cb"), false);
  });

  it("bloque les IP privées et vérifie PKCE S256", () => {
    assert.equal(isPublicIp("8.8.8.8"), true);
    assert.equal(isPublicIp("127.0.0.1"), false);
    assert.equal(isPublicIp("10.1.2.3"), false);
    assert.equal(isPublicIp("169.254.169.254"), false);
    assert.equal(isPublicIp("192.168.1.2"), false);
    assert.equal(pkceOk(VERIFIER, CHALLENGE), true);
    assert.equal(pkceOk(VERIFIER, "x".repeat(43)), false);
    assert.equal(pkceOk("short", CHALLENGE), false);
  });

  it("n'affiche pas une URL loopback comme URL publique", () => {
    const previous = process.env.PUBLIC_BASE_URL;
    delete process.env.PUBLIC_BASE_URL;
    const loopback = {
      req: {
        header: (name: string) => (name === "host" ? "127.0.0.1:8766" : name === "x-forwarded-proto" ? "https" : undefined),
      },
    };
    assert.equal(mcpPublicUrl(loopback, "/mcp", "127.0.0.1", 8765), null);
    const forwarded = {
      req: {
        header: (name: string) => {
          if (name === "x-forwarded-host") return "zimatools.jeser.app";
          if (name === "x-forwarded-proto") return "https";
          if (name === "host") return "127.0.0.1:8766";
          return undefined;
        },
      },
    };
    assert.equal(mcpPublicUrl(forwarded, "/mcp", "127.0.0.1", 8765), `${BASE}/mcp`);
    process.env.PUBLIC_BASE_URL = BASE;
    assert.equal(mcpPublicUrl(loopback, "/mcp", "127.0.0.1", 8765), `${BASE}/mcp`);
    if (previous === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previous;
  });

  it("persiste les clients sans les jetons en clair", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zima-oauth-"));
    const file = path.join(dir, "oauth.json");
    const first = OauthStore.load(file);
    const created = first.register("203.0.113.5", {
      name: "Persist",
      redirectUris: ["https://example.com/cb"],
      authMethod: "none",
    });
    assert.ok(!("error" in created));
    const second = OauthStore.load(file);
    assert.equal(second.clientById(created.client.id)?.name, "Persist");
    const raw = fs.readFileSync(file, "utf8");
    assert.equal(raw.includes("zta_"), false);
    assert.equal((fs.statSync(file).mode & 0o777) === 0o600, true);
  });
});

describe("connecteur HTTP", { concurrency: 1 }, () => {
  let hits = 0;
  let upstream: http.Server;
  let app: ReturnType<typeof createConnectorApp>;
  let config: ConnectorConfig;

  before(async () => {
    upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk as Buffer));
      req.on("end", () => {
        hits += 1;
        const body = Buffer.concat(chunks).toString("utf8");
        if (body.includes('"initialize"')) {
          const payload = {
            jsonrpc: "2.0",
            id: 1,
            result: {
              protocolVersion: "2025-03-26",
              capabilities: { tools: {} },
              serverInfo: { name: "zimatools", version: "0.1.0" },
            },
          };
          res.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": "sess-1" });
          res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, method: req.method }));
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
    const port = (upstream.address() as AddressInfo).port;
    config = {
      upstreamBase: `http://127.0.0.1:${port}`,
      endpoint: "/mcp",
      publicBaseUrl: BASE,
      adminPassword: PASSWORD,
      staticToken: STATIC,
      loadClientMetadata: async () => null,
    };
    app = createConnectorApp(OauthStore.load(null), config);
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  });

  it("répond 401 avec resource_metadata et n'appelle pas le MCP", async () => {
    hits = 0;
    const res = await app.request(`${BASE}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(res.status, 401);
    const www = res.headers.get("www-authenticate") || "";
    assert.match(www, /resource_metadata="https:\/\/zimatools\.jeser\.app\/\.well-known\/oauth-protected-resource\/mcp"/);
    assert.match(www, /scope="zimatools"/);
    assert.equal(www.includes("invalid_token"), false);
    assert.match(res.headers.get("access-control-expose-headers") || "", /WWW-Authenticate/);
    assert.equal(hits, 0);
    const bad = await app.request(`${BASE}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${PASSWORD}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(bad.status, 401);
    assert.match(bad.headers.get("www-authenticate") || "", /error="invalid_token"/);
    assert.equal(hits, 0);
  });

  it("publie les métadonnées, le logo et le préflight", async () => {
    hits = 0;
    const as = await app.request(`${BASE}/.well-known/oauth-authorization-server`);
    const doc = (await as.json()) as Record<string, unknown>;
    assert.equal(doc.issuer, BASE);
    assert.deepEqual(doc.code_challenge_methods_supported, ["S256"]);
    assert.equal(doc.registration_endpoint, `${BASE}/oauth/register`);
    assert.equal(doc.logo_uri, `${BASE}/logo.png`);
    const prm = await app.request(`${BASE}/.well-known/oauth-protected-resource/mcp`);
    const resource = (await prm.json()) as { resource: string; authorization_servers: string[]; logo_uri: string };
    assert.equal(resource.resource, `${BASE}/mcp`);
    assert.deepEqual(resource.authorization_servers, [BASE]);
    assert.equal(resource.logo_uri, `${BASE}/logo.png`);
    const logo = await app.request(`${BASE}/logo.png`);
    assert.equal(logo.status, 200);
    assert.equal(logo.headers.get("content-type"), "image/png");
    const bytes = Buffer.from(await logo.arrayBuffer());
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    const opt = await app.request(`${BASE}/mcp`, { method: "OPTIONS" });
    assert.equal(opt.status, 204);
    assert.equal(hits, 0);
  });

  it("laisse passer le jeton statique et ajoute les icônes initialize", async () => {
    hits = 0;
    const res = await app.request(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${STATIC}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /zimatools-512\.png/);
    assert.match(text, /"websiteUrl":"https:\/\/zimatools\.jeser\.app"/);
    assert.equal(res.headers.get("mcp-session-id"), "sess-1");
    assert.equal(hits, 1);
  });

  it("joue DCR, PKCE, consentement, refresh, rejeu et révocation", async () => {
    const reg = await app.request(`${BASE}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Grok Bot",
        redirect_uris: ["https://example.com/cb"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    assert.equal(reg.status, 201);
    const client = (await reg.json()) as { client_id: string; client_name: string };
    assert.equal(client.client_name, "Grok Bot");
    assert.match(client.client_id, /^ztk_/);

    const denied = await app.request(`${BASE}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["javascript:alert(1)"] }),
    });
    assert.equal(denied.status, 400);

    const missingPkce = await authorize(client.client_id, "https://example.com/cb", "");
    assert.equal(missingPkce.status, 302);
    assert.match(missingPkce.headers.get("location") || "", /error=invalid_request/);

    const consent = await authorize(client.client_id, "https://example.com/cb", CHALLENGE);
    assert.equal(consent.status, 302);
    const requestId = new URL(consent.headers.get("location") || "", BASE).searchParams.get("request");
    assert.ok(requestId);

    const page = await app.request(`${BASE}/oauth/consent?request=${encodeURIComponent(requestId!)}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Grok Bot/);
    assert.equal(html.includes(PASSWORD), false);

    const wrong = await postConsent(requestId!, "mauvais-mot-de-passe", "approve");
    assert.equal(wrong.status, 401);

    const approved = await postConsent(requestId!, PASSWORD, "approve");
    assert.equal(approved.status, 302);
    const back = new URL(approved.headers.get("location") || "");
    assert.equal(`${back.origin}${back.pathname}`, "https://example.com/cb");
    assert.equal(back.searchParams.get("state"), "xyz");
    assert.equal(back.searchParams.get("iss"), BASE);
    const code = back.searchParams.get("code");
    assert.ok(code);

    const badVerifier = await token({
      grant_type: "authorization_code",
      code: `${code!}-nope`,
      redirect_uri: "https://example.com/cb",
      client_id: client.client_id,
      code_verifier: "b".repeat(50),
    });
    assert.equal(badVerifier.status, 400);

    const tokenRes = await token({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: "https://example.com/cb",
      client_id: client.client_id,
      code_verifier: VERIFIER,
    });
    assert.equal(tokenRes.status, 200);
    const tokens = (await tokenRes.json()) as { access_token: string; refresh_token: string; expires_in: number; token_type: string };
    assert.equal(tokens.token_type, "Bearer");
    assert.equal(tokens.expires_in, 3600);
    assert.match(tokens.access_token, /^zta_/);
    assert.match(tokens.refresh_token, /^ztr_/);

    hits = 0;
    const call = await app.request(`${BASE}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokens.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    assert.equal(call.status, 200);
    assert.equal(hits, 1);

    const refreshed = await token({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
    });
    assert.equal(refreshed.status, 200);
    const next = (await refreshed.json()) as { access_token: string; refresh_token: string };
    assert.notEqual(next.access_token, tokens.access_token);
    assert.notEqual(next.refresh_token, tokens.refresh_token);

    const still = await app.request(`${BASE}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${next.access_token}`, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(still.status, 200);

    const reused = await token({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
    });
    assert.equal(reused.status, 400);
    const killed = await app.request(`${BASE}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${next.access_token}`, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(killed.status, 401);

    const replayCode = await token({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: "https://example.com/cb",
      client_id: client.client_id,
      code_verifier: VERIFIER,
    });
    assert.equal(replayCode.status, 400);
  });

  it("accepte le client https://grok.com et refuse une autre origine", async () => {
    const ok = await authorize("https://grok.com", "https://grok.com/oauth/callback", CHALLENGE);
    assert.equal(ok.status, 302);
    assert.match(ok.headers.get("location") || "", /\/oauth\/consent\?request=/);
    const evil = await authorize("https://grok.com", "https://evil.example/cb", CHALLENGE);
    assert.equal(evil.status, 400);
    assert.match(await evil.text(), /refusée|Adresse de retour/);
  });

  it("liste et révoque les applications connectées", async () => {
    const reg = await app.request(`${BASE}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "A révoquer",
        redirect_uris: ["https://example.com/revoke"],
        token_endpoint_auth_method: "client_secret_post",
      }),
    });
    const created = (await reg.json()) as { client_id: string; client_secret: string };
    assert.ok(created.client_secret);
    const consent = await authorize(created.client_id, "https://example.com/revoke", CHALLENGE);
    const requestId = new URL(consent.headers.get("location") || "", BASE).searchParams.get("request");
    const approved = await postConsent(requestId!, PASSWORD, "approve");
    const code = new URL(approved.headers.get("location") || "").searchParams.get("code");
    const withoutSecret = await token({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: "https://example.com/revoke",
      client_id: created.client_id,
      code_verifier: VERIFIER,
    });
    assert.equal(withoutSecret.status, 401);
    const tokenRes = await token({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: "https://example.com/revoke",
      client_id: created.client_id,
      client_secret: created.client_secret,
      code_verifier: VERIFIER,
    });
    assert.equal(tokenRes.status, 200);
    const tokens = (await tokenRes.json()) as { access_token: string; refresh_token: string };

    const session = await app.request(`${BASE}/oauth/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    assert.equal(session.status, 200);
    const cookie = (session.headers.get("set-cookie") || "").split(";")[0];
    const listed = await app.request(`${BASE}/oauth/grants`, { headers: { cookie } });
    const body = (await listed.json()) as { grants: Array<{ id: string; clientName: string }> };
    const grant = body.grants.find((item) => item.clientName === "A révoquer");
    assert.ok(grant);
    const page = await app.request(`${BASE}/oauth/apps`, { headers: { cookie } });
    assert.match(await page.text(), /A révoquer/);

    const revoked = await app.request(`${BASE}/oauth/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.refresh_token, client_id: created.client_id, client_secret: created.client_secret }),
    });
    assert.equal(revoked.status, 200);
    const dead = await app.request(`${BASE}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokens.access_token}`, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(dead.status, 401);

    const removed = await app.request(`${BASE}/oauth/grants/${grant!.id}`, { method: "DELETE", headers: { cookie } });
    assert.equal(removed.status, 404);
  });

  it("bloque le consentement si le mot de passe admin est absent", async () => {
    const locked = createConnectorApp(OauthStore.load(null), { ...config, adminPassword: null, staticToken: null });
    const res = await locked.request(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(res.status, 401);
    const reg = await locked.request(`${BASE}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "X", redirect_uris: ["https://example.com/x"] }),
    });
    const client = (await reg.json()) as { client_id: string };
    const consent = await locked.request(authorizeUrl(client.client_id, "https://example.com/x", CHALLENGE));
    const requestId = new URL(consent.headers.get("location") || "", BASE).searchParams.get("request");
    const post = await locked.request(`${BASE}/oauth/consent`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ request: requestId || "", password: "nimporte", decision: "approve" }),
    });
    assert.equal(post.status, 503);
    assert.match(await post.text(), /ZIMATOOLS_ADMIN_PASSWORD/);
  });

  it("démarre le serveur réel : /mcp anonyme est 401, le jeton statique initialise", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zima-smoke-"));
    const mcpPort = await freePort();
    const internalPort = await freePort();
    const apiPort = await freePort();
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: {
        ...process.env,
        MCP_TRANSPORT: "http",
        MCP_HOST: "127.0.0.1",
        MCP_PORT: String(mcpPort),
        MCP_INTERNAL_PORT: String(internalPort),
        API_PORT: String(apiPort),
        PUBLIC_BASE_URL: BASE,
        ZIMATOOLS_ADMIN_PASSWORD: PASSWORD,
        ZIMATOOLS_MCP_TOKEN: STATIC,
        ZIMATOOLS_DATA_DIR: dir,
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let logs = "";
    child.stdout?.on("data", (chunk) => {
      logs += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      logs += chunk.toString();
    });
    try {
      await waitFor(() => logs.includes("HTTP server listening"), 20000);
      const anon = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });
      assert.equal(anon.status, 401);
      assert.match(anon.headers.get("www-authenticate") || "", /oauth-protected-resource\/mcp/);
      let authed = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${STATIC}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "smoke", version: "0" } },
        }),
      });
      for (let attempt = 0; authed.status === 502 && attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        authed = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${STATIC}`,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "smoke", version: "0" } },
          }),
        });
      }
      const text = await authed.text();
      assert.equal(authed.status, 200, text.slice(0, 500));
      assert.match(text, /zimatools-512/);
      const meta = await fetch(`http://127.0.0.1:${mcpPort}/.well-known/oauth-authorization-server`);
      const doc = (await meta.json()) as { issuer: string };
      assert.equal(doc.issuer, BASE);
    } catch (error) {
      throw new Error(`${(error as Error).message}\n--- logs ---\n${logs}`);
    } finally {
      await stopChild(child);
    }
  });

  function authorizeUrl(clientId: string, redirect: string, challenge: string): string {
    const url = new URL(`${BASE}/oauth/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirect);
    if (challenge) {
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
    }
    url.searchParams.set("state", "xyz");
    url.searchParams.set("resource", `${BASE}/mcp`);
    return url.toString();
  }

  function authorize(clientId: string, redirect: string, challenge: string) {
    return app.request(authorizeUrl(clientId, redirect, challenge));
  }

  function postConsent(requestId: string, password: string, decision: string) {
    return app.request(`${BASE}/oauth/consent`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ request: requestId, password, decision }),
    });
  }

  function token(fields: Record<string, string>) {
    return app.request(`${BASE}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    });
  }
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("port introuvable"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function waitFor(ready: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (ready()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error("le serveur n'a pas démarré"));
      }
    }, 50);
  });
}

function stopChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode) {
      resolve();
      return;
    }
    const done = () => resolve();
    child.once("exit", done);
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    } else {
      child.kill("SIGTERM");
    }
    setTimeout(() => {
      if (child.exitCode === null && child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    }, 2000);
  });
}
