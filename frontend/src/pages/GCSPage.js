import { useEffect, useRef, useState } from "react";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import { useGCS } from "@/store/gcsStore";
import { createTelemetrySocket } from "@/services/telemetrySocket";
import { commandsApi, dronesApi, missionsApi } from "@/services/api";
import { useUserGeolocation } from "@/hooks/useUserGeolocation";
import TopToolbar from "@/components/TopToolbar";
import DroneListSidebar from "@/components/DroneListSidebar";
import TelemetryPanel from "@/components/TelemetryPanel";
import DroneMap from "@/components/DroneMap";
import MissionPlanner from "@/components/MissionPlanner";
import CommandHistory from "@/components/CommandHistory";
import ManualControl from "@/components/ManualControl";
import StatusBar from "@/components/StatusBar";
import CameraFeed from "@/components/CameraFeed";
import LidarView from "@/components/LidarView";
import { useResizable } from "@/hooks/useResizable";
import { ResizeHandle } from "@/components/ResizeHandle";
import { Layers } from "lucide-react";

// Constants for layout constraints
const LEFT   = { min: 50, default: 360, max: 600, field: "leftSidebarWidth" };
const RIGHT  = { min: 50, default: 360, max: 650, field: "rightSidebarWidth" };
const BOTTOM = { min: 50, default: 350, max: 1000, field: "missionPlannerHeight" };
const SENSORS_PANEL = { min: 280, default: 480, max: 900, field: "sensorsPanelWidth" };
const CAMERA_HEIGHT = { min: 140, default: 280, max: 700, field: "cameraPanelHeight" };

export default function GCSPage() {
  const setSnapshot = useGCS((s) => s.setSnapshot);
  const upsertDrone = useGCS((s) => s.upsertDrone);
  const removeDrone = useGCS((s) => s.removeDrone);
  const setWsStatus = useGCS((s) => s.setWsStatus);
  const addCommandLog = useGCS((s) => s.addCommandLog);
  const setCommandHistory = useGCS((s) => s.setCommandHistory);
  const setMissions = useGCS((s) => s.setMissions);

  // Future-proof panel selection toggles (default: Map only)
  const [showCamera, setShowCamera] = useState(false);
  const [showLidar, setShowLidar] = useState(false);

  useUserGeolocation();

  // Resizable layout hooks
  const leftPanel = useResizable({
    id: LEFT.field,
    initialSize: LEFT.default,
    minSize: LEFT.min,
    maxSize: LEFT.max,
    direction: "vertical",
  });

  const rightPanel = useResizable({
    id: RIGHT.field,
    initialSize: RIGHT.default,
    minSize: RIGHT.min,
    maxSize: RIGHT.max,
    direction: "vertical",
    invert: true, // Dragging left increases right panel width
  });

  const bottomPanel = useResizable({
    id: BOTTOM.field,
    initialSize: BOTTOM.default,
    minSize: BOTTOM.min,
    maxSize: BOTTOM.max,
    direction: "horizontal",
    invert: true, // Dragging up increases bottom panel height
  });

  // Resizable sensors side panel (width)
  const sensorsPanel = useResizable({
    id: SENSORS_PANEL.field,
    initialSize: SENSORS_PANEL.default,
    minSize: SENSORS_PANEL.min,
    maxSize: SENSORS_PANEL.max,
    direction: "vertical",
    invert: true, // Dragging left increases side panel width
  });

  // Resizable camera height when both Camera and LiDAR are active
  const cameraHeight = useResizable({
    id: CAMERA_HEIGHT.field,
    initialSize: CAMERA_HEIGHT.default,
    minSize: CAMERA_HEIGHT.min,
    maxSize: CAMERA_HEIGHT.max,
    direction: "horizontal",
    invert: false,
  });

  const triggerMapResize = () => {
    setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
    setTimeout(() => window.dispatchEvent(new Event("resize")), 250);
  };

  // Initial data + WS
  useEffect(() => {
    (async () => {
      try {
        const [drones, history, missions] = await Promise.all([
          dronesApi.list(),
          commandsApi.history(200),
          missionsApi.list(),
        ]);
        setSnapshot(drones);
        setCommandHistory(history);
        setMissions(missions);
      } catch (e) {
        console.error("Initial load failed", e);
      }
    })();

    const socket = createTelemetrySocket({
      onSnapshot: setSnapshot,
      onDrone: upsertDrone,
      onDroneRemoved: (msg) => removeDrone(msg.id),
      onCommand: addCommandLog,
      onStatus: setWsStatus,
    });
    return () => socket.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasSidePanels = showCamera || showLidar;

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      <TopToolbar />
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left Sidebar */}
        <DroneListSidebar 
          ref={leftPanel.ref}
          style={{ width: leftPanel.size, minWidth: leftPanel.size, maxWidth: leftPanel.size }} 
        />
        
        {/* Resize Handle for Left Sidebar */}
        <ResizeHandle direction="vertical" {...leftPanel.handleProps} />

        {/* Center Panel (Map + Adjustable Sensors + Mission Planner) */}
        <main aria-label="Flight Map and Mission Control" className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="relative flex-1 flex flex-col overflow-hidden min-h-0 min-w-0">
            {/* Viewport: Map (Full by default) + Adjustable Side Panels when selected */}
            <div className="flex-1 w-full h-full flex min-h-0 min-w-0 overflow-hidden relative">
              
              {/* Main Map Box (Always rendered, resizes dynamically) */}
              <div className="flex-1 h-full min-h-0 min-w-0 flex flex-col relative overflow-hidden">
                <DroneMap />

                {/* Bottom-Right Screen Corner Checkbox Selector Box (floated above bottom legend) */}
                <div className="absolute bottom-11 right-3 z-[1000] bg-zinc-900/95 backdrop-blur-md border border-zinc-700/90 rounded px-3 py-1.5 shadow-2xl flex items-center gap-3 font-mono text-[11px] text-zinc-300 pointer-events-auto select-none">
                  <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider flex items-center gap-1">
                    <Layers className="w-3.5 h-3.5 text-[#00F0FF]" />
                    FEEDS:
                  </span>

                  {/* Checkbox: FPV Camera */}
                  <label className="flex items-center gap-1.5 cursor-pointer hover:text-zinc-100">
                    <input
                      type="checkbox"
                      checked={showCamera}
                      onChange={(e) => {
                        setShowCamera(e.target.checked);
                        triggerMapResize();
                      }}
                      className="w-3.5 h-3.5 accent-[#00F0FF] rounded bg-zinc-800 border-zinc-600 cursor-pointer"
                    />
                    <span className={showCamera ? "text-[#00F0FF] font-semibold" : "text-zinc-400"}>
                      Camera
                    </span>
                  </label>

                  {/* Checkbox: 2D LiDAR */}
                  <label className="flex items-center gap-1.5 cursor-pointer hover:text-zinc-100">
                    <input
                      type="checkbox"
                      checked={showLidar}
                      onChange={(e) => {
                        setShowLidar(e.target.checked);
                        triggerMapResize();
                      }}
                      className="w-3.5 h-3.5 accent-[#00FF41] rounded bg-zinc-800 border-zinc-600 cursor-pointer"
                    />
                    <span className={showLidar ? "text-[#00FF41] font-semibold" : "text-zinc-400"}>
                      2D LiDAR
                    </span>
                  </label>
                </div>
              </div>

              {/* Resize Handle between Map and Side Section (Active when either Camera or LiDAR is chosen) */}
              {hasSidePanels && (
                <ResizeHandle direction="vertical" {...sensorsPanel.handleProps} />
              )}

              {/* Adjustable Side Section (Shows selected panels) */}
              {hasSidePanels && (
                <div 
                  ref={sensorsPanel.ref}
                  className="h-full flex flex-col bg-zinc-950 overflow-hidden border-l border-zinc-800"
                  style={{ width: sensorsPanel.size, minWidth: sensorsPanel.size, maxWidth: sensorsPanel.size }}
                >
                  {/* Case 1: Both Camera & LiDAR selected (Split with horizontal resize handle) */}
                  {showCamera && showLidar && (
                    <div className="w-full h-full flex flex-col overflow-hidden">
                      {/* Top: Camera Feed (Adjustable Height) */}
                      <div
                        ref={cameraHeight.ref}
                        className="p-1 min-h-0 flex flex-col overflow-hidden"
                        style={{ height: cameraHeight.size, minHeight: cameraHeight.size, maxHeight: cameraHeight.size }}
                      >
                        <CameraFeed className="w-full h-full" />
                      </div>

                      {/* Horizontal Resize Handle between Camera and LiDAR */}
                      <ResizeHandle direction="horizontal" {...cameraHeight.handleProps} />

                      {/* Bottom: 2D LiDAR Radar (Takes remaining space) */}
                      <div className="flex-1 p-1 min-h-0 flex flex-col overflow-hidden">
                        <LidarView className="w-full h-full" />
                      </div>
                    </div>
                  )}

                  {/* Case 2: Only Camera selected */}
                  {showCamera && !showLidar && (
                    <div className="w-full h-full p-1 flex flex-col min-h-0 overflow-hidden">
                      <CameraFeed className="w-full h-full" />
                    </div>
                  )}

                  {/* Case 3: Only 2D LiDAR selected */}
                  {!showCamera && showLidar && (
                    <div className="w-full h-full p-1 flex flex-col min-h-0 overflow-hidden">
                      <LidarView className="w-full h-full" />
                    </div>
                  )}
                </div>
              )}
            </div>
            
            {/* Resize Handle for Mission Planner */}
            <ResizeHandle direction="horizontal" {...bottomPanel.handleProps} />

            {/* Bottom Mission Planner & Sensor Tabs */}
            <div 
              ref={bottomPanel.ref}
              className="border-t border-zinc-700 bg-zinc-900 flex flex-col overflow-hidden"
              style={{ height: bottomPanel.size }}
            >
              <Tabs defaultValue="mission" className="h-full flex flex-col">
                <TabsList className="h-9 bg-zinc-800/60 border-b border-zinc-700 rounded-none justify-start px-2 gap-1 shrink-0">
                  <TabsTrigger
                    data-testid="tab-mission"
                    value="mission"
                    className="rounded-none data-[state=active]:bg-zinc-950 data-[state=active]:text-[#FFB000] data-[state=active]:shadow-none border-b-2 border-transparent data-[state=active]:border-[#FFB000] text-[11px] font-mono uppercase tracking-wider text-zinc-300"
                  >
                    Mission Planner
                  </TabsTrigger>
                  <TabsTrigger
                    data-testid="tab-history"
                    value="history"
                    className="rounded-none data-[state=active]:bg-zinc-950 data-[state=active]:text-[#00F0FF] data-[state=active]:shadow-none border-b-2 border-transparent data-[state=active]:border-[#00F0FF] text-[11px] font-mono uppercase tracking-wider text-zinc-300"
                  >
                    Command Log
                  </TabsTrigger>
                  <TabsTrigger
                    data-testid="tab-manual"
                    value="manual"
                    className="rounded-none data-[state=active]:bg-zinc-950 data-[state=active]:text-[#00FF41] data-[state=active]:shadow-none border-b-2 border-transparent data-[state=active]:border-[#00FF41] text-[11px] font-mono uppercase tracking-wider text-zinc-300"
                  >
                    Manual Control
                  </TabsTrigger>
                  <TabsTrigger
                    data-testid="tab-sensors-drawer"
                    value="sensors-drawer"
                    className="rounded-none data-[state=active]:bg-zinc-950 data-[state=active]:text-purple-400 data-[state=active]:shadow-none border-b-2 border-transparent data-[state=active]:border-purple-400 text-[11px] font-mono uppercase tracking-wider text-zinc-300"
                  >
                    Sensors Drawer
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="mission" className="flex-1 mt-0 overflow-hidden">
                  <MissionPlanner />
                </TabsContent>
                <TabsContent value="history" className="flex-1 mt-0 overflow-hidden">
                  <CommandHistory />
                </TabsContent>
                <TabsContent value="manual" className="flex-1 mt-0 overflow-hidden bg-zinc-900">
                  <ManualControl />
                </TabsContent>
                <TabsContent value="sensors-drawer" className="flex-1 mt-0 overflow-hidden bg-zinc-950 p-2">
                  <div className="w-full h-full flex gap-2">
                    <div className="flex-1 h-full min-h-0 flex flex-col">
                      <CameraFeed className="w-full h-full" />
                    </div>
                    <div className="w-1/2 h-full min-h-0 flex flex-col">
                      <LidarView className="w-full h-full" />
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </main>

        {/* Resize Handle for Right Sidebar */}
        <ResizeHandle direction="vertical" {...rightPanel.handleProps} />

        {/* Right Sidebar */}
        <TelemetryPanel 
          ref={rightPanel.ref}
          style={{ width: rightPanel.size, minWidth: rightPanel.size, maxWidth: rightPanel.size }} 
        />
        
      </div>
      <StatusBar />
    </div>
  );
}
