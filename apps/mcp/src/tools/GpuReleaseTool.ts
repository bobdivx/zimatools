import { MCPTool } from "mcp-framework";
import { z } from "zod";
import { gpuArbiter } from "../lib/gpuArbiter.js";

interface GpuReleaseInput {
  client?: string;
  leaseId?: string;
}

class GpuReleaseTool extends MCPTool<GpuReleaseInput> {
  name = "gpu.release";
  description =
    "Libere un lease / reservation GPU (client ou leaseId). Sans argument, libere tous les holders. Promeut ensuite la file si assez de VRAM.";

  schema = {
    client: {
      type: z.string().optional(),
      description: "Client qui relache (popcorn, ollama, agents, ...)",
    },
    leaseId: {
      type: z.string().optional(),
      description: "UUID du lease a relacher",
    },
  };

  async execute(input: GpuReleaseInput) {
    return JSON.stringify(
      await gpuArbiter.release({ client: input.client, leaseId: input.leaseId }),
      null,
      2,
    );
  }
}

export default GpuReleaseTool;
