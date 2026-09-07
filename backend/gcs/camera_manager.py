"""Camera & Vision Feed Manager for AetherGCS.

Supports:
1. Physical USB Video Class (UVC) devices (integrated webcams, 5.8GHz OTG receivers, capture cards).
2. Synthetic Search & Rescue (SAR) FPV Stream generator (with simulated AI detections for survivors/hazards).
3. Async binary frame distribution over WebSockets.
"""
from __future__ import annotations

import asyncio
import glob
import logging
import math
import os
import sys
import time
from typing import Any, Dict, List, Optional, Set, Union

import cv2
import numpy as np
from fastapi import WebSocket

from gcs.ai_pipeline import HazardDetector

logger = logging.getLogger("gcs.camera")


class CameraManager:
    def __init__(self) -> None:
        self.clients: Set[WebSocket] = set()
        self._capture_task: Optional[asyncio.Task] = None
        self._running: bool = False
        self.device_source: Union[int, str] = 0
        self.use_simulation: bool = False
        self.target_fps: int = 25
        self.jpeg_quality: int = 70
        self.width: int = 640
        self.height: int = 480
        self.frame_count: int = 0
        self.fps_actual: float = 0.0
        self.last_frame_bytes: Optional[bytes] = None
        self._lock = asyncio.Lock()
        
        # Initialize AI Pipeline
        self.ai = HazardDetector()

    def list_available_devices(self) -> List[Dict[str, Any]]:
        """Detect available V4L2/USB camera devices on the host system."""
        devices: List[Dict[str, Any]] = []

        # Check Linux /dev/video* devices
        video_paths = sorted(glob.glob("/dev/video*"))
        for path in video_paths:
            try:
                idx = int(path.replace("/dev/video", ""))
                sys_name_file = f"/sys/class/video4linux/video{idx}/name"
                name = f"Camera Device {idx}"
                if os.path.exists(sys_name_file):
                    try:
                        with open(sys_name_file, "r") as f:
                            name = f.read().strip()
                    except Exception:
                        pass

                # If this device is currently open by our capture loop, it's definitely available!
                if self._running and str(self.device_source) == str(idx):
                    is_open = True
                else:
                    # Test if it can capture frames
                    cap = cv2.VideoCapture(idx, cv2.CAP_V4L2 if sys.platform.startswith("linux") else cv2.CAP_ANY)
                    is_open = cap.isOpened()
                    if is_open:
                        cap.release()

                # Only list devices that are actual video capture nodes
                if is_open:
                    devices.append({
                        "id": idx,
                        "path": path,
                        "name": f"{name} ({path})",
                        "available": True,
                    })
            except Exception:
                pass

        # Always include Synthetic / Simulated SAR camera option
        devices.append({
            "id": "synthetic",
            "path": "synthetic://sar_thermal_rgb",
            "name": "Synthetic SAR AI FPV Feed (Simulation)",
            "available": True,
        })
        return devices

    def get_status(self) -> Dict[str, Any]:
        return {
            "running": self._running,
            "device_source": self.device_source,
            "use_simulation": self.use_simulation,
            "target_fps": self.target_fps,
            "fps_actual": round(self.fps_actual, 1),
            "frame_count": self.frame_count,
            "connected_clients": len(self.clients),
            "resolution": f"{self.width}x{self.height}",
        }

    async def start(self, source: Union[int, str] = 0) -> None:
        async with self._lock:
            # Normalize string digits to integer
            if isinstance(source, str) and source.isdigit():
                source = int(source)

            if self._running:
                if self.device_source == source:
                    return
                await self._stop_internal()

            self.device_source = source
            self.use_simulation = (str(source).lower() in ("synthetic", "sim", "simulation", "-1"))
            self._running = True
            self._capture_task = asyncio.create_task(self._capture_loop(), name="camera-capture-loop")
            logger.info("Camera feed started on source: %s (simulation=%s)", source, self.use_simulation)

    async def stop(self) -> None:
        async with self._lock:
            await self._stop_internal()

    async def _stop_internal(self) -> None:
        self._running = False
        if self._capture_task:
            self._capture_task.cancel()
            try:
                await self._capture_task
            except (asyncio.CancelledError, Exception):
                pass
            self._capture_task = None
        self.last_frame_bytes = None
        logger.info("Camera feed stopped")

    async def add_client(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)
        # Auto-start if not running yet
        if not self._running:
            await self.start(self.device_source)
        # Immediately send last frame if available
        if self.last_frame_bytes:
            try:
                await ws.send_bytes(self.last_frame_bytes)
            except Exception:
                pass

    def remove_client(self, ws: WebSocket) -> None:
        self.clients.discard(ws)
        # Optional: could auto-pause if no clients, but keep running for low-latency reconnect

    async def _broadcast_frame(self, frame_bytes: bytes) -> None:
        self.last_frame_bytes = frame_bytes
        if not self.clients:
            return

        dead_clients = []
        for ws in list(self.clients):
            try:
                await ws.send_bytes(frame_bytes)
            except Exception:
                dead_clients.append(ws)

        for dead in dead_clients:
            self.clients.discard(dead)

    def _generate_synthetic_frame(self, t: float) -> np.ndarray:
        """Generate high-quality FPV Search & Rescue simulated feed.

        Includes:
        - Animated horizon with pitch and roll oscillation
        - Ground grid & aerial landscape
        - Simulated thermal/RGB survivor and hazard bounding boxes with confidence scores
        - HUD reticle, crosshairs, telemetry readouts
        """
        w, h = self.width, self.height
        frame = np.zeros((h, w, 3), dtype=np.uint8)

        # Dynamic roll & pitch angles
        roll_deg = math.sin(t * 0.4) * 5.0
        pitch_px = math.sin(t * 0.25) * 20.0

        # Sky and ground split
        horizon_y = int(h / 2 + pitch_px)

        # Sky gradient (dark night/thermal palette)
        cv2.rectangle(frame, (0, 0), (w, max(0, min(h, horizon_y))), (40, 25, 20), -1)
        # Ground (dark earthy/infrared green-grey)
        cv2.rectangle(frame, (0, max(0, min(h, horizon_y))), (w, h), (18, 28, 22), -1)

        # Perspective ground lines (grid)
        cx = w // 2
        for offset in range(-300, 301, 75):
            x_bottom = cx + int(offset * 2.5)
            x_horizon = cx + int(offset * 0.2)
            cv2.line(frame, (x_horizon, horizon_y), (x_bottom, h), (30, 48, 35), 1)

        # Horizontal depth rings on ground
        for depth_y in [h - 30, h - 80, h - 140, h - 190]:
            if depth_y > horizon_y:
                cv2.line(frame, (0, depth_y), (w, depth_y), (25, 42, 30), 1)

        # Simulated Disaster / SAR detections:
        # 1. Survivor detection box
        survivor_x = int(cx + math.sin(t * 0.5) * 80)
        survivor_y = int(horizon_y + 60 + math.cos(t * 0.3) * 15)
        box_w, box_h = 44, 60
        x1, y1 = survivor_x - box_w // 2, survivor_y - box_h // 2
        x2, y2 = survivor_x + box_w // 2, survivor_y + box_h // 2

        # Draw survivor bounding box (Red for human / person survivor)
        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 255), 2)
        # Label with confidence
        cv2.putText(frame, "HUMAN_SURVIVOR 94.2%", (x1, max(15, y1 - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 0, 255), 1, cv2.LINE_AA)

        # 2. Hazard detection box (Amber / Fire / Flood warning)
        hazard_x = int(cx - 160 + math.cos(t * 0.2) * 20)
        hazard_y = int(horizon_y + 90)
        hx1, hy1 = hazard_x - 50, hazard_y - 25
        hx2, hy2 = hazard_x + 50, hazard_y + 25
        cv2.rectangle(frame, (hx1, hy1), (hx2, hy2), (0, 165, 255), 1)
        cv2.putText(frame, "HAZARD: FLOODWATER", (hx1, hy1 - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 165, 255), 1, cv2.LINE_AA)

        return frame

    async def _capture_loop(self) -> None:
        """Main async video frame capture loop."""
        cap: Optional[cv2.VideoCapture] = None
        device_idx: Optional[int] = None
        is_hardware = False

        if not self.use_simulation:
            dev = self.device_source
            if isinstance(dev, str) and dev.isdigit():
                dev = int(dev)

            if isinstance(dev, int):
                try:
                    cap = cv2.VideoCapture(dev, cv2.CAP_V4L2 if sys.platform.startswith("linux") else cv2.CAP_ANY)
                    if cap.isOpened():
                        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
                        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
                        is_hardware = True
                        logger.info("Successfully opened hardware video device %s", dev)
                    else:
                        logger.warning("Could not open hardware video device %s; falling back to simulated SAR feed", dev)
                        cap = None
                except Exception as e:
                    logger.warning("Error initializing video capture on %s: %s", dev, e)
                    cap = None

        frame_interval = 1.0 / self.target_fps
        fps_start_time = time.time()
        fps_frame_count = 0

        try:
            while self._running:
                t0 = time.time()
                frame: Optional[np.ndarray] = None

                if is_hardware and cap is not None and cap.isOpened():
                    # Read hardware frame in thread to avoid blocking asyncio event loop
                    ret, raw_frame = await asyncio.to_thread(cap.read)
                    if ret and raw_frame is not None:
                        # Resize if needed
                        if raw_frame.shape[1] != self.width or raw_frame.shape[0] != self.height:
                            frame = cv2.resize(raw_frame, (self.width, self.height))
                        else:
                            frame = raw_frame
                    else:
                        logger.warning("Hardware frame read failed, falling back to simulated frame")
                        frame = self._generate_synthetic_frame(t0)
                else:
                    # Synthetic / Simulated SAR feed
                    frame = self._generate_synthetic_frame(t0)

                # Run AI pipeline (only does work if enabled)
                if frame is not None:
                    # process_frame handles drawing directly on the frame
                    frame = self.ai.process_frame(frame)

                # JPEG compression
                encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), self.jpeg_quality]
                ret, buf = cv2.imencode(".jpg", frame, encode_param)
                if ret:
                    frame_bytes = buf.tobytes()
                    self.frame_count += 1
                    fps_frame_count += 1
                    await self._broadcast_frame(frame_bytes)

                # Update measured FPS
                elapsed_fps = time.time() - fps_start_time
                if elapsed_fps >= 1.0:
                    self.fps_actual = fps_frame_count / elapsed_fps
                    fps_frame_count = 0
                    fps_start_time = time.time()

                # Sleep to maintain target FPS
                process_time = time.time() - t0
                sleep_time = max(0.005, frame_interval - process_time)
                await asyncio.sleep(sleep_time)

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("Unexpected error in camera capture loop: %s", e, exc_info=True)
        finally:
            if cap is not None:
                try:
                    cap.release()
                except Exception:
                    pass
                logger.info("Hardware video device released")
