"""GeotagManager – orchestrates real-time AI geotags with spatial deduplication and MongoDB persistence."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import logging
import math
from typing import Callable, Dict, List, Optional

from .db import get_db
from .models import Geotag, GeotagCreate, GeotagStatus, _now_iso

logger = logging.getLogger("gcs.geotags")


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great-circle distance between two points on the Earth in meters."""
    R = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2)
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


class GeotagManager:
    COLLECTION = "geotags"
    DISTANCE_THRESHOLD_METERS = 5.0  # 5 meters spatial clustering threshold
    COOLDOWN_SECONDS = 15.0  # 15 seconds temporal debounce cooldown

    def __init__(self, db: Any = None, mongo_db: Any = None) -> None:
        self._db = db or mongo_db
        self._tags: Dict[str, Geotag] = {}
        self._listeners: List[Callable[[str, dict], None]] = []
        self._lock = asyncio.Lock()
        self._last_db_sync: Dict[str, float] = {}

    # ---- events --------------------------------------------------------
    def subscribe(self, callback: Callable[[str, dict], None]) -> None:
        self._listeners.append(callback)

    def unsubscribe(self, callback: Callable[[str, dict], None]) -> None:
        if callback in self._listeners:
            self._listeners.remove(callback)

    def _emit(self, event_type: str, data: dict) -> None:
        for cb in list(self._listeners):
            try:
                cb(event_type, data)
            except Exception:
                logger.exception("Geotag listener notification failed")

    # ---- persistence ---------------------------------------------------
    async def load_saved(self) -> None:
        """Load persisted geotags from MongoDB on backend startup."""
        try:
            db = get_db()
            docs = await db[self.COLLECTION].find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
            for doc in docs:
                try:
                    tag = Geotag(**doc)
                    self._tags[tag.id] = tag
                except Exception:
                    logger.exception("Failed to parse saved geotag %s", doc.get("id"))
            logger.info("Loaded %d saved geotags from MongoDB", len(self._tags))
        except Exception as e:
            logger.warning("MongoDB unavailable for loading geotags: %s", e)

    # ---- detection ingestion with spatial deduplication ----------------
    async def handle_detection(
        self,
        class_name: str,
        confidence: float,
        latitude: float,
        longitude: float,
        altitude: float = 0.0,
        drone_id: Optional[str] = None,
        drone_name: str = "Drone",
    ) -> Optional[Geotag]:
        """Ingest an AI detection and either update an existing nearby tag or create a new geotag."""
        if latitude is None or longitude is None or (abs(latitude) < 0.0001 and abs(longitude) < 0.0001):
            # No valid GPS fix available, skip tagging
            return None

        async with self._lock:
            now_dt = datetime.now(timezone.utc)
            now_ts = now_dt.timestamp()
            now_iso = now_dt.isoformat()

            norm_class = class_name.lower().strip()

            # Check for existing nearby tag of same class within DISTANCE_THRESHOLD
            matched_tag: Optional[Geotag] = None
            for tag in self._tags.values():
                if tag.class_name.lower().strip() == norm_class and tag.status != "dismissed":
                    dist = haversine_distance(tag.latitude, tag.longitude, latitude, longitude)
                    if dist <= self.DISTANCE_THRESHOLD_METERS:
                        # Check timestamp of last update
                        try:
                            tag_dt = datetime.fromisoformat(tag.updated_at.replace("Z", "+00:00"))
                            elapsed = now_ts - tag_dt.timestamp()
                        except Exception:
                            elapsed = 999.0

                        if elapsed <= self.COOLDOWN_SECONDS:
                            matched_tag = tag
                            break

            if matched_tag is not None:
                # Update existing geotag (sighting count & confidence)
                matched_tag.sighting_count += 1
                matched_tag.confidence = round(max(matched_tag.confidence, confidence), 3)
                matched_tag.updated_at = now_iso

                # Sync update to DB every 3 seconds max to avoid DB thrashing
                last_sync = self._last_db_sync.get(matched_tag.id, 0.0)
                if now_ts - last_sync >= 3.0:
                    self._last_db_sync[matched_tag.id] = now_ts
                    try:
                        db = get_db()
                        await db[self.COLLECTION].update_one(
                            {"id": matched_tag.id},
                            {"$set": matched_tag.model_dump()},
                        )
                    except Exception:
                        pass
                    self._emit("geotag_updated", matched_tag.model_dump())

                return matched_tag

            # Create new Geotag
            new_tag = Geotag(
                drone_id=drone_id,
                drone_name=drone_name,
                class_name=norm_class,
                confidence=round(confidence, 3),
                latitude=round(latitude, 7),
                longitude=round(longitude, 7),
                altitude=round(altitude, 1),
                status="detected",
                notes="",
                sighting_count=1,
                created_at=now_iso,
                updated_at=now_iso,
            )

            self._tags[new_tag.id] = new_tag
            self._last_db_sync[new_tag.id] = now_ts

            try:
                db = get_db()
                await db[self.COLLECTION].insert_one(new_tag.model_dump())
            except Exception as e:
                logger.warning("MongoDB unavailable for inserting geotag %s: %s", new_tag.id, e)

            logger.info("New Geotag created: %s at (%s, %s)", new_tag.class_name, new_tag.latitude, new_tag.longitude)
            self._emit("geotag_created", new_tag.model_dump())
            return new_tag

    # ---- CRUD ----------------------------------------------------------
    def list(self) -> List[Geotag]:
        """Return all geotags sorted with newest first."""
        return sorted(self._tags.values(), key=lambda t: t.created_at, reverse=True)

    def get(self, geotag_id: str) -> Optional[Geotag]:
        return self._tags.get(geotag_id)

    async def create(self, payload: GeotagCreate) -> Geotag:
        """Manually create a geotag (e.g. from GCS map click or operator note)."""
        async with self._lock:
            tag = Geotag(
                drone_id=payload.drone_id,
                drone_name=payload.drone_name,
                class_name=payload.class_name.lower().strip(),
                confidence=round(payload.confidence, 3),
                latitude=payload.latitude,
                longitude=payload.longitude,
                altitude=payload.altitude,
                status=payload.status,
                notes=payload.notes,
                sighting_count=1,
            )
            self._tags[tag.id] = tag
            try:
                db = get_db()
                await db[self.COLLECTION].insert_one(tag.model_dump())
            except Exception as e:
                logger.warning("MongoDB unavailable for inserting manual geotag: %s", e)

            self._emit("geotag_created", tag.model_dump())
            return tag

    async def update_status(
        self, geotag_id: str, status: GeotagStatus, notes: Optional[str] = None
    ) -> Optional[Geotag]:
        """Update the operational status and notes of a geotag."""
        async with self._lock:
            tag = self._tags.get(geotag_id)
            if not tag:
                return None

            tag.status = status
            if notes is not None:
                tag.notes = notes
            tag.updated_at = _now_iso()

            try:
                db = get_db()
                await db[self.COLLECTION].update_one(
                    {"id": tag.id},
                    {"$set": tag.model_dump()},
                )
            except Exception as e:
                logger.warning("MongoDB unavailable for updating geotag %s: %s", tag.id, e)

            self._emit("geotag_updated", tag.model_dump())
            return tag

    async def delete(self, geotag_id: str) -> bool:
        """Delete a geotag."""
        async with self._lock:
            tag = self._tags.pop(geotag_id, None)
            if not tag:
                return False

            try:
                db = get_db()
                await db[self.COLLECTION].delete_one({"id": geotag_id})
            except Exception as e:
                logger.warning("MongoDB unavailable for deleting geotag %s: %s", geotag_id, e)

            self._emit("geotag_deleted", {"id": geotag_id})
            return True

    async def clear(self) -> None:
        """Clear all geotags."""
        async with self._lock:
            self._tags.clear()
            try:
                db = get_db()
                await db[self.COLLECTION].delete_many({})
            except Exception as e:
                logger.warning("MongoDB unavailable for clearing geotags: %s", e)

            self._emit("geotag_cleared", {})
