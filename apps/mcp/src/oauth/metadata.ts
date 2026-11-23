import { lookup } from "node:dns/promises";
import { SCOPE } from "./crypto.js";
import { isPublicIp } from "./policy.js";

export function authorizationServerDoc(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [SCOPE],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${base}/mcp`,
    logo_uri: `${base}/logo.png`,
  };
}

export function protectedResourceDoc(base: string, endpoint: string) {
  return {
    resource: `${base}${endpoint}`,
    authorization_servers: [base],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "ZimaTools",
    resource_documentation: `${base}/mcp`,
    logo_uri: `${base}/logo.png`,
  };
}

export function wwwAuthenticate(base: string | null, endpoint: string, invalidToken: boolean): string {
  if (!base) {
    return invalidToken
      ? `Bearer realm="zimatools", scope="${SCOPE}", error="invalid_token"`
      : `Bearer realm="zimatools", scope="${SCOPE}"`;
  }
  const metadata = `${base}/.well-known/oauth-protected-resource${endpoint}`;
  let value = `Bearer resource_metadata="${metadata}", scope="${SCOPE}"`;
  if (invalidToken) {
    value += `, error="invalid_token", error_description="Jeton absent, invalide ou révoqué"`;
  }
  return value;
}

/** Document JSON d'un client_id https, ou null (règle d'origine). Refuse les IP privées. */
export async function fetchClientMetadata(rawUrl: string): Promise<unknown | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname) return null;
  const port = Number(url.port || 443);
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    return null;
  }
  if (!addresses.length || addresses.some((item) => !isPublicIp(item.address))) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(url, {
      redirect: "manual",
      signal: ctrl.signal,
      headers: { accept: "application/json", "user-agent": "ZimaTools-OAuth/1.0" },
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 64 * 1024) return null;
    const json = JSON.parse(Buffer.from(buf).toString("utf8")) as unknown;
    return json && typeof json === "object" ? json : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
