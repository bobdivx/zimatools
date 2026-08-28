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
    "Libere le lease GPU exclusif. Passe ensuite au premier de la file (priorite puis FIFO).";

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
      gpuArbiter.release({ client: input.client, leaseId: input.leaseId }),
      null,
      2,
    );
  }
}

export default GpuReleaseTool;
