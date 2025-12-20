import { MCPTool } from "mcp-framework";
import { z } from "zod";
import { DockerAPI } from "../lib/getAxios.js";

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
      const res = await DockerAPI().getContainerLogs(input.container_id, {
        tail: input.tail,
        follow: false,
      });
      
      // The logs might be in different formats depending on the API
      if (typeof res.data === 'string') {
        return res.data;
      } else if (Array.isArray(res.data)) {
        return res.data.join('\n');
      } else if (res.data.logs) {
        return res.data.logs;
      } else {
        return JSON.stringify(res.data, null, 2);
      }
    } catch (error: any) {
      return `Failed to get container logs: ${error.message || error}`;
    }
  }
}

export default GetDockerContainerLogsTool;
