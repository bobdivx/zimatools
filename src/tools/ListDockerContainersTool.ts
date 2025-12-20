import { MCPTool } from "mcp-framework";
import { z } from "zod";
import { DockerAPI } from "../lib/getAxios.js";

interface ListDockerContainersInput {
  message: string;
}

class ListDockerContainersTool extends MCPTool<ListDockerContainersInput> {
  name = "list_docker_containers_zimaos";
  description = "List all Docker containers deployed on your ZimaOS. Returns information about running and stopped containers including their IDs, names, status, and images.";

  schema = {
    message: {
      type: z.string(),
      description: "anything",
    },
  };

  async execute(input: ListDockerContainersInput) {
    try {
      const res = await DockerAPI().listContainers();
      if (!res.data || !res.data.length) {
        return "No Docker containers found on ZimaOS";
      }
      
      return res.data.map((container: any) => {
        return `Container ID: ${container.id || container.Id || 'N/A'}\n` +
               `Name: ${container.name || container.Names?.[0] || 'N/A'}\n` +
               `Image: ${container.image || container.Image || 'N/A'}\n` +
               `Status: ${container.status || container.Status || 'N/A'}\n` +
               `State: ${container.state || container.State || 'N/A'}\n` +
               `---`;
      }).join('\n');
    } catch (error: any) {
      return `Failed to list Docker containers: ${error.message || error}`;
    }
  }
}

export default ListDockerContainersTool;
