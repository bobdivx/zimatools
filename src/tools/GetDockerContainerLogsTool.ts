import { MCPTool } from "mcp-framework";
import { z } from "zod";
import { DockerSSH } from "../lib/dockerSSH.js";

interface GetDockerContainerLogsInput {
  container_id: string;
  tail?: number;
}

class GetDockerContainerLogsTool extends MCPTool<GetDockerContainerLogsInput> {
  name = "get_docker_container_logs_zimaos";
  description = "Get logs from a Docker container on ZimaOS. You can optionally specify the number of last lines to retrieve using the tail parameter.";

  schema = {
    container_id: {
      type: z.string(),
      description: "The Docker container ID or name to get logs from",
    },
    tail: {
      type: z.number().optional(),
      description: "Number of last lines to retrieve (default: all logs)",
    },
  };

  async execute(input: GetDockerContainerLogsInput) {
    try {
      const logs = await DockerSSH.getContainerLogs(input.container_id, {
        tail: input.tail,
        follow: false,
      });
      return logs;
    } catch (error: any) {
      return `Failed to get container logs: ${error.message || error}`;
    }
  }
}

export default GetDockerContainerLogsTool;
