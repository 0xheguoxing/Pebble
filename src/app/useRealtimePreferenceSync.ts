import { useEffect } from "react";
import { setNotificationsEnabled, setRealtimePreference } from "@/lib/api";
import { useUIStore } from "@/stores/ui.store";

let realtimePreferenceTransition = Promise.resolve();

function enqueueRealtimePreference(mode: "realtime" | "balanced" | "battery" | "manual") {
  const transition = realtimePreferenceTransition
    .catch(() => {})
    .then(() => setRealtimePreference(mode));
  realtimePreferenceTransition = transition;
  void transition.catch(() => {});
}

export function useRealtimePreferenceSync() {
  const realtimeMode = useUIStore((state) => state.realtimeMode);
  const notificationsEnabled = useUIStore((state) => state.notificationsEnabled);

  useEffect(() => {
    void setNotificationsEnabled(notificationsEnabled).catch(() => {});
  }, [notificationsEnabled]);

  useEffect(() => {
    enqueueRealtimePreference(realtimeMode);
  }, [realtimeMode]);
}
