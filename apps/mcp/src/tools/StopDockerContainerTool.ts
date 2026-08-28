import { MCPTool } from "mcp-framework";
import { z } from "zod";
import { DockerSSH } from "../lib/dockerSSH.js";

interface StopDockerContainerInput {
  container_id: string;
}

class StopDockerContainerTool extends MCPTool<StopDockerContainerInput> {
  name = "stop_docker_container_zimaos";
  description = "Stop a running Docker container on ZimaOS. This will gracefully shut down the container.";

  schema = {
    container_id: {
      type: z.string(),
      description: "The Docker container ID or name to stop",
    },
  };

  async execute(input: StopDockerContainerInput) {
    try {
      await DockerSSH.stopContainer(input.container_id);
      return `Container ${input.container_id} stopped successfully`;
    } catch (error: any) {
      return `Failed to stop container ${input.container_id}: ${error.message || error}`;
    }
  }
}

export default StopDockerContainerTool;
