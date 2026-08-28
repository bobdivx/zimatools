import { MCPTool } from "mcp-framework";
import { z } from "zod";
import { gpuArbiter } from "../lib/gpuArbiter.js";

interface GpuAcquireInput {
  client: string;
  ttlSeconds?: number;
}

class GpuAcquireTool extends MCPTool<GpuAcquireInput> {
  name = "gpu.acquire";
  description =
    "Demande un lease exclusif de VRAM. Popcorn (priorite 100) preempte Ollama (50) et agents (25). Sinon la requete est mise en file.";

  schema = {
    client: {
      type: z.string(),
      description: "Identifiant du client: popcorn, ollama, agents, ou un nom libre",
    },
    ttlSeconds: {
      type: z.number().optional(),
      description: "Duree du lease en secondes (optionnel, 0 = jusqu'a release)",
    },
  };

  async execute(input: GpuAcquireInput) {
    return JSON.stringify(gpuArbiter.acquire(input.client, input.ttlSeconds), null, 2);
  }
}

export default GpuAcquireTool;
