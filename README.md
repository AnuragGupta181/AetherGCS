# AetherGCS

A modern, web-based Multi-Drone Ground Control Station (GCS).

## Overview
AetherGCS allows operators to connect, monitor, and command multiple drones simultaneously through a sleek web interface. It consists of a fast, asynchronous Python backend for hardware communication and a modern React frontend for real-time telemetry and mission planning on an interactive map.

## Key Features
- **Multi-Drone Management**: Connect to multiple drones simultaneously via serial/COM ports (MAVLink protocol).
- **Real-Time Telemetry**: Live drone state (altitude, speed, battery, GPS) streamed at ~5Hz via WebSockets.
- **Mission Planning**: Create, edit, and manage complex flight missions with distinct waypoints and altitude profiles.
- **Command & Control**: Send real-time commands (e.g., Takeoff, Land, Return to Launch) to one or multiple drones at once.
- **Mission Library**: Save missions to the database, duplicate them, or import/export them as JSON files.
- **Command History**: Keep a logged history of all commands sent to the fleet and their execution status.

## Technology Stack

### Frontend
- **Framework**: React (Create React App / Craco)
- **Styling & UI**: Tailwind CSS, Radix UI, Lucide Icons
- **Maps**: Leaflet & React-Leaflet
- **State Management**: Zustand & React Query
- **Deployment**: Vercel

### Backend
- **Framework**: Python 3.10+ & FastAPI
- **Real-Time**: WebSockets for telemetry broadcasting
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

## Deployment
For production, the recommended hosting stack is:
- **Database**: MongoDB Atlas (Free Tier)
- **Backend**: Render (Web Service)
- **Frontend**: Vercel

*Make sure to update your production environment variables (like `REACT_APP_BACKEND_URL` and `MONGO_URL`) on the respective hosting platforms!*
