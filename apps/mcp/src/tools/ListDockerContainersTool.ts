import { MCPTool } from "mcp-framework";
import { z } from "zod";
import { DockerSSH } from "../lib/dockerSSH.js";

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
      const containers = await DockerSSH.listContainers();
      if (!containers || containers.length === 0) {
        return "No Docker containers found on ZimaOS";
      }
      
      return containers.map((container: any) => {
        return `Container ID: ${container.id || 'N/A'}\n` +
               `Name: ${container.name || 'N/A'}\n` +
               `Image: ${container.image || 'N/A'}\n` +
               `Status: ${container.status || 'N/A'}\n` +
               `State: ${container.state || 'N/A'}\n` +
               `Created: ${container.created || 'N/A'}\n` +
               `Ports: ${container.ports || 'N/A'}\n` +
               `---`;
      }).join('\n');
    } catch (error: any) {
      return `Failed to list Docker containers: ${error.message || error}`;
    }
  }
}

export default ListDockerContainersTool;
