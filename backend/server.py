"""GCS Backend – FastAPI + WebSocket entry point.

REST API:   /, /health, /api/system/serial-ports, /api/drones, /api/commands, /api/history, /api/missions
WebSocket:  /api/ws/telemetry (broadcasts full drone state at ~5 Hz)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import List, Union

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from gcs.camera_manager import CameraManager
from gcs.command_log import CommandLogStore
from gcs.db import close_db
from gcs.drone_manager import DroneManager
from gcs.lidar_manager import LidarManager
from gcs.mission_manager import MissionManager
from gcs.models import (
    CommandLog,
    CommandRequest,
    ConnectionProfile,
    Drone,
    DroneCreate,
    Mission,
    MissionCreate,
    Waypoint,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("gcs")

app = FastAPI(
    title="AetherGCS API",
    description="Multi-Drone Ground Control Station (GCS) backend API and telemetry service.",
    version="1.0.0",
)
api = APIRouter(prefix="/api")

drone_manager = DroneManager()
mission_manager = MissionManager()
command_log = CommandLogStore()
camera_manager = CameraManager()
lidar_manager = LidarManager()


# ---------------------------------------------------------------------------
# WebSocket broadcaster
# ---------------------------------------------------------------------------
class Broadcaster:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()
        self._queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=1000)
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="ws-broadcaster")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None

    def push(self, event: str, payload) -> None:
        try:
            self._queue.put_nowait({"event": event, "data": payload})
        except asyncio.QueueFull:
            pass

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)
        # send full snapshot on connect
        await ws.send_json({
            "event": "snapshot",
            "data": [d.model_dump() for d in drone_manager.list_drones()],
        })

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    async def _run(self) -> None:
        while True:
            msg = await self._queue.get()
            dead = []
            for ws in list(self.clients):
                try:
                    await ws.send_json(msg)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                self.disconnect(ws)


broadcaster = Broadcaster()


def _on_drone_update(drone: Drone) -> None:
    broadcaster.push("drone", drone.model_dump())


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def _startup() -> None:
    drone_manager.subscribe(_on_drone_update)
    await drone_manager.load_saved()
    await broadcaster.start()
    await camera_manager.start(0)
    await lidar_manager.start()
    logger.info("GCS started with %d saved drone(s)", len(drone_manager.list_drones()))


@app.on_event("shutdown")
async def _shutdown() -> None:
    await camera_manager.stop()
    await lidar_manager.stop()
    await broadcaster.stop()
    await drone_manager.shutdown()
    await close_db()


# ---------------------------------------------------------------------------
# Root & Health Routes
# ---------------------------------------------------------------------------
@app.api_route("/", methods=["GET", "HEAD"], tags=["System"])
async def root():
    """Root entrypoint returning service metadata."""
    return {
        "name": "AetherGCS Backend API",
        "status": "online",
        "version": "1.0.0",
        "docs_url": "/docs",
        "drones": len(drone_manager.list_drones()),
    }


@app.api_route("/health", methods=["GET", "HEAD"], tags=["System"])
@api.api_route("/health", methods=["GET", "HEAD"], tags=["System"])
async def health_check():
    """System health check endpoint."""
    drones = drone_manager.list_drones()
    connected_count = sum(1 for d in drones if d.status == "connected")
    return {
        "status": "healthy",
        "timestamp": time.time(),
        "drones_total": len(drones),
        "drones_connected": connected_count,
        "ws_clients": len(broadcaster.clients),
    }


@api.api_route("/", methods=["GET", "HEAD"], tags=["System"])
async def api_root():
    """API router root endpoint."""
    return {
        "service": "AetherGCS API",
        "status": "online",
        "drones": len(drone_manager.list_drones()),
    }


# ---------------------------------------------------------------------------
# REST – System & Hardware
# ---------------------------------------------------------------------------
@api.get("/system/serial-ports", tags=["System"])
async def get_system_serial_ports():
    """Detect and return available hardware COM/serial ports on host system."""
    try:
        import serial.tools.list_ports
        ports = serial.tools.list_ports.comports()
        return [
            {
                "port": p.device,
                "description": p.description,
                "hwid": p.hwid,
                "manufacturer": getattr(p, "manufacturer", "") or "",
            }
            for p in ports
        ]
    except Exception as e:
        logger.warning("Failed to list serial ports: %s", e)
        return []


# ---------------------------------------------------------------------------
# REST – Drones
# ---------------------------------------------------------------------------
@api.get("/drones", response_model=List[Drone], tags=["Drones"])
async def list_drones():
    """List all registered drones in the system."""
    return drone_manager.list_drones()


@api.post("/drones", response_model=Drone, tags=["Drones"])
async def create_drone(payload: DroneCreate):
    """Register a new drone profile."""
    return await drone_manager.add_drone(payload)


@api.get("/drones/{drone_id}", response_model=Drone, tags=["Drones"])
async def get_drone(drone_id: str):
    """Retrieve details for a specific drone by ID."""
    d = drone_manager.get_drone(drone_id)
    if not d:
        raise HTTPException(404, "Drone not found")
    return d


@api.delete("/drones/{drone_id}", tags=["Drones"])
async def delete_drone(drone_id: str):
    """Remove a drone profile by ID."""
    await drone_manager.remove_drone(drone_id)
    broadcaster.push("drone_removed", {"id": drone_id})
    return {"ok": True}


@api.post("/drones/{drone_id}/connect", response_model=Drone, tags=["Drones"])
async def connect_drone(drone_id: str):
    """Initiate MAVLink/serial connection to a drone."""
    if not drone_manager.get_drone(drone_id):
        raise HTTPException(404, "Drone not found")
    drone = await drone_manager.connect(drone_id)
    if drone.status == "error" and drone.last_error:
        raise HTTPException(400, f"Connection failed: {drone.last_error}")
    return drone


@api.post("/drones/{drone_id}/disconnect", response_model=Drone, tags=["Drones"])
async def disconnect_drone(drone_id: str):
    """Disconnect active connection to a drone."""
    if not drone_manager.get_drone(drone_id):
        raise HTTPException(404, "Drone not found")
    return await drone_manager.disconnect(drone_id)


# ---------------------------------------------------------------------------
# REST – Commands & History
# ---------------------------------------------------------------------------
@api.post("/commands", tags=["Commands"])
async def send_command(req: CommandRequest):
    """Dispatch a flight or action command to one or multiple drones."""
    ids = req.drone_ids
    if not ids:
        raise HTTPException(400, "drone_ids required")

    logs: list[CommandLog] = []
    for did in ids:
        d = drone_manager.get_drone(did)
        if not d:
            continue
        logs.append(CommandLog(
            drone_id=did, drone_name=d.name, command=req.command, params=req.params, status="sent"
        ))

    start = time.time()
    err_detail = None
    try:
        await drone_manager.send_command(ids, req.command, req.params)
        elapsed = int((time.time() - start) * 1000)
        for lg in logs:
            lg.status = "success"
            lg.response_ms = elapsed
    except Exception as e:  # noqa: BLE001
        err_detail = str(e)
        elapsed = int((time.time() - start) * 1000)
        for lg in logs:
            lg.status = "failed"
            lg.error = err_detail
            lg.response_ms = elapsed

    for lg in logs:
        await command_log.add(lg)
        broadcaster.push("command", lg.model_dump())

    if err_detail:
        raise HTTPException(400, detail=err_detail)

    return {"ok": True, "count": len(logs)}


@api.get("/history", response_model=List[CommandLog], tags=["History"])
async def get_history(limit: int = 200):
    """Retrieve execution log history for dispatched drone commands."""
    return await command_log.list(limit=limit)


@api.delete("/history", tags=["History"])
async def clear_history():
    """Clear command history log."""
    await command_log.clear()
    return {"ok": True}


# ---------------------------------------------------------------------------
# REST – Missions
# ---------------------------------------------------------------------------
@api.get("/missions", response_model=List[Mission], tags=["Missions"])
async def list_missions():
    """List all saved flight missions."""
    return await mission_manager.list()


@api.post("/missions", response_model=Mission, tags=["Missions"])
async def create_mission(payload: MissionCreate):
    """Create and save a new flight mission."""
    return await mission_manager.create(payload)


@api.get("/missions/{mid}", response_model=Mission, tags=["Missions"])
async def get_mission(mid: str):
    """Retrieve a mission by its ID."""
    m = await mission_manager.get(mid)
    if not m:
        raise HTTPException(404, "Mission not found")
    return m


@api.put("/missions/{mid}", response_model=Mission, tags=["Missions"])
async def update_mission(mid: str, payload: MissionCreate):
    """Update an existing flight mission by ID."""
    m = await mission_manager.update(mid, payload)
    if not m:
        raise HTTPException(404, "Mission not found")
    return m


@api.delete("/missions/{mid}", tags=["Missions"])
async def delete_mission(mid: str):
    """Delete a mission by ID."""
    ok = await mission_manager.delete(mid)
    if not ok:
        raise HTTPException(404, "Mission not found")
    return {"ok": True}


@api.post("/missions/{mid}/duplicate", response_model=Mission, tags=["Missions"])
async def duplicate_mission(mid: str):
    """Duplicate an existing flight mission."""
    m = await mission_manager.duplicate(mid)
    if not m:
        raise HTTPException(404, "Mission not found")
    return m


# ---------------------------------------------------------------------------
# WebSocket – Telemetry Stream
# ---------------------------------------------------------------------------
@api.websocket("/ws/telemetry")
async def ws_telemetry(ws: WebSocket):
    """Live WebSocket stream broadcasting full drone fleet telemetry at ~5 Hz."""
    await broadcaster.connect(ws)
    try:
        while True:
            # keep-alive; client may send ping
            msg = await ws.receive_text()
            if msg == "ping":
                await ws.send_json({"event": "pong", "data": time.time()})
    except WebSocketDisconnect:
        broadcaster.disconnect(ws)
    except Exception:
        broadcaster.disconnect(ws)


# ---------------------------------------------------------------------------
# Camera Feed & LiDAR Vision Endpoints
# ---------------------------------------------------------------------------
@api.get("/camera/devices", tags=["Vision"])
async def get_camera_devices():
    """List available UVC / USB video devices (including OTG receiver and synthetic feed)."""
    return camera_manager.list_available_devices()


@api.get("/camera/status", tags=["Vision"])
async def get_camera_status():
    """Current live video feed status (source, fps, frame count, clients)."""
    return camera_manager.get_status()


@api.post("/camera/start", tags=["Vision"])
async def start_camera(source: Union[int, str] = 0):
    """Start video capture on the specified device index or 'synthetic'."""
    await camera_manager.start(source)
    return {"ok": True, "status": camera_manager.get_status()}


@api.post("/camera/stop", tags=["Vision"])
async def stop_camera():
    """Stop live video streaming."""
    await camera_manager.stop()
    return {"ok": True, "status": camera_manager.get_status()}


@api.get("/camera/ai/status", tags=["Vision"])
async def get_camera_ai_status():
    """Check if AI object detection is currently active."""
    return {"ai_active": camera_manager.ai.is_active}


@api.post("/camera/ai/toggle", tags=["Vision"])
async def toggle_camera_ai(state: Optional[bool] = None):
    """Toggle AI object detection on or off."""
    is_active = camera_manager.ai.toggle(state)
    return {"ok": True, "ai_active": is_active}



@api.websocket("/ws/camera")
async def ws_camera(ws: WebSocket):
    """Live binary MJPEG stream for FPV camera."""
    await camera_manager.add_client(ws)
    try:
        while True:
            # Keep connection alive; client can send control pings
            await ws.receive_text()
    except WebSocketDisconnect:
        camera_manager.remove_client(ws)
    except Exception:
        camera_manager.remove_client(ws)


@api.get("/lidar/status", tags=["Vision"])
async def get_lidar_status():
    """Current 2D LiDAR scanner status."""
    return lidar_manager.get_status()


@api.post("/lidar/start", tags=["Vision"])
async def start_lidar():
    """Start LiDAR scanner streaming."""
    await lidar_manager.start()
    return {"ok": True, "status": lidar_manager.get_status()}


@api.post("/lidar/stop", tags=["Vision"])
async def stop_lidar():
    """Stop LiDAR scanner streaming."""
    await lidar_manager.stop()
    return {"ok": True, "status": lidar_manager.get_status()}


@api.websocket("/ws/lidar")
async def ws_lidar(ws: WebSocket):
    """Live 2D 360° LiDAR polar point scan stream at ~10 Hz."""
    await lidar_manager.add_client(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        lidar_manager.remove_client(ws)
    except Exception:
        lidar_manager.remove_client(ws)


# ---------------------------------------------------------------------------
# Router & Middleware Configuration
# ---------------------------------------------------------------------------
app.include_router(api)

_cors_origins = os.environ.get("CORS_ORIGINS", "*").split(",")
_allow_credentials = _cors_origins != ["*"]  # credentials=True is invalid with wildcard origins
app.add_middleware(
    CORSMiddleware,
    allow_credentials=_allow_credentials,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)