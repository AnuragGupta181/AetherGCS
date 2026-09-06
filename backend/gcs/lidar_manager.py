"""2D LiDAR Sensor & Telemetry Manager for AetherGCS.

Supports:
1. High-fidelity 2D 360° Polar LiDAR simulator for Search & Rescue scenarios:
   - Enclosed disaster zone / building perimeter walls
   - Structural rubble / obstacles / human survivor signatures
   - Dynamic collision-avoidance proximity warnings (<1.5m alert, <0.8m critical)
2. Live WebSocket broadcast at ~10 Hz.
3. Extensible for physical RPLidar / LaserScan serial devices.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import random
import time
from typing import Any, Dict, List, Optional, Set

from fastapi import WebSocket

logger = logging.getLogger("gcs.lidar")


class LidarManager:
    def __init__(self) -> None:
        self.clients: Set[WebSocket] = set()
        self._task: Optional[asyncio.Task] = None
        self._running: bool = False
        self.target_rate_hz: float = 10.0
        self.range_min: float = 0.15
        self.range_max: float = 12.0
        self.scan_count: int = 0
        self.last_scan: Optional[Dict[str, Any]] = None
        self._lock = asyncio.Lock()

        # Simulated obstacle world parameters
        self.room_width: float = 8.0   # meters
        self.room_length: float = 10.0  # meters
        self.sim_drone_x: float = 0.0
        self.sim_drone_y: float = 0.0

    def get_status(self) -> Dict[str, Any]:
        return {
            "running": self._running,
            "rate_hz": self.target_rate_hz,
            "range_min": self.range_min,
            "range_max": self.range_max,
            "scan_count": self.scan_count,
            "connected_clients": len(self.clients),
            "last_closest_dist": (
                self.last_scan.get("closest_obstacle", {}).get("distance")
                if self.last_scan else None
            ),
        }

    async def start(self) -> None:
        async with self._lock:
            if self._running:
                return
            self._running = True
            self._task = asyncio.create_task(self._scan_loop(), name="lidar-scan-loop")
            logger.info("LiDAR scanner stream started")

    async def stop(self) -> None:
        async with self._lock:
            self._running = False
            if self._task:
                self._task.cancel()
                try:
                    await self._task
                except (asyncio.CancelledError, Exception):
                    pass
                self._task = None
            logger.info("LiDAR scanner stream stopped")

    async def add_client(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)
        # Auto-start if not running
        if not self._running:
            await self.start()
        # Immediately send last scan if available
        if self.last_scan:
            try:
                await ws.send_json(self.last_scan)
            except Exception:
                pass

    def remove_client(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    def _generate_simulated_scan(self, t: float) -> Dict[str, Any]:
        """Generate a 360-point 2D laser scan with obstacle geometry and noise."""
        points: List[Dict[str, float]] = []
        closest_dist = float("inf")
        closest_angle = 0.0

        # Gentle drone movement in the simulated space
        drone_x = math.sin(t * 0.3) * 1.2
        drone_y = math.cos(t * 0.2) * 1.0

        # Rectangular room boundaries (corners at ±half_w, ±half_l)
        half_w = self.room_width / 2.0
        half_l = self.room_length / 2.0

        # Discrete obstacles: [x, y, radius]
        obstacles = [
            # Pillar 1 (Rubble pile)
            [2.0, 1.8 + math.sin(t * 0.5) * 0.2, 0.45],
            # Pillar 2 (Collapsed wall section)
            [-2.2, -1.5, 0.6],
            # Human survivor signature (moving slightly)
            [-1.2, 2.8 + math.cos(t * 0.4) * 0.15, 0.35],
            # Hazard debris
            [1.5, -2.5, 0.5],
        ]

        # Scan 360 degrees in 1-degree increments
        for deg in range(0, 360, 1):
            rad = math.radians(deg)
            cos_a = math.cos(rad)
            sin_a = math.sin(rad)

            # 1. Distance to room walls (ray-box intersection)
            d_wall = float("inf")
            if cos_a > 1e-4:
                d_wall = min(d_wall, (half_w - drone_x) / cos_a)
            elif cos_a < -1e-4:
                d_wall = min(d_wall, (-half_w - drone_x) / cos_a)

            if sin_a > 1e-4:
                d_wall = min(d_wall, (half_l - drone_y) / sin_a)
            elif sin_a < -1e-4:
                d_wall = min(d_wall, (-half_l - drone_y) / sin_a)

            dist = max(self.range_min, d_wall)

            # 2. Check collision with round obstacles (ray-circle intersection)
            for ox, oy, r in obstacles:
                rel_x = ox - drone_x
                rel_y = oy - drone_y
                # Projection of obstacle center onto ray
                proj = rel_x * cos_a + rel_y * sin_a
                if proj > 0:
                    perp_sq = (rel_x**2 + rel_y**2) - (proj**2)
                    if perp_sq < r**2:
                        d_hit = proj - math.sqrt(max(0.0, r**2 - perp_sq))
                        if d_hit > self.range_min and d_hit < dist:
                            dist = d_hit

            # 3. Add realistic sensor jitter / noise (±2cm)
            noise = (random.random() - 0.5) * 0.04
            dist = max(self.range_min, min(self.range_max, dist + noise))

            # Quality/intensity (stronger reflections from closer surfaces)
            intensity = int(max(10, min(100, 100 - (dist / self.range_max) * 80)))

            points.append({
                "angle": float(deg),
                "distance": round(dist, 3),
                "intensity": intensity,
            })

            if dist < closest_dist:
                closest_dist = dist
                closest_angle = float(deg)

        warning = closest_dist < 1.5
        critical = closest_dist < 0.8

        return {
            "type": "lidar_scan",
            "timestamp": time.time(),
            "angle_min": 0,
            "angle_max": 359,
            "range_min": self.range_min,
            "range_max": self.range_max,
            "points": points,
            "closest_obstacle": {
                "distance": round(closest_dist, 2),
                "angle": closest_angle,
                "warning": warning,
                "critical": critical,
            },
        }

    async def _scan_loop(self) -> None:
        interval = 1.0 / self.target_rate_hz
        try:
            while self._running:
                t0 = time.time()
                scan_data = self._generate_simulated_scan(t0)
                self.scan_count += 1
                self.last_scan = scan_data

                if self.clients:
                    dead = []
                    for ws in list(self.clients):
                        try:
                            await ws.send_json(scan_data)
                        except Exception:
                            dead.append(ws)
                    for d in dead:
                        self.clients.discard(d)

                elapsed = time.time() - t0
                sleep_sec = max(0.01, interval - elapsed)
                await asyncio.sleep(sleep_sec)

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("Error in lidar scan loop: %s", e, exc_info=True)
