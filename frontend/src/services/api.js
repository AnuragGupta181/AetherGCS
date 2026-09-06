import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const client = axios.create({ baseURL: API, timeout: 15000 });

export const dronesApi = {
  list: () => client.get("/drones").then((r) => r.data),
  create: (payload) => client.post("/drones", payload).then((r) => r.data),
  remove: (id) => client.delete(`/drones/${id}`).then((r) => r.data),
  connect: (id) => client.post(`/drones/${id}/connect`).then((r) => r.data),
  disconnect: (id) => client.post(`/drones/${id}/disconnect`).then((r) => r.data),
  getSerialPorts: () => client.get("/system/serial-ports").then((r) => r.data),
};

export const commandsApi = {
  send: (drone_ids, command, params = {}) =>
    client.post("/commands", { drone_ids, command, params }).then((r) => r.data),
  history: (limit = 200) => client.get(`/history?limit=${limit}`).then((r) => r.data),
  clearHistory: () => client.delete("/history").then((r) => r.data),
};

export const missionsApi = {
  list: () => client.get("/missions").then((r) => r.data),
  create: (payload) => client.post("/missions", payload).then((r) => r.data),
  get: (id) => client.get(`/missions/${id}`).then((r) => r.data),
  update: (id, payload) => client.put(`/missions/${id}`, payload).then((r) => r.data),
  remove: (id) => client.delete(`/missions/${id}`).then((r) => r.data),
  duplicate: (id) => client.post(`/missions/${id}/duplicate`).then((r) => r.data),
};

export const visionApi = {
  getDevices: () => client.get("/camera/devices").then((r) => r.data),
  getCameraStatus: () => client.get("/camera/status").then((r) => r.data),
  startCamera: (source = 0) => client.post(`/camera/start?source=${encodeURIComponent(source)}`).then((r) => r.data),
  stopCamera: () => client.post("/camera/stop").then((r) => r.data),
  getLidarStatus: () => client.get("/lidar/status").then((r) => r.data),
  startLidar: () => client.post("/lidar/start").then((r) => r.data),
  stopLidar: () => client.post("/lidar/stop").then((r) => r.data),
  getCameraAiStatus: () => client.get("/camera/ai/status").then((r) => r.data),
  toggleCameraAi: (state) => client.post(`/camera/ai/toggle${state !== undefined ? `?state=${state}` : ''}`).then((r) => r.data),
};
