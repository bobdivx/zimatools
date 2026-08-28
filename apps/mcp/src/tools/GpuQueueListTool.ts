import { MCPTool } from "mcp-framework";
import { z } from "zod";
import { gpuArbiter } from "../lib/gpuArbiter.js";

interface GpuQueueListInput {
  dummy?: string;
}

class GpuQueueListTool extends MCPTool<GpuQueueListInput> {
  name = "gpu.queue_list";
  description = "Liste le lease GPU courant et la file d'attente (priorite exclusive VRAM).";

  schema = {
    dummy: {
      type: z.string().optional(),
      description: "ignore",
    },
  };

  async execute() {
    return JSON.stringify(gpuArbiter.queueList(), null, 2);
  }
}

export default GpuQueueListTool;
