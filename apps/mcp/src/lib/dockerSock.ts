import http from "node:http";

const SOCK = process.env.DOCKER_SOCK || "/var/run/docker.sock";

export function dockerSockRequest(
  method: string,
  apiPath: string,
  timeoutMs = 8000,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: SOCK,
        path: apiPath,
        method,
        timeout: timeoutMs,
        headers: { Host: "localhost", Accept: "application/json" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => {
          resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString("utf8") });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("docker.sock timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

export async function dockerSockJson<T>(method: string, apiPath: string): Promise<T> {
  const { status, body } = await dockerSockRequest(method, apiPath);
  if (status >= 400) {
    throw new Error(`Docker API ${status} ${apiPath}: ${body.slice(0, 240)}`);
  }
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
