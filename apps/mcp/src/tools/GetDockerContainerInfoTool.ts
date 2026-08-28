import { MCPTool } from "mcp-framework";
import { z } from "zod";
import { DockerSSH } from "../lib/dockerSSH.js";

interface GetDockerContainerInfoInput {
  container_id: string;
}

class GetDockerContainerInfoTool extends MCPTool<GetDockerContainerInfoInput> {
  name = "get_docker_container_info_zimaos";
  description = "Get detailed information about a specific Docker container on ZimaOS. Returns comprehensive details including configuration, state, network settings, and resource usage.";

  schema = {
    container_id: {
      type: z.string(),
      description: "The Docker container ID or name",
    },
  };

  async execute(input: GetDockerContainerInfoInput) {
    try {
      const info = await DockerSSH.getContainerInfo(input.container_id);
      return JSON.stringify(info, null, 2);
    } catch (error: any) {
      return `Failed to get container info: ${error.message || error}`;
    }
  }
}

export default GetDockerContainerInfoTool;
