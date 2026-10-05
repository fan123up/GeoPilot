"use client";

import { useRef, useState } from "react";
import { useMapStore } from "../../stores/mapStore";
import { useLayerStore } from "../../stores/layerStore";
import { useChatInterfaceStore } from "../../stores/chatInterfaceStore";
import { getApiBase } from "../../utils/apiBase";
import UploadSection from "./UploadSection";
import BasemapSelector from "./BasemapSelector";
import LayerList from "./LayerList";

type BasemapKey =
  | "none"
  | "osm"
  | "google-terrain";

export default function LayerManagement() {
  const [isSaving, setIsSaving] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [newMapName, setNewMapName] = useState("");
  const projectInputRef = useRef<HTMLInputElement>(null);

  const maps = useMapStore((state) => state.maps);
  const basemap = useMapStore((state) => state.basemap);
  const currentMapId = useMapStore((state) => state.currentMapId);
  const setCurrentMapId = useMapStore((state) => state.setCurrentMapId);
  const createMap = useMapStore((state) => state.createMap);
  const loadMaps = useMapStore((state) => state.loadMaps);

  const setBasemap = useMapStore((state) => state.setBasemap);
  const layers = useLayerStore((state) => state.layers);
  const addLayer = useLayerStore((state) => state.addLayer);
  const saveLayersToMap = useLayerStore((state) => state.saveLayersToMap);
  const loadLayersForMap = useLayerStore((state) => state.loadLayersForMap);
  const toggleLayerVisibility = useLayerStore(
    (state) => state.toggleLayerVisibility,
  );
  const removeLayer = useLayerStore((state) => state.removeLayer);
  const reorderLayers = useLayerStore((state) => state.reorderLayers);
  const updateLayerStyle = useLayerStore((state) => state.updateLayerStyle);
  const setZoomTo = useLayerStore((s) => s.setZoomTo);
  const activeConversationId = useChatInterfaceStore(
    (state) => state.activeConversationId,
  );
  const loadConversations = useChatInterfaceStore(
    (state) => state.loadConversations,
  );
  const selectConversation = useChatInterfaceStore(
    (state) => state.selectConversation,
  );

  const handleSaveMap = async () => {
    if (!currentMapId) return;
    setIsSaving(true);
    setSaveMessage(null);
    await saveLayersToMap(currentMapId);
    setSaveMessage("工程已保存。");
    setIsSaving(false);
    setTimeout(() => setSaveMessage(null), 3000);
  };

  const handleCreateMap = async () => {
    const name = newMapName.trim();
    if (!name) return;
    setSaveMessage(null);
    const created = await createMap(name);
    if (created) {
      setNewMapName("");
      setSaveMessage("工程已创建。");
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  const handleExportProject = async () => {
    if (!currentMapId) return;
    setIsTransferring(true);
    setSaveMessage(null);
    try {
      await saveLayersToMap(currentMapId);
      const response = await fetch(
        `${getApiBase()}/maps/${currentMapId}/export`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            basemap,
            active_conversation_id: activeConversationId,
          }),
        },
      );
      if (!response.ok) throw new Error(`Export failed: ${response.status}`);

      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      const currentMap = maps.find((map) => map.id === currentMapId);
      link.href = blobUrl;
      link.download = `${currentMap?.name || "GeoPilot工程"}.geopilot`;
      link.click();
      URL.revokeObjectURL(blobUrl);
      setSaveMessage("工程包已下载。");
    } catch {
      setSaveMessage("工程包导出失败，请重试。");
    } finally {
      setIsTransferring(false);
    }
  };

  const handleImportProject = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsTransferring(true);
    setSaveMessage(null);
    try {
      const formData = new FormData();
      formData.append("project_file", file);
      const response = await fetch(`${getApiBase()}/maps/import`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!response.ok) throw new Error(`Import failed: ${response.status}`);
      const restored = (await response.json()) as {
        map_id: string;
        basemap: { url: string; attribution: string };
        conversation_id: string | null;
      };

      await loadMaps();
      setCurrentMapId(restored.map_id);
      setBasemap(restored.basemap);
      await loadLayersForMap(restored.map_id);
      await loadConversations();
      if (restored.conversation_id) {
        selectConversation(restored.conversation_id);
      }
      setSaveMessage("工程、图层和对话已恢复。");
    } catch {
      setSaveMessage("工程包导入失败，请确认文件有效。");
    } finally {
      event.target.value = "";
      setIsTransferring(false);
    }
  };

  const handleBasemapChange = (selected: string) => {
    const basemaps: Record<BasemapKey, { url: string; attribution: string }> = {
      none: {
        url: "",
        attribution: "",
      },
      osm: {
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
      "google-terrain": {
        url: "https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}",
        attribution: "&copy; Google Terrain",
      },
    };
    setBasemap(basemaps[selected as BasemapKey] || basemaps.osm);
  };

  return (
    <div className="layer-ledger">
      <div className="panel-heading">
        <div>
          <h2>工程图层</h2>
          <p>数据、成果与底图</p>
        </div>
        <span className="panel-count">{layers.length}</span>
      </div>

      <section className="ledger-section project-section" aria-labelledby="project-heading">
        <h3 id="project-heading">地图工程</h3>
        <div className="flex items-center gap-2">
          <select
            className="workspace-control min-w-0 flex-1"
            value={currentMapId ?? ""}
            onChange={(e) =>
              setCurrentMapId(e.target.value ? e.target.value : null)
            }
          >
            {maps.length === 0 && <option value="">暂无工程</option>}
            {maps.map((map) => (
              <option key={map.id} value={map.id}>
                {map.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleSaveMap}
            disabled={!currentMapId || isSaving}
            className="workspace-button workspace-button-primary"
          >
            {isSaving ? "保存中…" : "保存"}
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            className="workspace-control min-w-0 flex-1"
            placeholder="输入新工程名称"
            value={newMapName}
            onChange={(e) => setNewMapName(e.target.value)}
          />
          <button
            onClick={handleCreateMap}
            disabled={!newMapName.trim()}
            className="workspace-button workspace-button-secondary"
          >
            新建
          </button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            onClick={handleExportProject}
            disabled={!currentMapId || isTransferring}
            className="workspace-button workspace-button-primary"
          >
            导出工程
          </button>
          <button
            onClick={() => projectInputRef.current?.click()}
            disabled={isTransferring}
            className="workspace-button workspace-button-secondary"
          >
            导入工程
          </button>
          <input
            ref={projectInputRef}
            type="file"
            accept=".geopilot,application/zip"
            onChange={handleImportProject}
            className="hidden"
          />
        </div>
        {saveMessage && (
          <p className="status-copy">{saveMessage}</p>
        )}
      </section>

      <section className="ledger-section" aria-label="上传空间数据">
        <UploadSection addLayer={addLayer} />
      </section>

      <section className="ledger-section ledger-layers" aria-label="图层列表">
        <LayerList
          layers={layers}
          toggleLayerVisibility={toggleLayerVisibility}
          removeLayer={removeLayer}
          reorderLayers={reorderLayers}
          updateLayerStyle={updateLayerStyle}
          setZoomTo={setZoomTo}
        />
      </section>

      <section className="ledger-section basemap-section" aria-label="底图">
        <BasemapSelector
          onBasemapChange={handleBasemapChange}
          selectedKey={
            !basemap.url
              ? "none"
              : basemap.url.includes("google.com")
                ? "google-terrain"
                : "osm"
          }
        />
      </section>
    </div>
  );
}
