import { MCPTool } from "mcp-framework";
import { z } from "zod";
import { DockerAPI } from "../lib/getAxios.js";

interface StartDockerContainerInput {
  container_id: string;
}

class StartDockerContainerTool extends MCPTool<StartDockerContainerInput> {
  name = "start_docker_container_zimaos";
  description = "Start a stopped Docker container on ZimaOS. This will bring the container to a running state.";

  schema = {
    container_id: {
      type: z.string(),
      description: "The Docker container ID or name to start",
    },
  };

  async execute(input: StartDockerContainerInput) {
    try {
      await DockerAPI().startContainer(input.container_id);
      return `Container ${input.container_id} started successfully`;
    } catch (error: any) {
      return `Failed to start container ${input.container_id}: ${error.message || error}`;
    }
  }
}

export default StartDockerContainerTool;
