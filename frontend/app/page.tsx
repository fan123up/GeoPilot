"use client";

import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Layers,
  Map as MapIcon,
  Menu,
  MessageCircle,
  Radio,
  X,
} from "lucide-react";
import AgentInterface from "./components/chat/AgentInterface";
import MapComponent from "./components/maps/MapComponent";
import LayerManagement from "./components/sidebar/LayerManagement";
import Sidebar from "./components/sidebar/Sidebar";
import { useChatInterfaceStore } from "./stores/chatInterfaceStore";
import { useLayerStore } from "./stores/layerStore";
import { useUIStore } from "./stores/uiStore";

export default function Home() {
  const setLayerPanelCollapsed = useUIStore(
    (state) => state.setLayerPanelCollapsed,
  );
  const layerCount = useLayerStore((state) => state.layers.length);
  const isStreaming = useChatInterfaceStore((state) => state.isStreaming);

  const [layerCollapsed, setLayerCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const viewportWidth = window.innerWidth;
    if (viewportWidth < 900) {
      setLayerCollapsed(true);
      setChatCollapsed(true);
    } else if (viewportWidth < 1180) {
      setLayerCollapsed(true);
    }
  }, []);

  return (
    <main className="geopilot-shell">
      <header className="workspace-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <MapIcon size={20} strokeWidth={1.8} />
          </span>
          <div>
            <h1>GeoPilot</h1>
            <p>空间分析工作台</p>
          </div>
        </div>

        <div className="workspace-header-nav hidden md:flex">
          <Sidebar onLayerToggle={() => setLayerCollapsed(!layerCollapsed)} />
        </div>

        <div className="workspace-readouts" aria-label="工作区状态">
          <span className="readout">
            <Layers size={14} /> {layerCount} 个图层
          </span>
          <span className={`readout ${isStreaming ? "is-live" : ""}`}>
            <Radio size={14} /> {isStreaming ? "Agent 运行中" : "Agent 就绪"}
          </span>
        </div>

        <button
          className="mobile-menu-button md:hidden"
          onClick={() => setMobileMenuOpen(true)}
          aria-label="打开工作区菜单"
        >
          <Menu size={21} />
        </button>
      </header>

      {mobileMenuOpen && (
        <div
          className="mobile-menu-scrim"
          onClick={() => setMobileMenuOpen(false)}
        >
          <aside
            className="mobile-menu-panel"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mobile-menu-heading">
              <div>
                <strong>工作区</strong>
                <span>工程导航</span>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                aria-label="关闭工作区菜单"
              >
                <X size={19} />
              </button>
            </div>
            <Sidebar
              onLayerToggle={() => {
                setLayerCollapsed(false);
                setMobileMenuOpen(false);
              }}
            />
          </aside>
        </div>
      )}

      <div className="workspace-frame">
        <section className="map-stage" aria-label="交互式地图">
          <div className="map-surface">
            <MapComponent />
          </div>
        </section>

        {!layerCollapsed && (
          <section
            className="workspace-panel layer-panel"
            aria-label="工程图层"
          >
            <button
              className="panel-collapse panel-collapse-right"
              onClick={() => {
                setLayerCollapsed(true);
                setLayerPanelCollapsed(true);
              }}
              aria-label="收起图层面板"
            >
              <ChevronLeft size={17} />
            </button>
            <LayerManagement />
          </section>
        )}

        {!chatCollapsed && (
          <section
            className="workspace-panel agent-panel"
            aria-label="GeoPilot Agent 面板"
          >
            <button
              className="panel-collapse panel-collapse-left"
              onClick={() => setChatCollapsed(true)}
              aria-label="收起 Agent 面板"
            >
              <ChevronRight size={17} />
            </button>
            <AgentInterface />
          </section>
        )}

        <div className="workspace-dock">
          {layerCollapsed && (
            <button
              onClick={() => {
                setLayerCollapsed(false);
                setLayerPanelCollapsed(false);
              }}
              aria-label="打开工程图层"
            >
              <Layers size={18} />
              <span>图层</span>
            </button>
          )}
          {chatCollapsed && (
            <button
              onClick={() => setChatCollapsed(false)}
              aria-label="打开 GeoPilot Agent"
            >
              <MessageCircle size={18} />
              <span>Agent</span>
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
