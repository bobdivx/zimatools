import fs from "node:fs";
import path from "node:path";
import {
  ACCESS_TTL_MS,
  CODE_TTL_MS,
  REFRESH_TTL_MS,
  REQUEST_TTL_MS,
  ctEq,
  randomToken,
  sha256Hex,
} from "./crypto.js";
import { cleanName, pkceOk, redirectUriAllowed } from "./policy.js";

export type AuthMethod = "none" | "client_secret_post" | "client_secret_basic";

export interface ClientRecord {
  id: string;
  name: string;
  redirectUris: string[];
  secretHash: string | null;
  authMethod: AuthMethod;
  created: number;
}

export interface GrantRecord {
  id: string;
  clientId: string;
  clientName: string;
  created: number;
  lastUsed: number | null;
  accessHash: string;
  accessExp: number;
  refreshHash: string;
  refreshExp: number;
  /** Empreinte du refresh précédent : un réemploi révoque toute l'autorisation. */
  previousRefreshHash: string | null;
}

interface AuthRequest {
  clientId: string;
  clientName: string;
  redirectUri: string;
  state: string | null;
  challenge: string;
  resource: string | null;
  created: number;
}

interface AuthCode {
  clientId: string;
  clientName: string;
  redirectUri: string;
  challenge: string;
  resource: string | null;
  created: number;
}

interface Persisted {
  clients: ClientRecord[];
  grants: GrantRecord[];
}

const MAX_CLIENTS = 2000;
const MAX_GRANTS = 100;
const REGISTER_PER_HOUR = 30;
const CONSENT_FAILS = 8;
const CONSENT_WINDOW_MS = 15 * 60 * 1000;

export interface RegisterInput {
  name?: string;
  redirectUris: string[];
  authMethod: string | undefined;
}

export interface IssuedTokens {
  access: string;
  refresh: string;
  expiresIn: number;
  scope: string;
}

export class OauthStore {
  private clients: ClientRecord[] = [];
  private grants: GrantRecord[] = [];
  private requests = new Map<string, AuthRequest>();
  private codes = new Map<string, AuthCode>();
  /** code consommé → id d'autorisation, le temps du TTL, pour détecter un rejeu. */
  private consumed = new Map<string, { grantId: string | null; created: number }>();
  private registrations = new Map<string, number[]>();
  private consentFailures = new Map<string, number[]>();

  constructor(
    private readonly file: string | null,
    private readonly nowFn: () => number = () => Date.now(),
  ) {}

  now(): number {
    return this.nowFn();
  }

  static load(file: string | null, nowFn?: () => number): OauthStore {
    const store = new OauthStore(file, nowFn);
    if (!file) return store;
    try {
      const raw = fs.readFileSync(file, "utf8");
      const parsed = JSON.parse(raw) as Persisted;
      store.clients = Array.isArray(parsed.clients) ? parsed.clients : [];
      store.grants = Array.isArray(parsed.grants) ? parsed.grants : [];
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.warn("[zimatools] oauth.json illisible, départ à vide");
      }
    }
    return store;
  }

  private persist(): void {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const body = JSON.stringify({ clients: this.clients, grants: this.grants }, null, 2);
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, body, { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (error) {
      console.warn("[zimatools] autorisations OAuth non enregistrées:", (error as Error).message);
    }
  }

  private purge(now: number): void {
    for (const [id, req] of this.requests) {
      if (now - req.created >= REQUEST_TTL_MS) this.requests.delete(id);
    }
    for (const [hash, code] of this.codes) {
      if (now - code.created >= CODE_TTL_MS) this.codes.delete(hash);
    }
    for (const [hash, used] of this.consumed) {
      if (now - used.created >= ACCESS_TTL_MS) this.consumed.delete(hash);
    }
    for (const [ip, stamps] of this.registrations) {
      const kept = stamps.filter((t) => now - t < 60 * 60 * 1000);
      if (kept.length) this.registrations.set(ip, kept);
      else this.registrations.delete(ip);
    }
    for (const [ip, stamps] of this.consentFailures) {
      const kept = stamps.filter((t) => now - t < CONSENT_WINDOW_MS);
      if (kept.length) this.consentFailures.set(ip, kept);
      else this.consentFailures.delete(ip);
    }
  }

  register(ip: string, input: RegisterInput): { client: ClientRecord; secret: string | null } | { error: "rate" | "redirect" | "method" } {
    const now = this.now();
    this.purge(now);
    if (input.redirectUris.length < 1 || input.redirectUris.length > 5) return { error: "redirect" };
    if (input.redirectUris.some((uri) => !redirectUriAllowed(uri))) return { error: "redirect" };
    const method = input.authMethod || "none";
    if (method !== "none" && method !== "client_secret_post" && method !== "client_secret_basic") {
      return { error: "method" };
    }
    const stamps = this.registrations.get(ip) || [];
    if (stamps.length >= REGISTER_PER_HOUR) return { error: "rate" };
    stamps.push(now);
    this.registrations.set(ip, stamps);
    if (this.clients.length >= MAX_CLIENTS) {
      const used = new Set(this.grants.map((g) => g.clientId));
      const idx = this.clients.findIndex((c) => !used.has(c.id));
      if (idx < 0) return { error: "rate" };
      this.clients.splice(idx, 1);
    }
    const secret = method === "none" ? null : randomToken("zts_");
    const client: ClientRecord = {
      id: randomToken("ztk_"),
      name: cleanName(input.name, "Client MCP"),
      redirectUris: [...input.redirectUris],
      secretHash: secret ? sha256Hex(secret) : null,
      authMethod: method,
      created: now,
    };
    this.clients.push(client);
    this.persist();
    return { client, secret };
  }

  clientById(id: string): ClientRecord | null {
    return this.clients.find((c) => c.id === id) || null;
  }

  /** true si le secret correspond. Les clients publics (method none) n'ont pas de secret. */
  clientSecretOk(client: ClientRecord, secret: string | null): boolean {
    if (client.authMethod === "none") return true;
    if (!secret || !client.secretHash) return false;
    return ctEq(sha256Hex(secret), client.secretHash);
  }

  consentLimited(ip: string): boolean {
    this.purge(this.now());
    return (this.consentFailures.get(ip) || []).length >= CONSENT_FAILS;
  }

  noteConsentFailure(ip: string): void {
    const now = this.now();
    const stamps = this.consentFailures.get(ip) || [];
    stamps.push(now);
    this.consentFailures.set(ip, stamps);
  }

  openRequest(input: {
    clientId: string;
    clientName: string;
    redirectUri: string;
    state: string | null;
    challenge: string;
    resource: string | null;
  }): string {
    const now = this.now();
    this.purge(now);
    const id = randomToken("ztd_");
    this.requests.set(id, { ...input, created: now });
    return id;
  }

  peekRequest(id: string): (AuthRequest & { id: string }) | null {
    this.purge(this.now());
    const req = this.requests.get(id);
    if (!req) return null;
    return { ...req, id };
  }

  /**
   * Décision de consentement. Le code n'est émis qu'une fois ; la demande est retirée.
   * `code` est absent si l'admin refuse.
   */
  decide(id: string, accept: boolean): { redirectUri: string; state: string | null; code?: string } | null {
    const now = this.now();
    this.purge(now);
    const req = this.requests.get(id);
    if (!req) return null;
    this.requests.delete(id);
    if (!accept) return { redirectUri: req.redirectUri, state: req.state };
    const code = randomToken("ztc_");
    this.codes.set(sha256Hex(code), {
      clientId: req.clientId,
      clientName: req.clientName,
      redirectUri: req.redirectUri,
      challenge: req.challenge,
      resource: req.resource,
      created: now,
    });
    return { redirectUri: req.redirectUri, state: req.state, code };
  }

  exchangeCode(input: {
    clientId: string;
    code: string;
    redirectUri: string | null;
    verifier: string;
  }): { ok: true; tokens: IssuedTokens } | { ok: false; error: string } {
    const now = this.now();
    this.purge(now);
    const hash = sha256Hex(input.code);
    const replay = this.consumed.get(hash);
    if (replay) {
      if (replay.grantId) this.dropGrant(replay.grantId);
      return { ok: false, error: "invalid_grant" };
    }
    const found = this.codes.get(hash);
    if (!found) return { ok: false, error: "invalid_grant" };
    this.codes.delete(hash);
    this.consumed.set(hash, { grantId: null, created: found.created });
    if (found.clientId !== input.clientId) return { ok: false, error: "invalid_grant" };
    if (input.redirectUri && input.redirectUri !== found.redirectUri) return { ok: false, error: "invalid_grant" };
    if (!pkceOk(input.verifier, found.challenge)) return { ok: false, error: "invalid_grant" };
    const tokens = this.issue(found.clientId, found.clientName, now);
    const grant = this.grants[this.grants.length - 1];
    this.consumed.set(hash, { grantId: grant?.id || null, created: found.created });
    return { ok: true, tokens };
  }

  refresh(clientId: string, refreshToken: string): { ok: true; tokens: IssuedTokens } | { ok: false; error: string } {
    const now = this.now();
    const hash = sha256Hex(refreshToken);
    const replay = this.grants.find((g) => g.previousRefreshHash && ctEq(g.previousRefreshHash, hash));
    if (replay) {
      this.dropGrant(replay.id);
      return { ok: false, error: "invalid_grant" };
    }
    const grant = this.grants.find((g) => ctEq(g.refreshHash, hash));
    if (!grant || grant.clientId !== clientId || grant.refreshExp <= now) {
      return { ok: false, error: "invalid_grant" };
    }
    const tokens = this.rotate(grant, now);
    return { ok: true, tokens };
  }

  /** Autorisation portée par un access token encore valable. */
  accessGrant(token: string): { id: string; clientId: string; clientName: string } | null {
    const now = this.now();
    const hash = sha256Hex(token);
    const grant = this.grants.find((g) => ctEq(g.accessHash, hash));
    if (!grant || grant.accessExp <= now) return null;
    grant.lastUsed = now;
    return { id: grant.id, clientId: grant.clientId, clientName: grant.clientName };
  }

  /** RFC 7009. true si une autorisation a été retirée. */
  revokeToken(token: string, clientId: string | null): boolean {
    const hash = sha256Hex(token);
    const grant = this.grants.find(
      (g) => ctEq(g.accessHash, hash) || ctEq(g.refreshHash, hash) || (g.previousRefreshHash && ctEq(g.previousRefreshHash, hash)),
    );
    if (!grant) return false;
    if (clientId && clientId !== grant.clientId) return false;
    this.dropGrant(grant.id);
    return true;
  }

  listGrants(): Array<{
    id: string;
    clientId: string;
    clientName: string;
    created: number;
    lastUsed: number | null;
    accessExp: number;
  }> {
    return this.grants.map((g) => ({
      id: g.id,
      clientId: g.clientId,
      clientName: g.clientName,
      created: g.created,
      lastUsed: g.lastUsed,
      accessExp: g.accessExp,
    }));
  }

  revokeGrant(id: string): boolean {
    return this.dropGrant(id);
  }

  private dropGrant(id: string): boolean {
    const before = this.grants.length;
    this.grants = this.grants.filter((g) => g.id !== id);
    const removed = this.grants.length !== before;
    if (removed) this.persist();
    return removed;
  }

  private issue(clientId: string, clientName: string, now: number): IssuedTokens {
    if (this.grants.length >= MAX_GRANTS) this.grants.shift();
    const access = randomToken("zta_");
    const refresh = randomToken("ztr_");
    this.grants.push({
      id: randomToken("ztg_").slice(0, 24),
      clientId,
      clientName,
      created: now,
      lastUsed: null,
      accessHash: sha256Hex(access),
      accessExp: now + ACCESS_TTL_MS,
      refreshHash: sha256Hex(refresh),
      refreshExp: now + REFRESH_TTL_MS,
      previousRefreshHash: null,
    });
    this.persist();
    return { access, refresh, expiresIn: Math.floor(ACCESS_TTL_MS / 1000), scope: "zimatools" };
  }

  private rotate(grant: GrantRecord, now: number): IssuedTokens {
    const access = randomToken("zta_");
    const refresh = randomToken("ztr_");
    grant.previousRefreshHash = grant.refreshHash;
    grant.accessHash = sha256Hex(access);
    grant.accessExp = now + ACCESS_TTL_MS;
    grant.refreshHash = sha256Hex(refresh);
    grant.refreshExp = now + REFRESH_TTL_MS;
    grant.lastUsed = now;
    this.persist();
    return { access, refresh, expiresIn: Math.floor(ACCESS_TTL_MS / 1000), scope: "zimatools" };
  }
}

export function resolveOauthFile(): string | null {
  const dir = process.env.ZIMATOOLS_DATA_DIR?.trim();
  if (dir) return path.join(dir, "oauth.json");
  if (process.platform !== "win32") {
    try {
      fs.accessSync("/data", fs.constants.W_OK);
      return "/data/oauth.json";
    } catch {
      /* pas de volume */
    }
  }
  return path.join(process.cwd(), ".data", "oauth.json");
}
