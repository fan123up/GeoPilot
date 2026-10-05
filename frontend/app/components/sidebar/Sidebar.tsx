"use client";

import { Layers, LogOut, Map, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";

interface SidebarProps {
  onLayerToggle?: () => void;
}

export default function Sidebar({ onLayerToggle }: SidebarProps) {
  const router = useRouter();
  const { user, logout } = useAuth();

  const handleSignOut = async () => {
    await logout();
    router.push("/login");
  };

  return (
    <nav className="project-rail" aria-label="工程导航">
      <div className="project-rail-primary">
        <Link className="rail-action is-current" href="/map" title="地图工作区">
          <Map size={19} />
          <span>地图</span>
        </Link>
        {onLayerToggle && (
          <button
            className="rail-action"
            onClick={onLayerToggle}
            title="工程图层"
          >
            <Layers size={19} />
            <span>图层</span>
          </button>
        )}
      </div>

      <div className="project-rail-secondary">
        <Link className="rail-action" href="/settings" title="Agent 设置">
          <Settings size={19} />
          <span>设置</span>
        </Link>
        {user && (
          <button
            className="rail-action"
            onClick={handleSignOut}
            title={`退出登录 ${user.email}`}
          >
            <LogOut size={19} />
            <span>退出</span>
          </button>
        )}
      </div>
    </nav>
  );
}
