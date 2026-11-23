import {
  ADMIN_COOKIE,
  ADMIN_COOKIE_TTL_MS,
  readCookie,
  signAdminCookie,
  tokenMatches,
  verifyAdminCookie,
} from "../oauth/crypto.js";
import { oauthAccessValid } from "../oauth/accessLookup.js";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 8;
const failures: number[] = [];

function blank(value: string | undefined): string | null {
  const trimmed = (value || "").trim();
  return trimmed ? trimmed : null;
}

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  return match ? match[1] : null;
}

function prune(now: number) {
  while (failures.length && now - failures[0] > WINDOW_MS) failures.shift();
}

/**
 * Compteur global, pas par IP. X-Forwarded-For est posé par le client ou par
 * cloudflared : s'en servir permettrait de contourner le plafond ou de
 * verrouiller quelqu'un d'autre.
 */
export function loginLimited(now = Date.now()): boolean {
  prune(now);
  return failures.length >= MAX_FAILS;
}

export function noteLoginFailure(now = Date.now()): void {
  prune(now);
  failures.push(now);
}

export function resetLoginLimiter(): void {
  failures.length = 0;
}

export function passwordConfigured(): boolean {
  return Boolean(blank(process.env.ZIMATOOLS_ADMIN_PASSWORD));
}

export function adminPasswordMatches(presented: string): boolean {
  const password = blank(process.env.ZIMATOOLS_ADMIN_PASSWORD);
  if (!password) return false;
  return tokenMatches(presented, password);
}

export function adminCookieValid(cookieHeader: string | undefined, now = Date.now()): boolean {
  return verifyAdminCookie(blank(process.env.ZIMATOOLS_ADMIN_PASSWORD), readCookie(cookieHeader, ADMIN_COOKIE), now);
}

/**
 * Cookie admin, jeton statique, ou jeton d'accès OAuth.
 * Le mot de passe admin n'est pas accepté comme Bearer : il ne doit pas
 * finir dans des journaux d'Authorization. Aucune exception « IP locale » :
 * le proxy public et cette API partagent 127.0.0.1 (sidecar), et
 * X-Forwarded-For n'est pas une preuve d'origine.
 */
export function dashboardAuthorized(
  authorization: string | undefined,
  cookieHeader: string | undefined,
  now = Date.now(),
): boolean {
  if (adminCookieValid(cookieHeader, now)) return true;
  const token = bearer(authorization);
  if (!token) return false;
  if (tokenMatches(token, blank(process.env.ZIMATOOLS_MCP_TOKEN))) return true;
  return oauthAccessValid(token);
}

export function sessionCookie(now: number, secure: boolean): string | null {
  const password = blank(process.env.ZIMATOOLS_ADMIN_PASSWORD);
  if (!password) return null;
  const value = encodeURIComponent(signAdminCookie(password, now + ADMIN_COOKIE_TTL_MS));
  const parts = [
    `${ADMIN_COOKIE}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.floor(ADMIN_COOKIE_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearedSessionCookie(secure: boolean): string {
  const parts = [`${ADMIN_COOKIE}=`, "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function cookieSecure(forwardedProto: string | undefined): boolean {
  const base = (process.env.PUBLIC_BASE_URL || "").trim();
  if (base.startsWith("https://")) return true;
  return (forwardedProto || "").split(",")[0].trim() === "https";
}

const PUBLIC_GET = new Set(["/api/mcp", "/api/mcp/tools", "/api/session"]);

/** Routes sans données NAS. Le webhook a son propre secret, vérifié dans le handler. */
export function apiRouteIsPublic(method: string, path: string): boolean {
  const verb = method.toUpperCase();
  if (verb === "OPTIONS") return true;
  if (verb === "GET" && PUBLIC_GET.has(path)) return true;
  if (verb === "POST" && (path === "/api/session" || path === "/api/session/logout")) return true;
  if (verb === "POST" && path === "/api/apps/webhook") return true;
  return false;
}
