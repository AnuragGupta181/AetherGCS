import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import GcsModal from "@/components/GcsModal";
import { geotagsApi } from "@/services/api";
import { useGCS } from "@/store/gcsStore";
import {
  CheckCircle2,
  Eye,
  AlertTriangle,
  XCircle,
  Clock,
  Compass,
  MapPin,
  Send,
  Trash2,
  Copy,
  Radio,
  FileText,
} from "lucide-react";

const STATUS_CONFIG = {
  detected: {
    label: "DETECTED",
    color: "#EF4444",
    bg: "rgba(239, 68, 68, 0.15)",
    border: "#EF4444",
    icon: AlertTriangle,
    desc: "Unreviewed target detected by AI pipeline",
  },
  reviewed: {
    label: "REVIEWED",
    color: "#3B82F6",
    bg: "rgba(59, 130, 246, 0.15)",
    border: "#3B82F6",
    icon: Eye,
    desc: "Target visual confirmed by GCS operator",
  },
  in_progress: {
    label: "IN PROGRESS",
    color: "#F59E0B",
    bg: "rgba(245, 158, 11, 0.15)",
    border: "#F59E0B",
    icon: Radio,
    desc: "Response or rescue team dispatched to coordinates",
  },
  rescued: {
    label: "RESCUED",
    color: "#10B981",
    bg: "rgba(16, 185, 129, 0.15)",
    border: "#10B981",
    icon: CheckCircle2,
    desc: "Target successfully reached, secured, or evacuated",
  },
  dismissed: {
    label: "DISMISSED",
    color: "#9CA3AF",
    bg: "rgba(156, 163, 175, 0.12)",
    border: "#6B7280",
    icon: XCircle,
    desc: "Marked as false alarm or resolved duplicate",
  },
};

export default function GeotagModal({ geotag, open, onOpenChange, onCenterMap }) {
  const addWaypoint = useGCS((s) => s.addWaypoint);
  const draftAlt = useGCS((s) => s.draftMission?.default_altitude || 25);
  const upsertGeotag = useGCS((s) => s.upsertGeotag);
  const removeGeotag = useGCS((s) => s.removeGeotag);

  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    if (geotag) {
      setNotes(geotag.notes || "");
    }
  }, [geotag]);

  if (!geotag) return null;

  const currentStatus = STATUS_CONFIG[geotag.status] || STATUS_CONFIG.detected;
  const accentColor = currentStatus.color;

  const handleStatusChange = async (newStatus) => {
    if (updatingStatus || geotag.status === newStatus) return;
    setUpdatingStatus(true);
    try {
      const updated = await geotagsApi.updateStatus(geotag.id, newStatus, notes);
      upsertGeotag(updated);
      toast.success(`Target status updated to ${STATUS_CONFIG[newStatus]?.label || newStatus}`);
    } catch (err) {
      toast.error("Failed to update status");
      console.error(err);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      const updated = await geotagsApi.updateStatus(geotag.id, geotag.status, notes);
      upsertGeotag(updated);
      toast.success("Operational notes saved");
    } catch (err) {
      toast.error("Failed to save notes");
      console.error(err);
    } finally {
      setSavingNotes(false);
    }
  };

  const handleAddAsWaypoint = () => {
    addWaypoint({
      latitude: geotag.latitude,
      longitude: geotag.longitude,
      altitude: draftAlt,
      action: "waypoint",
      hold_seconds: 5,
    });
    toast.success("Target coordinates added as waypoint in Mission Planner!");
  };

  const handleDelete = async () => {
    try {
      await geotagsApi.remove(geotag.id);
      removeGeotag(geotag.id);
      onOpenChange(false);
      toast.success("Geotag removed");
    } catch (err) {
      toast.error("Failed to delete geotag");
    }
  };

  const handleCopyCoords = () => {
    navigator.clipboard.writeText(`${geotag.latitude.toFixed(7)}, ${geotag.longitude.toFixed(7)}`);
    toast.success("Coordinates copied to clipboard");
  };

  const formattedDate = new Date(geotag.created_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <GcsModal
      open={open}
      onOpenChange={onOpenChange}
      accent={accentColor}
      title={
        <div className="flex items-center gap-2">
          <span className="capitalize">{geotag.class_name} Sighting</span>
          <span
            className="text-[11px] font-mono px-2 py-0.5 rounded font-bold uppercase tracking-wider"
            style={{
              backgroundColor: currentStatus.bg,
              color: currentStatus.color,
              border: `1px solid ${currentStatus.border}`,
            }}
          >
            {currentStatus.label}
          </span>
        </div>
      }
      subtitle={`Sighted by ${geotag.drone_name} · ${geotag.sighting_count} detection frame(s) · AI Confidence ${(geotag.confidence * 100).toFixed(1)}%`}
      testid="geotag-modal"
      footer={
        <div className="w-full flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            className="text-red-400 hover:text-red-300 hover:bg-red-950/30 text-xs flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete Tag
          </Button>
          <Button
            size="sm"
            onClick={() => onOpenChange(false)}
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs px-4"
          >
            Done
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Status Quick Action Buttons */}
        <div>
          <label className="text-xs font-mono uppercase tracking-wider text-zinc-400 mb-1.5 block">
            Update Situation Status
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => handleStatusChange("reviewed")}
              disabled={updatingStatus}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded text-xs font-mono font-bold transition-all border ${
                geotag.status === "reviewed"
                  ? "bg-blue-600/30 text-blue-300 border-blue-500 shadow-sm"
                  : "bg-zinc-900 text-zinc-300 border-zinc-700 hover:border-blue-500 hover:text-blue-300"
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              Reviewed
            </button>

            <button
              type="button"
              onClick={() => handleStatusChange("in_progress")}
              disabled={updatingStatus}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded text-xs font-mono font-bold transition-all border ${
                geotag.status === "in_progress"
                  ? "bg-amber-600/30 text-amber-300 border-amber-500 shadow-sm"
                  : "bg-zinc-900 text-zinc-300 border-zinc-700 hover:border-amber-500 hover:text-amber-300"
              }`}
            >
              <Radio className="w-3.5 h-3.5 animate-pulse" />
              In Progress
            </button>

            <button
              type="button"
              onClick={() => handleStatusChange("rescued")}
              disabled={updatingStatus}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded text-xs font-mono font-bold transition-all border ${
                geotag.status === "rescued"
                  ? "bg-emerald-600/30 text-emerald-300 border-emerald-500 shadow-sm"
                  : "bg-zinc-900 text-zinc-300 border-zinc-700 hover:border-emerald-500 hover:text-emerald-300"
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Rescued
            </button>

            <button
              type="button"
              onClick={() => handleStatusChange("dismissed")}
              disabled={updatingStatus}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded text-xs font-mono font-bold transition-all border ${
                geotag.status === "dismissed"
                  ? "bg-zinc-700/40 text-zinc-200 border-zinc-500 shadow-sm"
                  : "bg-zinc-900 text-zinc-400 border-zinc-700 hover:border-zinc-500 hover:text-zinc-200"
              }`}
            >
              <XCircle className="w-3.5 h-3.5" />
              Dismiss
            </button>
          </div>
          <p className="text-[11px] text-zinc-400 font-mono mt-1.5 italic">
            Current: {currentStatus.desc}
          </p>
        </div>

        {/* Telemetry & Target Details Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-zinc-900/80 p-3 rounded border border-zinc-800 font-mono text-xs">
          <div>
            <div className="text-zinc-400 text-[10px] uppercase flex items-center gap-1">
              <MapPin className="w-3 h-3 text-[#00F0FF]" /> Latitude
            </div>
            <div className="text-zinc-100 font-bold mt-0.5">{geotag.latitude.toFixed(7)}</div>
          </div>
          <div>
            <div className="text-zinc-400 text-[10px] uppercase flex items-center gap-1">
              <MapPin className="w-3 h-3 text-[#00F0FF]" /> Longitude
            </div>
            <div className="text-zinc-100 font-bold mt-0.5">{geotag.longitude.toFixed(7)}</div>
          </div>
          <div>
            <div className="text-zinc-400 text-[10px] uppercase flex items-center gap-1">
              <Compass className="w-3 h-3 text-[#FFB000]" /> Rel Altitude
            </div>
            <div className="text-zinc-100 font-bold mt-0.5">{geotag.altitude.toFixed(1)} m</div>
          </div>
          <div>
            <div className="text-zinc-400 text-[10px] uppercase flex items-center gap-1">
              <Clock className="w-3 h-3 text-zinc-400" /> Sighted At
            </div>
            <div className="text-zinc-100 font-bold mt-0.5">{formattedDate}</div>
          </div>
        </div>

        {/* Tactical Actions */}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            onClick={handleAddAsWaypoint}
            className="bg-[#00F0FF]/15 hover:bg-[#00F0FF]/25 text-[#00F0FF] border border-[#00F0FF]/40 text-xs flex items-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" />
            Set as Mission Waypoint
          </Button>

          {onCenterMap && (
            <Button
              type="button"
              size="sm"
              onClick={() => onCenterMap(geotag.latitude, geotag.longitude)}
              className="bg-[#FFB000]/15 hover:bg-[#FFB000]/25 text-[#FFB000] border border-[#FFB000]/40 text-xs flex items-center gap-1.5"
            >
              <Compass className="w-3.5 h-3.5" />
              Center Map on Target
            </Button>
          )}

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleCopyCoords}
            className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 text-xs flex items-center gap-1.5"
          >
            <Copy className="w-3.5 h-3.5" />
            Copy Lat, Lon
          </Button>
        </div>

        {/* Field / Situation Notes */}
        <div>
          <label className="text-xs font-mono uppercase tracking-wider text-zinc-400 mb-1.5 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-zinc-300" />
            Field & Situation Notes
          </label>
          <div className="flex gap-2">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Survivor in flooded area, waving jacket, calf near fence..."
              rows={2}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded p-2 text-xs text-zinc-100 font-mono resize-none focus:outline-none focus:border-[#00F0FF]"
            />
            <Button
              type="button"
              size="sm"
              disabled={savingNotes}
              onClick={handleSaveNotes}
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs self-end"
            >
              {savingNotes ? "Saving..." : "Save Note"}
            </Button>
          </div>
        </div>
      </div>
    </GcsModal>
  );
}
