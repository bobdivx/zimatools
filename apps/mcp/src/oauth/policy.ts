import { ctEq, pkceS256 } from "./crypto.js";

const DENY_SCHEMES = new Set([
  "javascript",
  "data",
  "file",
  "vbscript",
  "blob",
  "about",
  "ftp",
  "ws",
  "wss",
]);

export function isLoopbackHost(hostport: string): boolean {
  const raw = hostport.trim().toLowerCase();
  const host = raw.startsWith("[")
    ? raw.slice(1, raw.indexOf("]"))
    : raw.split(":")[0];
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "0.0.0.0";
}

/** Adresse utilisable depuis Internet (bloque loopback, LAN, lien-local, métadonnées). */
export function isPublicIp(ip: string): boolean {
  const lower = ip.trim().toLowerCase();
  if (lower.includes(":")) {
    if (lower === "::1" || lower === "::") return false;
    if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return false;
    if (lower.startsWith("::ffff:")) return isPublicIp(lower.slice("::ffff:".length));
    return true;
  }
  const parts = lower.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a >= 224) return false;
  return true;
}

export function cleanName(name: string | undefined, fallback: string): string {
  const cleaned = (name || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

/** Redirect d'enregistrement : https, http loopback, ou schéma natif (cursor://). */
export function redirectUriAllowed(uri: string): boolean {
  if (!uri || uri.length > 512 || uri.includes("#") || /[\s\u0000-\u001f]/.test(uri)) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  const scheme = url.protocol.replace(":", "").toLowerCase();
  if (DENY_SCHEMES.has(scheme)) return false;
  if (scheme === "https") return Boolean(url.hostname);
  if (scheme === "http") return isLoopbackHost(url.hostname);
  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) return false;
  return Boolean(url.hostname || (url.pathname && url.pathname !== "/"));
}

export function originOf(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (!url.host) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export interface RedirectClient {
  redirectUris: string[];
  originRule: string | null;
}

/**
 * Correspondance redirect : exacte, loopback à port libre (RFC 8252) pour un client DCR,
 * ou même site / sous-domaine https pour un client_id URL sans document.
 */
export function redirectMatches(client: RedirectClient, redirectUri: string): boolean {
  if (client.redirectUris.includes(redirectUri)) return true;
  let req: URL;
  try {
    req = new URL(redirectUri);
  } catch {
    return false;
  }
  if (req.protocol === "http:" && isLoopbackHost(req.hostname)) {
    for (const registered of client.redirectUris) {
      try {
        const known = new URL(registered);
        if (
          known.protocol === "http:" &&
          known.hostname === req.hostname &&
          known.pathname === req.pathname
        ) {
          return true;
        }
      } catch {
        /* ignore */
      }
    }
  }
  if (!client.originRule) return false;
  let base: URL;
  try {
    base = new URL(client.originRule);
  } catch {
    return false;
  }
  if (req.protocol !== "https:" || base.protocol !== "https:" || req.hash) return false;
  const rh = req.hostname.toLowerCase();
  const bh = base.hostname.toLowerCase();
  if (req.port !== base.port) return false;
  return rh === bh || rh.endsWith(`.${bh}`);
}

export function displayNameForHost(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (h === "grok.com" || h.endsWith(".grok.com") || h === "x.ai" || h.endsWith(".x.ai")) return "Grok";
  return h.slice(0, 80);
}

export interface UrlClient {
  name: string;
  redirectUris: string[];
  originRule: string | null;
}

/** Client ID Metadata Document, ou règle « même origine » si le document est absent. */
export function clientFromUrl(clientId: string, doc: unknown): { ok: true; client: UrlClient } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return { ok: false, error: "client_id URL invalide" };
  }
  if (url.protocol !== "https:" || !url.hostname || url.hash || url.username || url.password) {
    return { ok: false, error: "client_id URL invalide" };
  }
  const record = doc && typeof doc === "object" ? (doc as Record<string, unknown>) : null;
  if (record && typeof record.client_id === "string" && record.client_id !== clientId) {
    return { ok: false, error: "client_id du document différent de l'URL" };
  }
  const declared = Array.isArray(record?.redirect_uris)
    ? record.redirect_uris.filter((item): item is string => typeof item === "string")
    : [];
  const docName = typeof record?.client_name === "string" ? record.client_name : undefined;
  if (declared.length > 0) {
    if (declared.length > 10 || declared.some((uri) => !redirectUriAllowed(uri))) {
      return { ok: false, error: "redirect_uris du document refusées" };
    }
    return {
      ok: true,
      client: {
        name: cleanName(docName, url.hostname),
        redirectUris: declared,
        originRule: null,
      },
    };
  }
  return {
    ok: true,
    client: {
      name: cleanName(docName, displayNameForHost(url.hostname)),
      redirectUris: [],
      originRule: originOf(clientId),
    },
  };
}

export function validVerifier(verifier: string): boolean {
  return verifier.length >= 43 && verifier.length <= 128 && /^[A-Za-z0-9._~-]+$/.test(verifier);
}

export function validChallenge(challenge: string): boolean {
  return challenge.length >= 43 && challenge.length <= 128 && /^[A-Za-z0-9_-]+$/.test(challenge);
}

export function pkceOk(verifier: string, challenge: string): boolean {
  if (!validVerifier(verifier)) return false;
  return ctEq(pkceS256(verifier), challenge);
}

/** RFC 8707 : la ressource doit être cette instance. */
export function resourceOk(base: string, resource: string | null): boolean {
  if (!resource) return true;
  const r = resource.trim().replace(/\/$/, "");
  const b = base.trim().replace(/\/$/, "");
  return r === b || r.startsWith(`${b}/`);
}

export function appendQuery(uri: string, params: Array<[string, string]>): string {
  const url = new URL(uri);
  for (const [key, value] of params) url.searchParams.append(key, value);
  return url.toString();
}
