import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";
import { bindOauthAccessLookup } from "../src/oauth/accessLookup.js";
import { resetLoginLimiter } from "../src/lib/dashboardAuth.js";

const PASSWORD = "phrase-admin-tableau";
const STATIC = "static-token-tableau-ok";
const WEBHOOK = "whsec-do-not-leak-please";

process.env.ZIMATOOLS_ADMIN_PASSWORD = PASSWORD;
process.env.ZIMATOOLS_MCP_TOKEN = STATIC;
process.env.IMAGE_WEBHOOK_SECRET = WEBHOOK;
delete process.env.ZIMAOS_SSH_HOST;
delete process.env.ZIMAOS_API_BASE;
delete process.env.ZIMAOS_SSH_PASSWORD;
process.env.ZIMATOOLS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zima-api-"));
process.env.PUBLIC_BASE_URL = "https://zimatools.jeser.app";

const { createHttpApp } = await import("../src/httpApi.js");

const app = createHttpApp();

function cookieOf(header: string | null): string {
  const pair = (header || "").split(";")[0];
  assert.ok(pair.startsWith("zima_admin="), header);
  return pair;
}

describe("API dashboard", () => {
  before(() => {
    resetLoginLimiter();
    bindOauthAccessLookup(() => false);
  });

  after(() => {
    bindOauthAccessLookup(() => false);
    resetLoginLimiter();
  });

  const closed = [
    ["GET", "/api/gpu/status"],
    ["GET", "/api/gpu/queue"],
    ["GET", "/api/gpu/events"],
    ["POST", "/api/gpu/acquire"],
    ["POST", "/api/gpu/release"],
    ["POST", "/api/gpu/priority"],
    ["GET", "/api/apps"],
    ["GET", "/api/apps/watchdog"],
    ["PATCH", "/api/apps/watchdog"],
    ["POST", "/api/apps/watchdog/run"],
    ["GET", "/api/docker/containers"],
    ["POST", "/api/docker/containers/abc/start"],
    ["POST", "/api/docker/containers/abc/stop"],
    ["DELETE", "/api/docker/containers/abc"],
  ] as const;

  for (const [method, path] of closed) {
    it(`${method} ${path} sans jeton répond 401`, async () => {
      const res = await app.request(path, {
        method,
        headers: {
          "x-forwarded-for": "127.0.0.1",
          "x-real-ip": "10.0.0.8",
          "content-type": "application/json",
        },
        body: method === "GET" ? undefined : "{}",
      });
      assert.equal(res.status, 401);
      assert.match(res.headers.get("www-authenticate") || "", /Bearer realm="zimatools"/);
      const text = await res.text();
      assert.equal(text.includes(WEBHOOK), false);
      assert.equal(text.includes(PASSWORD), false);
    });
  }

  it("laisse /health, le catalogue MCP et la session lisibles", async () => {
    const health = await app.request("/health");
    assert.equal(health.status, 200);
    const session = await app.request("/api/session");
    assert.equal(session.status, 200);
    const body = (await session.json()) as { authenticated: boolean; passwordConfigured: boolean };
    assert.equal(body.authenticated, false);
    assert.equal(body.passwordConfigured, true);
    const mcp = await app.request("/api/mcp");
    assert.equal(mcp.status, 200);
  });

  it("le webhook sans secret ne déclenche rien", async () => {
    const res = await app.request("/api/apps/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
      body: "{}",
    });
    assert.equal(res.status, 401);
    assert.equal((await res.text()).includes(WEBHOOK), false);
  });

  it("ouvre la file GPU avec le cookie, le jeton statique ou un access token OAuth", async () => {
    const login = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    assert.equal(login.status, 200);
    const cookie = cookieOf(login.headers.get("set-cookie"));
    assert.match(login.headers.get("set-cookie") || "", /HttpOnly/);
    assert.match(login.headers.get("set-cookie") || "", /Secure/);

    const withCookie = await app.request("/api/gpu/queue", { headers: { cookie } });
    assert.equal(withCookie.status, 200);

    const asPassword = await app.request("/api/gpu/queue", {
      headers: { authorization: `Bearer ${PASSWORD}` },
    });
    assert.equal(asPassword.status, 401);

    const withStatic = await app.request("/api/docker/containers", {
      headers: { authorization: `Bearer ${STATIC}`, "x-forwarded-for": "10.1.1.1" },
    });
    assert.notEqual(withStatic.status, 401);

    bindOauthAccessLookup((token) => token === "oauth-access-test");
    const withOauth = await app.request("/api/gpu/queue", {
      headers: { authorization: "Bearer oauth-access-test" },
    });
    assert.notEqual(withOauth.status, 401);
    bindOauthAccessLookup(() => false);
    const revoked = await app.request("/api/gpu/queue", {
      headers: { authorization: "Bearer oauth-access-test" },
    });
    assert.equal(revoked.status, 401);

    const bye = await app.request("/api/session/logout", { method: "POST", headers: { cookie } });
    assert.equal(bye.status, 200);
    assert.match(bye.headers.get("set-cookie") || "", /Max-Age=0/);
    const replay = await app.request("/api/gpu/queue", { headers: { cookie } });
    assert.equal(replay.status, 401);
  });

  it("plafonne les mots de passe faux sans tenir compte de l'IP", async () => {
    resetLoginLimiter();
    for (let i = 0; i < 8; i += 1) {
      const res = await app.request("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${i}` },
        body: JSON.stringify({ password: "non" }),
      });
      assert.equal(res.status, 401);
    }
    const locked = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    assert.equal(locked.status, 429);
    resetLoginLimiter();
  });
});
