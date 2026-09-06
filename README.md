# AetherGCS

A modern, web-based Multi-Drone Ground Control Station (GCS).

## Overview
AetherGCS allows operators to connect, monitor, and command multiple drones simultaneously through a sleek web interface. It consists of a fast, asynchronous Python backend for hardware communication and a modern React frontend for real-time telemetry and mission planning on an interactive map.

## Key Features
- **Multi-Drone Management**: Connect to multiple drones simultaneously via serial/COM ports (MAVLink protocol).
- **Real-Time Telemetry**: Live drone state (altitude, speed, battery, GPS) streamed at ~5Hz via WebSockets.
- **YOLO11 AI Hazard & Human Detection**: Real-time on-board/server-side AI inference pipeline powered by Ultralytics YOLO11 (`yolo11n.pt`) with tactical bounding box overlays, confidence scores, and instant toggle control.
- **Live FPV Camera & LiDAR Streaming**: Low-latency video streaming (UVC webcams, 5.8GHz OTG receivers, and synthetic SAR thermal/RGB feed) alongside 3D point cloud visualization.
- **Configurable Multi-View Display**: Adjustable multi-select view manager to toggle and position Map, Camera Feed, and LiDAR overlays without screen clutter.
- **Mission Planning & Survey Grids**: Create, edit, and manage complex flight missions with distinct waypoints, altitude profiles, and automated lawnmower survey patterns.
- **Command & Control**: Send real-time commands (e.g., Takeoff, Land, Return to Launch) to one or multiple drones at once.
- **Mission Library & Command History**: Save, duplicate, or import/export missions, with logged command history and status tracking.

## Technology Stack

### Frontend
- **Framework**: React (Create React App / Craco)
- **Styling & UI**: Tailwind CSS, Radix UI, Lucide Icons
- **Maps**: Leaflet & React-Leaflet
- **State Management**: Zustand & React Query
- **Testing & Build**: Jest, React Testing Library, Craco Build
- **Deployment**: Vercel

### Backend
- **Framework**: Python 3.10+ & FastAPI
- **Computer Vision & AI**: Ultralytics YOLO11, OpenCV (`cv2`), NumPy
- **Real-Time**: WebSockets for telemetry broadcasting & binary MJPEG streaming
- **Drone Comms**: PyMAVLink & PySerial
- **Database**: MongoDB (using Motor for async I/O)
- **Deployment**: Render


---

## Getting Started (Local Development)

### Prerequisites
- Node.js (v18+) & `pnpm` (or `npm` / `yarn`)
- Python 3.10+ (or `uv` / `pip`)
- MongoDB (running locally on port 27017 or MongoDB Atlas connection string)

### 1. Backend Setup

```bash
cd backend
python -m venv .venv

# Activate the virtual environment:
# On Windows:
.\.venv\Scripts\activate
# On Mac/Linux:
source .venv/bin/activate

pip install -r requirements.txt
```

Set up your environment variables by copying the example file:
```bash
cp .env.example .env
```

Your `backend/.env` file should configure the following:
```env
# MongoDB connection URI
MONGO_URL="mongodb://localhost:27017"

# Database name
DB_NAME="aether_gcs"

# CORS origins (comma-separated or * for all)
CORS_ORIGINS="*"
```

Run the backend server:
```bash
uvicorn server:app --reload
```
The API will be available at `http://localhost:8000`.

---

### 2. Frontend Setup

```bash
cd frontend
pnpm install
# Or: npm install --legacy-peer-deps
```

Set up your environment variables by copying the example file:
```bash
cp .env.example .env
```

Your `frontend/.env` file should configure the following:
```env
REACT_APP_BACKEND_URL=http://localhost:8000
WDS_SOCKET_PORT=443
ENABLE_HEALTH_CHECK=false
DISABLE_ESLINT_PLUGIN=true
```

Run the React development server:
```bash
pnpm start
# Or: npm start
```
The application will be available at `http://localhost:3000`.

To build the frontend for production:
```bash
pnpm build
# Or: npm run build
```

---

## AI Hazard Detection & Model Architecture

AetherGCS features a dedicated computer vision pipeline powered by **Ultralytics YOLO11**:
- **Current Model**: `yolo11n.pt` (saved at `backend/yolo11n.pt`), pre-trained on COCO for real-time human / survivor detection.
- **Tactical OSD**: Draws bounding boxes, confidence tags, and class identifiers server-side with zero latency jitter.
- **Custom Disaster Model Upgrade**: Drop your custom-trained disaster model weights (`.pt` file trained for floods, landslides, fires, or structural collapse) into the `backend/` directory, and update `model_path` in `backend/gcs/ai_pipeline.py`.

### Camera & Vision REST Endpoints
| Endpoint | Method | Description |
|:---|:---:|:---|
| `/api/camera/devices` | `GET` | Lists available physical video capture devices and synthetic feeds |
| `/api/camera/status` | `GET` | Returns active camera state, current FPS, source, and streaming stats |
| `/api/camera/start?source=0` | `POST` | Starts video capture on specified device index or `'synthetic'` |
| `/api/camera/stop` | `POST` | Stops video streaming and frees hardware capture handle |
| `/api/camera/ai/status` | `GET` | Returns active status of YOLO11 detection pipeline |
| `/api/camera/ai/toggle?state=true` | `POST` | Toggles or explicitly sets AI inference state |
| `/api/ws/camera` | `WebSocket`| High-speed binary MJPEG stream for live FPV video feed |

---

## Running Tests

### Backend Tests (pytest)
Runs full integration and unit tests for drones, missions, commands, WebSocket telemetry, camera, and AI pipelines:
```bash
cd backend
env -u PYTHONPATH ./.venv/bin/pytest -v tests/test_gcs_backend.py
```

### Frontend Tests & Production Build
```bash
cd frontend
# Run Jest test suite:
CI=true npm test -- --watchAll=false

# Run production build:
npm run build
```

---

## Deployment
For production, the recommended hosting stack is:
- **Database**: MongoDB Atlas (Free Tier)
- **Backend**: Render (Web Service)
- **Frontend**: Vercel

### Deploying Backend to Render
When configuring your Web Service on Render:
1. **Root Directory**: `backend` (if repo root is not `backend`)
2. **Build Command**: `pip install -r requirements.txt`
3. **Start Command**: `uvicorn server:app --host 0.0.0.0 --port $PORT`
   *(Crucial: Render requires binding to `0.0.0.0` and using the dynamic `$PORT` environment variable)*
4. **Health Check Path**: `/health` (supports both `GET` and `HEAD` requests)
5. **Environment Variables**:
   - `MONGO_URL`: Your MongoDB Atlas connection string
   - `DB_NAME`: `aether_gcs`
   - `CORS_ORIGINS`: Your production frontend URL (e.g. `https://your-aethergcs.vercel.app`)

*Make sure to update your production environment variables (like `REACT_APP_BACKEND_URL` in Vercel) to point to your live Render backend URL!*


