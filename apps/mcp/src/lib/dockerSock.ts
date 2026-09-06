import http from "node:http";

const SOCK = process.env.DOCKER_SOCK || "/var/run/docker.sock";

export type DockerSockOptions = {
  timeoutMs?: number;
  body?: string | Buffer | null;
  headers?: Record<string, string>;
};

export function dockerSockRequest(
  method: string,
  apiPath: string,
  timeoutMsOrOpts: number | DockerSockOptions = 8000,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  const opts: DockerSockOptions =
    typeof timeoutMsOrOpts === "number" ? { timeoutMs: timeoutMsOrOpts } : timeoutMsOrOpts;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const body = opts.body ?? null;
  const extraHeaders = opts.headers || {};

  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = {
      Host: "localhost",
      Accept: "application/json",
      ...extraHeaders,
    };
    if (body != null) {
      const len = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body);
      headers["Content-Length"] = len;
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
    }

    const req = http.request(
      {
        socketPath: SOCK,
        path: apiPath,
        method,
        timeout: timeoutMs,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
          });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("docker.sock timeout"));
    });
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

export async function dockerSockJson<T>(
  method: string,
  apiPath: string,
  opts?: DockerSockOptions,
): Promise<T> {
  const { status, body } = await dockerSockRequest(method, apiPath, opts);
  if (status >= 400) {
    throw new Error(`Docker API ${status} ${apiPath}: ${body.slice(0, 240)}`);
  }
  if (!body || !body.trim()) return undefined as T;
  return JSON.parse(body) as T;
}

export async function dockerSockAvailable(): Promise<boolean> {
  try {
    const { status, body } = await dockerSockRequest("GET", "/_ping", 2000);
    return status === 200 && body.trim().toUpperCase() === "OK";
  } catch {
    return false;
  }
}

/** Split `repo:tag` or `repo@digest` for Docker Engine pull API. */
export function parseImageRef(image: string): { fromImage: string; tag?: string } {
  const raw = image.trim();
  if (!raw) throw new Error("empty image ref");
  if (raw.includes("@")) {
    const [name, digest] = raw.split("@");
    return { fromImage: name, tag: digest };
  }
  const lastSlash = raw.lastIndexOf("/");
  const lastColon = raw.lastIndexOf(":");
  if (lastColon > lastSlash) {
    return { fromImage: raw.slice(0, lastColon), tag: raw.slice(lastColon + 1) };
  }
  return { fromImage: raw, tag: "latest" };
}

export async function dockerPullImage(image: string, timeoutMs = 300_000): Promise<void> {
  const { fromImage, tag } = parseImageRef(image);
  const qs = new URLSearchParams({ fromImage });
  if (tag) qs.set("tag", tag);
  const { status, body } = await dockerSockRequest("POST", `/images/create?${qs}`, {
    timeoutMs,
  });
  if (status >= 400) {
    throw new Error(`docker pull failed (${status}): ${body.slice(0, 240)}`);
  }
  // Streaming JSON lines may contain {"error":"..."}
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const msg = JSON.parse(t) as { error?: string };
      if (msg.error) throw new Error(msg.error);
    } catch (e: unknown) {
      if (e instanceof SyntaxError) continue;
      throw e;
    }
  }
}
