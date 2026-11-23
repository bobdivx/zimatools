import crypto from "node:crypto";

/** Durées alignées sur le connecteur Grok Puck / DevForge. */
export const SCOPE = "zimatools";
export const ACCESS_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const CODE_TTL_MS = 5 * 60 * 1000;
export const REQUEST_TTL_MS = 10 * 60 * 1000;
export const ADMIN_COOKIE_TTL_MS = 60 * 60 * 1000;
export const ADMIN_COOKIE = "zima_admin";

export function randomToken(prefix: string): string {
  return prefix + crypto.randomBytes(32).toString("base64url");
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function pkceS256(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

/** Comparaison indépendante du contenu (longueur incluse via empreinte fixe). */
export function tokenMatches(presented: string, expected: string | null | undefined): boolean {
  if (!expected) return false;
  const a = crypto.createHash("sha256").update(presented).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export function ctEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

export function signAdminCookie(password: string, expMs: number): string {
  const msg = `v1.${expMs}`;
  const sig = crypto.createHmac("sha256", password).update(msg).digest("base64url");
  return `${msg}.${sig}`;
}

export function verifyAdminCookie(password: string | null, cookie: string | null, now: number): boolean {
  if (!password || !cookie) return false;
  const parts = cookie.split(".");
  if (parts.length !== 3) return false;
  const [ver, expStr, sig] = parts;
  if (ver !== "v1") return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= now) return false;
  const expected = crypto.createHmac("sha256", password).update(`${ver}.${expStr}`).digest("base64url");
  return ctEq(expected, sig);
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return part.slice(idx + 1).trim();
    }
  }
  return null;
}
