import { dronesApi, commandsApi, missionsApi, visionApi } from "./api";

describe("Frontend API Service", () => {
  it("exports dronesApi with expected methods", () => {
    expect(typeof dronesApi.list).toBe("function");
    expect(typeof dronesApi.create).toBe("function");
    expect(typeof dronesApi.remove).toBe("function");
    expect(typeof dronesApi.connect).toBe("function");
    expect(typeof dronesApi.disconnect).toBe("function");
  });

  it("exports commandsApi with expected methods", () => {
    expect(typeof commandsApi.send).toBe("function");
    expect(typeof commandsApi.history).toBe("function");
  });

  it("exports missionsApi with expected methods", () => {
    expect(typeof missionsApi.list).toBe("function");
    expect(typeof missionsApi.create).toBe("function");
  });

  it("exports visionApi with camera and AI detection methods", () => {
    expect(typeof visionApi.getDevices).toBe("function");
    expect(typeof visionApi.getCameraStatus).toBe("function");
    expect(typeof visionApi.startCamera).toBe("function");
    expect(typeof visionApi.stopCamera).toBe("function");
    expect(typeof visionApi.getCameraAiStatus).toBe("function");
    expect(typeof visionApi.toggleCameraAi).toBe("function");
  });
});
