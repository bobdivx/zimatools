import { MCPTool } from "mcp-framework";
import { z } from "zod";
import { DockerSSH } from "../lib/dockerSSH.js";

interface RestartDockerContainerInput {
  container_id: string;
}

class RestartDockerContainerTool extends MCPTool<RestartDockerContainerInput> {
  name = "restart_docker_container_zimaos";
  description = "Restart a Docker container on ZimaOS. This will stop and then start the container.";

  schema = {
    container_id: {
      type: z.string(),
      description: "The Docker container ID or name to restart",
    },
  };

  async execute(input: RestartDockerContainerInput) {
    try {
      await DockerSSH.restartContainer(input.container_id);
      return `Container ${input.container_id} restarted successfully`;
    } catch (error: any) {
      return `Failed to restart container ${input.container_id}: ${error.message || error}`;
    }
  }
}

export default RestartDockerContainerTool;
