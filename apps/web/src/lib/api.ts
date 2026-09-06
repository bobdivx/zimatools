export function apiBase() {
  const env = import.meta.env.PUBLIC_API_URL;
  if (env) return env.replace(/\/$/, "");
  // Same-origin: le serveur web proxifie /api et /health vers mcp.
  return "";
}

export function publicHost() {
  if (typeof window === "undefined") return "127.0.0.1";
  return window.location.hostname;
}

export async function jsonFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export function initials(title: string) {
  const parts = title.replace(/^[^a-zA-Z0-9]+/, "").split(/[\s._-]+/).filter(Boolean);
  const letters = (parts[0]?.[0] || "?") + (parts[1]?.[0] || parts[0]?.[1] || "");
  return letters.toUpperCase().slice(0, 2);
}

export function isIconUrl(icon?: string | null) {
  if (!icon) return false;
  return /^(https?:|data:|\/)/i.test(icon);
}
