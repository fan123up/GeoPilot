"use client";

import { useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useLayerStore } from "../stores/layerStore";
import { useMapStore } from "../stores/mapStore";
import { useChatInterfaceStore } from "../stores/chatInterfaceStore";

export default function UserDataInitializer() {
  const { user } = useAuth();
  const loadLayersForMap = useLayerStore((s) => s.loadLayersForMap);
  const resetLayers = useLayerStore((s) => s.resetLayers);
  const ensureDefaultMap = useMapStore((s) => s.ensureDefaultMap);
  const clearMaps = useMapStore((s) => s.clearMaps);
  const currentMapId = useMapStore((s) => s.currentMapId);
  const loadConversations = useChatInterfaceStore(
    (s) => s.loadConversations,
  );
  const clearConversationHistory = useChatInterfaceStore(
    (s) => s.clearConversationHistory,
  );

  useEffect(() => {
    if (user === undefined) return;

    if (user === null) {
      resetLayers();
      clearMaps();
      return;
    }

    if (!currentMapId) {
      void ensureDefaultMap();
      return;
    }

    void loadLayersForMap(currentMapId);
  }, [
    user,
    currentMapId,
    ensureDefaultMap,
    loadLayersForMap,
    resetLayers,
    clearMaps,
  ]);

  useEffect(() => {
    if (user === undefined) return;

    if (user === null) {
      clearConversationHistory();
      return;
    }

    void loadConversations();
  }, [user, loadConversations, clearConversationHistory]);

  return null;
}
