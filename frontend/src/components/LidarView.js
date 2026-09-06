import React, { useEffect, useRef, useState, useCallback } from "react";
import { API, visionApi } from "@/services/api";
import {
  Radar,
  Radio,
  AlertTriangle,
  Play,
  Pause,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
} from "lucide-react";

export default function LidarView({ className = "", compact = false }) {
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const containerRef = useRef(null);

  const [connected, setConnected] = useState(false);
  const [active, setActive] = useState(true);
  const [maxRange, setMaxRange] = useState(10.0); // meters
  const [closestObstacle, setClosestObstacle] = useState(null);
  const [scanRate, setScanRate] = useState(10);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const latestPointsRef = useRef([]);
  const sweepAngleRef = useRef(0);
  const animFrameRef = useRef(null);
  const scanCountRef = useRef(0);
  const lastRateCalc = useRef(Date.now());

  // Connect to the LiDAR WebSocket
  const connectWs = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
    }

    const wsUrl = API.replace(/^http/, "ws") + "/ws/lidar";
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "lidar_scan") {
          latestPointsRef.current = data.points || [];
          if (data.closest_obstacle) {
            setClosestObstacle(data.closest_obstacle);
          }

          scanCountRef.current += 1;
          const now = Date.now();
          if (now - lastRateCalc.current >= 1000) {
            setScanRate(scanCountRef.current);
            scanCountRef.current = 0;
            lastRateCalc.current = now;
          }
        }
      } catch (e) {}
    };

    ws.onerror = () => {
      setConnected(false);
    };

    ws.onclose = () => {
      setConnected(false);
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
    };
  }, [connectWs]);

  // Main Radar Canvas Rendering Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const render = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(cx, cy) - 24;

      if (radius <= 10) {
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }

      // 1. Dark radar background
      ctx.fillStyle = "#090d0b";
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      // 2. Concentric Range Rings
      const ringSteps = maxRange <= 5 ? [1, 2, 3, 4, 5] : maxRange <= 10 ? [2, 4, 6, 8, 10] : [3, 6, 9, 12, 15];
      ctx.strokeStyle = "rgba(0, 240, 255, 0.15)";
      ctx.lineWidth = 1;
      ctx.font = '9px "IBM Plex Sans", monospace';
      ctx.fillStyle = "rgba(0, 240, 255, 0.5)";
      ctx.textAlign = "left";

      ringSteps.forEach((rDist) => {
        if (rDist <= maxRange) {
          const rPx = (rDist / maxRange) * radius;
          ctx.beginPath();
          ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillText(`${rDist}m`, cx + 3, cy - rPx + 11);
        }
      });

      // 3. Radial Crosshairs & Degree Marks
      ctx.strokeStyle = "rgba(0, 240, 255, 0.2)";
      ctx.beginPath();
      // Forward-Aft (0° - 180°)
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx, cy + radius);
      // Left-Right (270° - 90°)
      ctx.moveTo(cx - radius, cy);
      ctx.lineTo(cx + radius, cy);
      ctx.stroke();

      // Cardinal Labels
      ctx.font = '10px "IBM Plex Sans", monospace';
      ctx.fillStyle = "#00F0FF";
      ctx.textAlign = "center";
      ctx.fillText("0° (FWD)", cx, cy - radius - 6);
      ctx.fillText("180°", cx, cy + radius + 14);
      ctx.textAlign = "left";
      ctx.fillText("90° (R)", cx + radius + 4, cy + 3);
      ctx.textAlign = "right";
      ctx.fillText("270° (L)", cx - radius - 4, cy + 3);

      // 4. Sweeping Beam Animation
      if (active) {
        sweepAngleRef.current = (sweepAngleRef.current + 3.5) % 360;
      }
      const sweepRad = (sweepAngleRef.current - 90) * (Math.PI / 180);

      // Sweep gradient sector
      const sweepGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      sweepGrad.addColorStop(0, "rgba(0, 255, 65, 0.35)");
      sweepGrad.addColorStop(1, "rgba(0, 255, 65, 0.0)");

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, sweepRad - 0.3, sweepRad);
      ctx.closePath();
      ctx.fillStyle = sweepGrad;
      ctx.fill();

      // Sweep leading line
      ctx.strokeStyle = "#00FF41";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + radius * Math.cos(sweepRad), cy + radius * Math.sin(sweepRad));
      ctx.stroke();
      ctx.restore();

      // 5. Plot LiDAR Scan Points
      const points = latestPointsRef.current;
      for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        const dist = pt.distance;
        if (dist <= 0.05 || dist > maxRange * 1.05) continue;

        // Convert drone polar angle (0=forward/up) to canvas cartesian
        const angleRad = (pt.angle - 90) * (Math.PI / 180);
        const ptRadius = (dist / maxRange) * radius;
        const px = cx + ptRadius * Math.cos(angleRad);
        const py = cy + ptRadius * Math.sin(angleRad);

        // Color coding by proximity hazard level
        if (dist < 1.0) {
          ctx.fillStyle = "#FF003C"; // Red: Danger
          ctx.shadowColor = "#FF003C";
          ctx.shadowBlur = 4;
        } else if (dist < 2.0) {
          ctx.fillStyle = "#FFB000"; // Amber: Warning
          ctx.shadowColor = "#FFB000";
          ctx.shadowBlur = 2;
        } else {
          ctx.fillStyle = "#00FF41"; // Neon green: Clear
          ctx.shadowBlur = 0;
        }

        ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
      }
      ctx.shadowBlur = 0;

      // 6. Drone center icon
      ctx.fillStyle = "#00F0FF";
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [maxRange, active]);

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
      {/* Top Header Controls */}
      <div className="h-8 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between px-2 text-[11px] font-mono text-zinc-300 shrink-0 z-20">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 font-bold text-zinc-100 uppercase tracking-wider">
            <Radar className="w-3.5 h-3.5 text-[#00FF41] animate-spin" style={{ animationDuration: "6s" }} />
            <span>2D LIDAR RADAR</span>
          </div>

          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
              connected ? "bg-emerald-950/80 text-[#00FF41] border border-emerald-800/50" : "bg-red-950/80 text-[#FF003C] border border-red-800/50"
            }`}
          >
            {connected ? "ONLINE" : "OFFLINE"}
          </span>

          <span className="text-zinc-500 hidden sm:inline">|</span>
          <span className="text-zinc-400 font-mono hidden sm:inline">
            RATE: <span className="text-zinc-200">{scanRate} Hz</span>
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Zoom controls */}
          <div className="flex items-center bg-zinc-800 rounded px-1 border border-zinc-700">
            <span className="text-[10px] text-zinc-400 mr-1">RNG:</span>
            {[5, 10, 15].map((rng) => (
              <button
                key={rng}
                onClick={() => setMaxRange(rng)}
                className={`px-1.5 py-0.5 text-[10px] font-mono rounded transition ${
                  maxRange === rng
                    ? "bg-[#00F0FF]/20 text-[#00F0FF] font-bold"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {rng}m
              </button>
            ))}
          </div>

          <button
            onClick={() => setActive(!active)}
            title={active ? "Pause Radar" : "Resume Radar"}
            className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition"
          >
            {active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
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
        <canvas ref={canvasRef} className="w-full h-full" />

        {/* Proximity Warning Banner */}
        {closestObstacle && (
          <div className="absolute top-2 left-2 right-2 flex justify-between items-center pointer-events-none z-10 font-mono text-[11px]">
            <div
              className={`px-2 py-1 rounded backdrop-blur-md border flex items-center gap-1.5 ${
                closestObstacle.critical
                  ? "bg-red-950/90 text-[#FF003C] border-red-600 animate-pulse font-bold"
                  : closestObstacle.warning
                  ? "bg-amber-950/90 text-[#FFB000] border-amber-600 font-semibold"
                  : "bg-zinc-900/80 text-zinc-300 border-zinc-700"
              }`}
            >
              {(closestObstacle.critical || closestObstacle.warning) && (
                <AlertTriangle className="w-3.5 h-3.5" />
              )}
              <span>
                NEAREST: {closestObstacle.distance}m @ {Math.round(closestObstacle.angle)}°
              </span>
              {closestObstacle.critical && <span>[CRITICAL PROXIMITY]</span>}
            </div>

            <div className="bg-black/60 backdrop-blur-sm px-2 py-1 rounded border border-white/5 text-[10px] text-zinc-400">
              FOV: 360° | 360 PTS
            </div>
          </div>
        )}

        {/* Bottom Legend */}
        <div className="absolute bottom-2 left-2 flex items-center gap-3 bg-black/60 backdrop-blur-sm px-2 py-1 rounded border border-white/5 font-mono text-[9px] text-zinc-400 pointer-events-none">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#00FF41]" />
            <span>&gt;2m Safe</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#FFB000]" />
            <span>1-2m Caution</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#FF003C]" />
            <span>&lt;1m Danger</span>
          </div>
        </div>
      </div>
    </div>
  );
}
