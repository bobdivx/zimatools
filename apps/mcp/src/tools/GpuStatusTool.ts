import { MCPTool } from "mcp-framework";
import { z } from "zod";
import { gpuArbiter } from "../lib/gpuArbiter.js";

interface GpuStatusInput {
  dummy?: string;
}

class GpuStatusTool extends MCPTool<GpuStatusInput> {
  name = "gpu.status";
  description =
    "Statut GPU ZimaTools: nvidia-smi (ou stub), lease exclusif VRAM, file d'attente et priorites (Popcorn > Ollama > agents).";

  schema = {
    dummy: {
      type: z.string().optional(),
      description: "ignore",
    },
  };

  async execute() {
    return JSON.stringify(await gpuArbiter.status(), null, 2);
  }
}

export default GpuStatusTool;
