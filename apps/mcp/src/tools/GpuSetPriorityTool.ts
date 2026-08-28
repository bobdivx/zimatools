import { MCPTool } from "mcp-framework";
import { z } from "zod";
import { gpuArbiter } from "../lib/gpuArbiter.js";

interface GpuSetPriorityInput {
  client: string;
  priority: number;
}

class GpuSetPriorityTool extends MCPTool<GpuSetPriorityInput> {
  name = "gpu.set_priority";
  description =
    "Definit la priorite d'un client GPU (defaut: popcorn=100, ollama=50, agents=25). Une priorite plus haute preempte le lease.";

  schema = {
    client: {
      type: z.string(),
      description: "Identifiant du client (popcorn, ollama, agents, ...)",
    },
    priority: {
      type: z.number(),
      description: "Priorite entiere (0-1000). Plus haut = plus prioritaire.",
    },
  };

  async execute(input: GpuSetPriorityInput) {
    return JSON.stringify(gpuArbiter.setPriority(input.client, input.priority), null, 2);
  }
}

export default GpuSetPriorityTool;
