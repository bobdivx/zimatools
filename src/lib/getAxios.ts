import axios from "axios";

const getBaseConfig = () => {
  const baseURL = process.env.ZIMAOS_API_BASE;
  const token = process.env.ZIMAOS_API_TOKEN;

  if (!baseURL) {
    throw new Error("ZIMAOS_API_BASE environment variable is not set");
  }

  if (!token) {
    throw new Error("ZIMAOS_API_TOKEN environment variable is not set");
  }

  return {
    baseURL,
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
  };
};

export const FileAPI = () => {
  const instance = axios.create(getBaseConfig());
  return {
    getFiles: (path: string) => instance.get(`/v1/files?path=${path}`),
    getFileOrFolderStats: (paths: string[]) => instance.post(`/v1/files/stats`, { paths }),
    getFileDownload: (path: string) => instance.get(`/v1/files/download?path=${path}`),
    putFile: (data: { path: string; content: string }) => instance.put(`/v1/files`, data),
    postCreateFile: (data: { path: string }) => instance.post(`/v1/files`, data),
  };
};

export const StorageAPI = () => {
  const instance = axios.create(getBaseConfig());
  return {
    getAllStorages: () => instance.get(`/v1/storage`),
  };
};

export const FolderAPI = () => {
  const instance = axios.create(getBaseConfig());
  return {
    createFolder: (data: { path: string }) => instance.post(`/v1/folder`, data),
  };
};

export const SearchAPI = () => {
  const instance = axios.create(getBaseConfig());
  return {
    searchFile: (data: { keyword: string; dir: string }) => instance.post(`/v1/search`, data),
  };
};

export const DockerAPI = () => {
  const instance = axios.create(getBaseConfig());
  return {
    listContainers: () => instance.get(`/v2/apps`),
    getContainerInfo: (containerId: string) => instance.get(`/v2/apps/${containerId}`),
    startContainer: (containerId: string) => instance.post(`/v2/apps/${containerId}/start`),
    stopContainer: (containerId: string) => instance.post(`/v2/apps/${containerId}/stop`),
    restartContainer: (containerId: string) => instance.post(`/v2/apps/${containerId}/restart`),
    getContainerLogs: (containerId: string, options?: { tail?: number; follow?: boolean }) => {
      const params = new URLSearchParams();
      if (options?.tail) params.append('tail', options.tail.toString());
      if (options?.follow) params.append('follow', 'true');
      return instance.get(`/v2/apps/${containerId}/logs?${params.toString()}`);
    },
  };
};