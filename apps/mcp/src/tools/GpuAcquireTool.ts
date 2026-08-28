import { MCPTool } from "mcp-framework";
import { z } from "zod";
import { gpuArbiter } from "../lib/gpuArbiter.js";

interface GpuAcquireInput {
  client: string;
  ttlSeconds?: number;
  vramMiB?: number;
  exclusive?: boolean;
  wait?: boolean;
  timeoutSeconds?: number;
}

class GpuAcquireTool extends MCPTool<GpuAcquireInput> {
  name = "gpu.acquire";
  description =
    "Demande un lease GPU. exclusive=true ou popcorn (prio >= 100) prend toute la carte. Sinon reservation partagee (vramMiB, defaut 2048 ou le reste libre). Si wait=true the tool blocks until the GPU is granted or timeout; you get queued then granted.";

  schema = {
    client: {
      type: z.string(),
      description: "Identifiant du client: popcorn, ollama, agents, ou un nom libre",
    },
    ttlSeconds: {
      type: z.number().optional(),
      description: "Duree du lease en secondes (optionnel, 0 = jusqu'a release)",
    },
    vramMiB: {
      type: z.number().optional(),
      description: "Reservation VRAM en MiB (mode partage). Defaut 2048, ou le reste libre s'il est inferieur.",
    },
    exclusive: {
      type: z.boolean().optional(),
      description: "Si true, prend toute la carte (comme popcorn). Defaut: true si priorite >= 100.",
    },
    wait: {
      type: z.boolean().optional(),
      description:
        "Si true, l'outil bloque jusqu'au grant ou au timeout. Vous recevez d'abord queued puis granted. Defaut false.",
    },
    timeoutSeconds: {
      type: z.number().optional(),
      description: "Timeout du wait en secondes (defaut 120). Ignore si wait=false.",
    },
  };

  async execute(input: GpuAcquireInput) {
    const opts = { vramMiB: input.vramMiB, exclusive: input.exclusive };
    if (input.wait) {
      const timeoutMs = Math.max(0, Math.round((input.timeoutSeconds ?? 120) * 1000));
      return JSON.stringify(
        await gpuArbiter.waitForGrant(input.client, timeoutMs, { ...opts, ttlSeconds: input.ttlSeconds }),
        null,
        2,
      );
    }
    return JSON.stringify(await gpuArbiter.acquire(input.client, input.ttlSeconds, opts), null, 2);
  }
}

export default GpuAcquireTool;
