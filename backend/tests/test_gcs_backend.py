"""GCS backend API + WebSocket tests."""
import asyncio
import json
import os
import sys
import time

# Ensure backend root is in sys.path
backend_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_root not in sys.path:
    sys.path.insert(0, backend_root)

import pytest
import requests
import websockets

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://127.0.0.1:8000").rstrip("/")
API = f"{BASE_URL}/api"
WS_URL = API.replace("http", "ws") + "/ws/telemetry"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    yield s


def _create_drone(session, name="TEST_Alpha"):
    payload = {
        "name": name,
        "system_id": 1,
        "component_id": 1,
        "connection": {"connection_type": "simulator", "address": "sim://local", "port": 0},
        "home_lat": 37.7749,
        "home_lon": -122.4194,
        "home_alt": 0.0,
    }
    r = session.post(f"{API}/drones", json=payload, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()


# --- Drone CRUD & lifecycle ------------------------------------------------
class TestDrones:
    def test_list_drones_initial(self, session):
        r = session.get(f"{API}/drones", timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_drone(self, session):
        d = _create_drone(session, "TEST_Create")
        assert "id" in d and len(d["id"]) > 10
        assert d["name"] == "TEST_Create"
        assert d["status"] == "disconnected"
        assert d["home_lat"] == 37.7749
        assert d["telemetry"]["armed"] is False
        # verify via GET
        r = session.get(f"{API}/drones/{d['id']}", timeout=10)
        assert r.status_code == 200
        assert r.json()["id"] == d["id"]
        session.delete(f"{API}/drones/{d['id']}", timeout=10)

    def test_connect_disconnect(self, session):
        d = _create_drone(session, "TEST_Conn")
        r = session.post(f"{API}/drones/{d['id']}/connect", timeout=10)
        assert r.status_code == 200
        # wait for telemetry ticks
        time.sleep(1.5)
        r = session.get(f"{API}/drones/{d['id']}", timeout=10)
        assert r.json()["status"] == "connected"
        r = session.post(f"{API}/drones/{d['id']}/disconnect", timeout=10)
        assert r.status_code == 200
        assert r.json()["status"] == "disconnected"
        session.delete(f"{API}/drones/{d['id']}", timeout=10)


# --- Commands ---------------------------------------------------------------
class TestCommands:
    def test_arm_takeoff_land(self, session):
        d = _create_drone(session, "TEST_Cmd")
        session.post(f"{API}/drones/{d['id']}/connect", timeout=10)
        time.sleep(0.8)

        # ARM
        r = session.post(f"{API}/commands", json={"drone_ids": [d["id"]], "command": "arm"}, timeout=10)
        assert r.status_code == 200
        time.sleep(0.5)
        t = session.get(f"{API}/drones/{d['id']}", timeout=10).json()["telemetry"]
        assert t["armed"] is True

        # TAKEOFF
        session.post(f"{API}/commands", json={"drone_ids": [d["id"]], "command": "takeoff", "params": {"altitude": 10}}, timeout=10)
        time.sleep(4)
        t = session.get(f"{API}/drones/{d['id']}", timeout=10).json()["telemetry"]
        assert t["altitude_relative"] > 1.0, f"altitude did not climb: {t['altitude_relative']}"

        # LAND
        session.post(f"{API}/commands", json={"drone_ids": [d["id"]], "command": "land"}, timeout=10)
        time.sleep(10)
        t = session.get(f"{API}/drones/{d['id']}", timeout=10).json()["telemetry"]
        assert t["altitude_relative"] <= 0.1
        assert t["armed"] is False

        session.delete(f"{API}/drones/{d['id']}", timeout=10)

    def test_emergency_stop(self, session):
        d = _create_drone(session, "TEST_ES")
        session.post(f"{API}/drones/{d['id']}/connect", timeout=10)
        time.sleep(0.8)
        session.post(f"{API}/commands", json={"drone_ids": [d["id"]], "command": "arm"}, timeout=10)
        time.sleep(0.3)
        session.post(f"{API}/commands", json={"drone_ids": [d["id"]], "command": "emergency_stop"}, timeout=10)
        time.sleep(0.5)
        t = session.get(f"{API}/drones/{d['id']}", timeout=10).json()["telemetry"]
        assert t["armed"] is False
        assert t["ground_speed"] == 0.0
        session.delete(f"{API}/drones/{d['id']}", timeout=10)

    def test_multi_drone_command(self, session):
        d1 = _create_drone(session, "TEST_M1")
        d2 = _create_drone(session, "TEST_M2")
        session.post(f"{API}/drones/{d1['id']}/connect", timeout=10)
        session.post(f"{API}/drones/{d2['id']}/connect", timeout=10)
        time.sleep(0.8)
        r = session.post(f"{API}/commands", json={"drone_ids": [d1["id"], d2["id"]], "command": "arm"}, timeout=10)
        assert r.status_code == 200
        assert r.json()["count"] == 2
        time.sleep(0.5)
        for did in (d1["id"], d2["id"]):
            t = session.get(f"{API}/drones/{did}", timeout=10).json()["telemetry"]
            assert t["armed"] is True
        session.delete(f"{API}/drones/{d1['id']}", timeout=10)
        session.delete(f"{API}/drones/{d2['id']}", timeout=10)


# --- Missions ---------------------------------------------------------------
class TestMissions:
    def test_mission_crud(self, session):
        payload = {
            "name": "TEST_Mission1",
            "description": "test",
            "default_altitude": 25.0,
            "default_speed": 6.0,
            "waypoints": [
                {"seq": 0, "latitude": 37.7749, "longitude": -122.4194, "altitude": 20, "action": "waypoint"},
                {"seq": 1, "latitude": 37.7750, "longitude": -122.4195, "altitude": 20, "action": "waypoint"},
            ],
        }
        r = session.post(f"{API}/missions", json=payload, timeout=10)
        assert r.status_code == 200
        m = r.json()
        assert len(m["waypoints"]) == 2
        mid = m["id"]

        # list
        r = session.get(f"{API}/missions", timeout=10)
        assert any(mm["id"] == mid for mm in r.json())

        # update
        payload["name"] = "TEST_Mission1_upd"
        r = session.put(f"{API}/missions/{mid}", json=payload, timeout=10)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Mission1_upd"

        # duplicate
        r = session.post(f"{API}/missions/{mid}/duplicate", timeout=10)
        assert r.status_code == 200
        dup_id = r.json()["id"]
        assert dup_id != mid

        # delete
        r = session.delete(f"{API}/missions/{mid}", timeout=10)
        assert r.status_code == 200
        r = session.get(f"{API}/missions/{mid}", timeout=10)
        assert r.status_code == 404

        session.delete(f"{API}/missions/{dup_id}", timeout=10)


# --- History ---------------------------------------------------------------
class TestHistory:
    def test_history(self, session):
        r = session.get(f"{API}/history", timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        if r.json():
            entry = r.json()[0]
            for key in ("ts", "drone_id", "command", "status"):
                assert key in entry


# --- WebSocket ------------------------------------------------------------
class TestWebSocket:
    def test_ws_snapshot_and_updates(self, session):
        d = _create_drone(session, "TEST_WS")
        session.post(f"{API}/drones/{d['id']}/connect", timeout=10)

        async def run():
            events = []
            async with websockets.connect(WS_URL) as ws:
                # snapshot
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                events.append(msg["event"])
                # drone updates
                deadline = time.time() + 5
                drone_updates = 0
                while time.time() < deadline and drone_updates < 5:
                    m = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                    events.append(m["event"])
                    if m["event"] == "drone":
                        drone_updates += 1
            return events, drone_updates

        events, drone_updates = asyncio.run(run())
        assert events[0] == "snapshot"
        assert drone_updates >= 3, f"expected >=3 drone updates, got {drone_updates}"
        session.delete(f"{API}/drones/{d['id']}", timeout=10)


# --- Camera & AI Detection ------------------------------------------------
class TestCameraAndAI:
    def test_camera_status_and_devices(self, session):
        r = session.get(f"{API}/camera/status", timeout=10)
        assert r.status_code == 200
        assert "running" in r.json()

        r = session.get(f"{API}/camera/devices", timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_camera_ai_pipeline_status_and_toggle(self, session):
        # Check initial status
        r = session.get(f"{API}/camera/ai/status", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert "ai_active" in data

        # Explicit toggle to True
        r = session.post(f"{API}/camera/ai/toggle?state=true", timeout=10)
        assert r.status_code == 200
        assert r.json()["ai_active"] is True

        # Explicit toggle to False
        r = session.post(f"{API}/camera/ai/toggle?state=false", timeout=10)
        assert r.status_code == 200
        assert r.json()["ai_active"] is False

        # Toggle inversion (False -> True)
        r = session.post(f"{API}/camera/ai/toggle", timeout=10)
        assert r.status_code == 200
        assert r.json()["ai_active"] is True

        # Restore to False
        r = session.post(f"{API}/camera/ai/toggle?state=false", timeout=10)
        assert r.status_code == 200
        assert r.json()["ai_active"] is False


class TestHazardDetectorPipeline:
    def test_detector_inference_unit(self):
        import sys
        backend_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if backend_root not in sys.path:
            sys.path.insert(0, backend_root)

        import numpy as np
        from gcs.ai_pipeline import HazardDetector

        detector = HazardDetector()
        assert detector.is_active is False
        assert detector.model is not None

        # Test frame processing when inactive (passthrough)
        test_frame = np.zeros((480, 640, 3), dtype=np.uint8)
        processed = detector.process_frame(test_frame)
        assert processed.shape == (480, 640, 3)

        # Activate and test processing
        detector.toggle(True)
        assert detector.is_active is True
        processed_active = detector.process_frame(test_frame)
        assert processed_active.shape == (480, 640, 3)
        assert processed_active.dtype == np.uint8

        # Clean up / deactivate
        detector.toggle(False)
        assert detector.is_active is False


# --- Geotags & AI Geotagging ---------------------------------------------
class TestGeotagManagerUnit:
    def test_living_being_keywords(self):
        from gcs.ai_pipeline import is_living_being
        assert is_living_being("person") is True
        assert is_living_being("Human") is True
        assert is_living_being("cow") is True
        assert is_living_being("sheep") is True
        assert is_living_being("dog") is True
        assert is_living_being("cat") is True
        assert is_living_being("car") is False
        assert is_living_being("traffic light") is False
        assert is_living_being("airplane") is False

    def test_deduplication_5m_15s(self):
        from gcs.geotag_manager import GeotagManager, haversine_distance

        manager = GeotagManager(mongo_db=None)

        # Base location
        lat1, lon1 = 28.676643, 77.501816
        # Very close location (~2 meters away: 0.00002 deg lat is ~2.22m)
        lat2, lon2 = 28.676661, 77.501816
        dist = haversine_distance(lat1, lon1, lat2, lon2)
        assert dist < 5.0, f"Expected < 5m distance, got {dist}"

        async def run_flow():
            # First detection creates geotag
            tag1 = await manager.handle_detection(
                class_name="person",
                confidence=0.92,
                latitude=lat1,
                longitude=lon1,
                altitude=12.5,
                drone_id="drone-test",
            )
            assert tag1 is not None
            assert tag1.sighting_count == 1
            initial_id = tag1.id

            # Second detection 2m away immediately (< 15s) -> deduplicated
            tag2 = await manager.handle_detection(
                class_name="person",
                confidence=0.95,
                latitude=lat2,
                longitude=lon2,
                altitude=12.7,
                drone_id="drone-test",
            )
            assert tag2.id == initial_id
            assert tag2.sighting_count == 2
            assert tag2.confidence == 0.95
            assert len(manager.list()) == 1

            # Third detection > 5m away (~50m away: 0.0005 deg lat is ~55m)
            lat3 = lat1 + 0.0005
            tag3 = await manager.handle_detection(
                class_name="person",
                confidence=0.88,
                latitude=lat3,
                longitude=lon1,
                altitude=15.0,
                drone_id="drone-test",
            )
            assert tag3.id != initial_id
            assert len(manager.list()) == 2

        asyncio.run(run_flow())


class TestGeotagsApi:
    def test_geotag_crud_lifecycle(self, session):
        # 1. Create a geotag via POST
        create_payload = {
            "drone_id": "drone-sim-1",
            "drone_name": "SkyGuard-1",
            "class_name": "person",
            "confidence": 0.94,
            "latitude": 28.676643,
            "longitude": 77.501816,
            "altitude": 14.2,
            "notes": "Spotted near east perimeter",
        }
        r = session.post(f"{API}/geotags", json=create_payload, timeout=10)
        assert r.status_code == 200
        tag = r.json()
        tag_id = tag["id"]
        assert tag["class_name"] == "person"
        assert tag["status"] == "detected"
        assert tag["latitude"] == 28.676643

        # 2. Get by ID
        r = session.get(f"{API}/geotags/{tag_id}", timeout=10)
        assert r.status_code == 200
        assert r.json()["id"] == tag_id

        # 3. List geotags
        r = session.get(f"{API}/geotags", timeout=10)
        assert r.status_code == 200
        all_tags = r.json()
        assert any(t["id"] == tag_id for t in all_tags)

        # 4. Update status: reviewed
        r = session.patch(f"{API}/geotags/{tag_id}/status", json={"status": "reviewed", "notes": "Reviewed by operator"}, timeout=10)
        assert r.status_code == 200
        assert r.json()["status"] == "reviewed"
        assert r.json()["notes"] == "Reviewed by operator"

        # 5. Update status: in_progress
        r = session.patch(f"{API}/geotags/{tag_id}/status", json={"status": "in_progress"}, timeout=10)
        assert r.status_code == 200
        assert r.json()["status"] == "in_progress"

        # 6. Update status: rescued
        r = session.patch(f"{API}/geotags/{tag_id}/status", json={"status": "rescued", "notes": "Target safely secured"}, timeout=10)
        assert r.status_code == 200
        assert r.json()["status"] == "rescued"

        # 7. Delete geotag
        r = session.delete(f"{API}/geotags/{tag_id}", timeout=10)
        assert r.status_code == 200

        # Verify deletion
        r = session.get(f"{API}/geotags/{tag_id}", timeout=10)
        assert r.status_code == 404


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


