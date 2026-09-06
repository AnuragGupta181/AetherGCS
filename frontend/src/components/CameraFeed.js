import React, { useEffect, useRef, useState, useCallback } from "react";
import { useActiveDrone } from "@/store/gcsStore";
import { API, visionApi } from "@/services/api";
import {
  Video,
  VideoOff,
  Camera,
  RefreshCw,
  Maximize2,
  Minimize2,
  Radio,
} from "lucide-react";

export default function CameraFeed({ className = "" }) {
  const activeDrone = useActiveDrone();
  const telemetry = activeDrone?.telemetry;

  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const imgRef = useRef(new Image());
  const prevUrlRef = useRef(null);

  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const [connected, setConnected] = useState(false);
  const [fps, setFps] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef(null);

  // Measure frontend render FPS
  const lastFpsCalc = useRef(Date.now());
  const framesSinceLast = useRef(0);

  // Fetch available camera devices and detect active device
  const loadDevices = useCallback(async () => {
    try {
      const devList = await visionApi.getDevices();
      setDevices(devList);

      const status = await visionApi.getCameraStatus().catch(() => null);
      if (status && status.device_source !== undefined) {
        setSelectedDevice(status.device_source);
      } else if (devList.length > 0) {
        // Prioritize real hardware camera (e.g. index 0) if available
        const hw = devList.find((d) => d.id !== "synthetic");
        setSelectedDevice(hw ? hw.id : devList[0].id);
      }
    } catch (e) {
      console.warn("Failed to load camera devices", e);
    }
  }, []);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  // Connect to the WebSocket stream
  const connectWs = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
    }

    const wsUrl = API.replace(/^http/, "ws") + "/ws/camera";
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "blob";
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setStreaming(true);
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") return;

      const blob = event.data;
      const url = URL.createObjectURL(blob);

      const img = imgRef.current;
      img.onload = () => {
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext("2d");
          if (canvas.width !== img.width || canvas.height !== img.height) {
            canvas.width = img.width;
            canvas.height = img.height;
          }
          ctx.drawImage(img, 0, 0);
        }

        if (prevUrlRef.current) {
          URL.revokeObjectURL(prevUrlRef.current);
        }
        prevUrlRef.current = url;

        // Update FPS
        framesSinceLast.current += 1;
        const now = Date.now();
        if (now - lastFpsCalc.current >= 1000) {
          setFps(framesSinceLast.current);
          framesSinceLast.current = 0;
          lastFpsCalc.current = now;
        }
      };
      img.src = url;
    };

    ws.onerror = () => {
      setConnected(false);
    };

    ws.onclose = () => {
      setConnected(false);
      setStreaming(false);
    };
  }, []);

  useEffect(() => {
    connectWs();
    return () => {
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
      }
      if (prevUrlRef.current) {
        URL.revokeObjectURL(prevUrlRef.current);
      }
    };
  }, [connectWs]);

  // Handle switching video source
  const handleSourceChange = async (newSource) => {
    // Convert numeric string to integer if applicable
    const parsedSource = (!isNaN(newSource) && newSource !== "" && newSource !== "synthetic")
      ? Number(newSource)
      : newSource;

    setSelectedDevice(parsedSource);
    try {
      await visionApi.startCamera(parsedSource);
      connectWs();
    } catch (e) {
      console.error("Failed to change camera source", e);
    }
  };

  const toggleStream = async () => {
    if (streaming) {
      try {
        await visionApi.stopCamera();
        if (wsRef.current) wsRef.current.close();
        setStreaming(false);
      } catch (e) {
        console.error("Failed to stop camera", e);
      }
    } else {
      try {
        await visionApi.startCamera(selectedDevice);
        connectWs();
      } catch (e) {
        console.error("Failed to start camera", e);
      }
    }
  };

  const takeSnapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/jpeg", 0.95);
    a.download = `AetherGCS_Snapshot_${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`;
    a.click();
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col bg-zinc-950 border border-zinc-800 rounded overflow-hidden select-none ${className}`}
    >
      {/* Top Controls Header */}
      <div className="h-8 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between px-2 text-[11px] font-mono text-zinc-300 shrink-0 z-20">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 font-bold text-zinc-100 uppercase tracking-wider">
            <Radio className="w-3.5 h-3.5 text-[#00F0FF] animate-pulse" />
            <span>FPV FEED</span>
          </div>

          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
              connected ? "bg-emerald-950/80 text-[#00FF41] border border-emerald-800/50" : "bg-red-950/80 text-[#FF003C] border border-red-800/50"
            }`}
          >
            {connected ? "LIVE" : "OFFLINE"}
          </span>

          <span className="text-zinc-500 hidden sm:inline">|</span>
          <span className="text-zinc-400 font-mono hidden sm:inline">
            FPS: <span className="text-zinc-200">{fps}</span>
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Device Selector */}
          <select
            value={selectedDevice}
            onChange={(e) => handleSourceChange(e.target.value)}
            className="bg-zinc-800 text-zinc-200 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] font-mono focus:outline-none focus:border-[#00F0FF] max-w-[200px] truncate"
          >
            {devices.map((dev) => (
              <option key={dev.id} value={dev.id}>
                {dev.name}
              </option>
            ))}
          </select>

          <button
            onClick={loadDevices}
            title="Refresh Devices"
            className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition"
          >
            <RefreshCw className="w-3 h-3" />
          </button>

          <button
            onClick={toggleStream}
            title={streaming ? "Stop Stream" : "Start Stream"}
            className={`p-1 rounded transition ${
              streaming ? "text-[#00FF41] hover:bg-emerald-950" : "text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            {streaming ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={takeSnapshot}
            title="Capture Snapshot"
            className="p-1 text-zinc-400 hover:text-[#00F0FF] hover:bg-zinc-800 rounded transition"
          >
            <Camera className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={toggleFullscreen}
            title="Toggle Fullscreen"
            className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Canvas Viewport */}
      <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full h-full object-contain pointer-events-none"
        />

        {!connected && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/85 backdrop-blur-sm z-10 text-center p-4">
            <VideoOff className="w-9 h-9 text-zinc-600 mb-2 animate-bounce" />
            <div className="font-mono text-xs text-zinc-300 font-bold uppercase tracking-wider mb-1">
              Feed Disconnected
            </div>
            <p className="text-[11px] text-zinc-500 max-w-xs mb-3">
              Select your webcam or synthetic feed in the top right.
            </p>
            <button
              onClick={() => handleSourceChange(0)}
              className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-[#00F0FF] border border-cyan-800/50 rounded font-mono text-xs transition"
            >
              Connect Hardware Camera (0)
            </button>
          </div>
        )}

        {/* Clean, Essential-Only Tactical OSD Overlay */}
        {connected && (
          <div className="absolute inset-0 pointer-events-none p-3 flex flex-col justify-between font-mono text-[11px] text-[#00FF41] select-none z-10">
            {/* Top Row: Drone Identity + Flight Mode (Left), Battery (Right) */}
            <div className="flex items-start justify-between">
              {/* Top Left: Drone Name & Flight Mode */}
              <div className="flex items-center gap-1.5 bg-black/50 backdrop-blur-sm px-2 py-0.5 rounded border border-white/5">
                <span className="text-[#FFB000] font-bold">
                  {activeDrone?.name || "DRONE ALPHA"}
                </span>
                <span className="text-zinc-500">|</span>
                <span className={telemetry?.armed ? "text-[#00FF41] font-bold" : "text-[#FF003C]"}>
                  {telemetry?.armed ? "ARMED" : "DISARMED"}
                </span>
                <span className="text-zinc-500">|</span>
                <span className="text-[#00F0FF] font-bold">
                  {telemetry?.flight_mode || "STABILIZE"}
                </span>
              </div>

              {/* Top Right: Battery Status */}
              <div className="bg-black/50 backdrop-blur-sm px-2 py-0.5 rounded border border-white/5 text-[#00FF41] font-bold">
                BAT: {telemetry?.battery_percent ? `${Math.round(telemetry.battery_percent)}%` : "100%"}
                <span className="text-zinc-300 font-normal ml-1">
                  ({telemetry?.battery_voltage ? telemetry.battery_voltage.toFixed(1) : "16.8"}V)
                </span>
              </div>
            </div>

            {/* Center Reticle / Crosshair */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative w-20 h-20 border border-white/10 rounded-full flex items-center justify-center">
                <div className="w-2.5 h-0.5 bg-[#00F0FF]/70 absolute -left-1" />
                <div className="w-2.5 h-0.5 bg-[#00F0FF]/70 absolute -right-1" />
                <div className="w-0.5 h-2.5 bg-[#00F0FF]/70 absolute -top-1" />
                <div className="w-0.5 h-2.5 bg-[#00F0FF]/70 absolute -bottom-1" />
                <div className="w-1.5 h-1.5 rounded-full bg-[#00F0FF]/80" />
              </div>
            </div>

            {/* Bottom Row: Altitude & Speed (Left), Heading (Right) - Coordinates removed for clean view */}
            <div className="flex items-end justify-between">
              {/* Bottom Left: Flight Critical Speed & Altitude */}
              <div className="bg-black/50 backdrop-blur-sm px-2 py-1 rounded border border-white/5 flex gap-3">
                <div className="text-zinc-300">
                  ALT: <span className="text-[#00F0FF] font-bold">{telemetry?.altitude_relative?.toFixed(1) ?? "0.0"}m</span>
                </div>
                <div className="text-zinc-300">
                  SPD: <span className="text-[#00FF41] font-bold">{telemetry?.ground_speed?.toFixed(1) ?? "0.0"}m/s</span>
                </div>
              </div>

              {/* Bottom Right: Clean Heading only */}
              <div className="bg-black/50 backdrop-blur-sm px-2 py-1 rounded border border-white/5 text-[#FFB000] font-bold">
                HDG: {Math.round(telemetry?.heading ?? 0)}°
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
