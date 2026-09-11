import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

const DEFAULT_MISSION = { name: "New Mission", default_altitude: 20, default_speed: 5, waypoints: [] };

const _getTargetKey = (s) => {
  if (s.selectedDroneIds && s.selectedDroneIds.length > 1) return "swarm";
  if (s.selectedDroneIds && s.selectedDroneIds.length === 1) return s.selectedDroneIds[0];
  return s.activeDroneId || "default";
};

const _syncDraft = (s, updatedMissions = null) => {
  const missions = updatedMissions || s.draftMissions || {};
  const key = _getTargetKey(s);
  const current = missions[key] || { ...DEFAULT_MISSION };
  return {
    draftMissions: missions,
    draftMission: current,
  };
};

/**
 * Central GCS state store with per-drone draft mission isolation.
 */
export const useGCS = create((set, get) => ({
  drones: {},
  selectedDroneIds: [],
  activeDroneId: null,
  wsStatus: "connecting",
  commandHistory: [],

  // Per-drone mission isolation
  draftMissions: {},
  draftMission: { ...DEFAULT_MISSION },

  missions: [],
  geotags: {},
  selectedGeotagId: null,
  filterGeotagStatus: "all",
  levelCardOpen: true,
  toggleLevelCard: () => set((s) => ({ levelCardOpen: !s.levelCardOpen })),

  // Central workspace layout: "grid-3" | "split-v" | "split-h" | "full-map"
  layoutMode: "grid-3",
  setLayoutMode: (mode) => {
    set({ layoutMode: mode });
    setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
    setTimeout(() => window.dispatchEvent(new Event("resize")), 250);
  },

  setSnapshot: (droneList, geotagsList = null) => {
    const map = {};
    droneList.forEach((d) => (map[d.id] = d));
    const nextActive = get().activeDroneId || (droneList[0]?.id ?? null);
    set((s) => {
      let nextGeotags = s.geotags;
      if (Array.isArray(geotagsList)) {
        nextGeotags = {};
        geotagsList.forEach((g) => (nextGeotags[g.id] = g));
      }
      const next = { ...s, drones: map, geotags: nextGeotags, activeDroneId: nextActive };
      return { ...next, ..._syncDraft(next) };
    });
  },

  upsertDrone: (d) =>
    set((s) => {
      const nextActive = s.activeDroneId || d.id;
      const next = { ...s, drones: { ...s.drones, [d.id]: d }, activeDroneId: nextActive };
      return { ...next, ..._syncDraft(next) };
    }),

  removeDrone: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.drones;
      const { [id]: __, ...restMissions } = s.draftMissions;
      const nextActive = s.activeDroneId === id ? Object.keys(rest)[0] || null : s.activeDroneId;
      const nextSelected = s.selectedDroneIds.filter((x) => x !== id);
      const next = { ...s, drones: rest, selectedDroneIds: nextSelected, activeDroneId: nextActive };
      return { ...next, ..._syncDraft(next, restMissions) };
    }),

  setSelected: (ids) =>
    set((s) => {
      const next = { ...s, selectedDroneIds: ids };
      return { ...next, ..._syncDraft(next) };
    }),

  toggleSelected: (id) =>
    set((s) => {
      const has = s.selectedDroneIds.includes(id);
      const nextIds = has
        ? s.selectedDroneIds.filter((x) => x !== id)
        : [...s.selectedDroneIds, id];
      const next = { ...s, selectedDroneIds: nextIds };
      return { ...next, ..._syncDraft(next) };
    }),

  selectAll: () =>
    set((s) => {
      const next = { ...s, selectedDroneIds: Object.keys(s.drones) };
      return { ...next, ..._syncDraft(next) };
    }),

  deselectAll: () =>
    set((s) => {
      const next = { ...s, selectedDroneIds: [] };
      return { ...next, ..._syncDraft(next) };
    }),

  setActive: (id) =>
    set((s) => {
      const next = { ...s, activeDroneId: id };
      return { ...next, ..._syncDraft(next) };
    }),

  setWsStatus: (s) => set({ wsStatus: s }),

  addCommandLog: (log) =>
    set((s) => ({ commandHistory: [log, ...s.commandHistory].slice(0, 300) })),
  setCommandHistory: (list) => set({ commandHistory: list }),

  setDraftMission: (m) =>
    set((s) => {
      const key = _getTargetKey(s);
      const updatedMissions = { ...s.draftMissions, [key]: m };
      return _syncDraft(s, updatedMissions);
    }),

  addWaypoint: (wp) =>
    set((s) => {
      const key = _getTargetKey(s);
      const current = s.draftMissions[key] || s.draftMission || { ...DEFAULT_MISSION };
      const nextWps = [...current.waypoints, { ...wp, seq: current.waypoints.length }];
      const updatedMission = { ...current, waypoints: nextWps };
      const updatedMissions = { ...s.draftMissions, [key]: updatedMission };
      return _syncDraft(s, updatedMissions);
    }),

  updateWaypoint: (seq, patch) =>
    set((s) => {
      const key = _getTargetKey(s);
      const current = s.draftMissions[key] || s.draftMission || { ...DEFAULT_MISSION };
      const nextWps = current.waypoints.map((w) => (w.seq === seq ? { ...w, ...patch } : w));
      const updatedMission = { ...current, waypoints: nextWps };
      const updatedMissions = { ...s.draftMissions, [key]: updatedMission };
      return _syncDraft(s, updatedMissions);
    }),

  removeWaypoint: (seq) =>
    set((s) => {
      const key = _getTargetKey(s);
      const current = s.draftMissions[key] || s.draftMission || { ...DEFAULT_MISSION };
      const nextWps = current.waypoints.filter((w) => w.seq !== seq).map((w, i) => ({ ...w, seq: i }));
      const updatedMission = { ...current, waypoints: nextWps };
      const updatedMissions = { ...s.draftMissions, [key]: updatedMission };
      return _syncDraft(s, updatedMissions);
    }),

  clearWaypoints: () =>
    set((s) => {
      const key = _getTargetKey(s);
      const current = s.draftMissions[key] || s.draftMission || { ...DEFAULT_MISSION };
      const updatedMission = { ...current, waypoints: [] };
      const updatedMissions = { ...s.draftMissions, [key]: updatedMission };
      return _syncDraft(s, updatedMissions);
    }),

  setDraftWaypoints: (list) =>
    set((s) => {
      const key = _getTargetKey(s);
      const current = s.draftMissions[key] || s.draftMission || { ...DEFAULT_MISSION };
      const updatedMission = { ...current, waypoints: list };
      const updatedMissions = { ...s.draftMissions, [key]: updatedMission };
      return _syncDraft(s, updatedMissions);
    }),

  reorderWaypoints: (list) =>
    set((s) => {
      const key = _getTargetKey(s);
      const current = s.draftMissions[key] || s.draftMission || { ...DEFAULT_MISSION };
      const updatedMission = { ...current, waypoints: list.map((w, i) => ({ ...w, seq: i })) };
      const updatedMissions = { ...s.draftMissions, [key]: updatedMission };
      return _syncDraft(s, updatedMissions);
    }),

  setMissions: (list) => set({ missions: list }),

  userLocation: null,
  setUserLocation: (loc) => set({ userLocation: loc }),

  // Geotags Actions
  setSelectedGeotagId: (id) => set({ selectedGeotagId: id }),
  setFilterGeotagStatus: (status) => set({ filterGeotagStatus: status }),
  setGeotags: (list) =>
    set((s) => {
      const map = {};
      list.forEach((g) => (map[g.id] = g));
      return { geotags: map };
    }),
  upsertGeotag: (tag) =>
    set((s) => ({
      geotags: { ...s.geotags, [tag.id]: tag },
    })),
  removeGeotag: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.geotags;
      const nextSelected = s.selectedGeotagId === id ? null : s.selectedGeotagId;
      return { geotags: rest, selectedGeotagId: nextSelected };
    }),
  clearGeotags: () => set({ geotags: {}, selectedGeotagId: null }),
}));

// Selectors
export const useDroneList = () =>
  useGCS(useShallow((s) => Object.values(s.drones)));
export const useSelectedDrones = () =>
  useGCS(useShallow((s) => s.selectedDroneIds.map((id) => s.drones[id]).filter(Boolean)));
export const useActiveDrone = () =>
  useGCS((s) => (s.activeDroneId ? s.drones[s.activeDroneId] : null));
export const useGeotagList = () =>
  useGCS(useShallow((s) => Object.values(s.geotags).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))));
export const useSelectedGeotag = () =>
  useGCS((s) => (s.selectedGeotagId ? s.geotags[s.selectedGeotagId] : null));
