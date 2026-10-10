"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  House,
  LayoutDashboard,
  Leaf,
  SlidersHorizontal,
  Wifi,
} from "lucide-react";

const links = [
  { href: "#overview", label: "Overview", icon: LayoutDashboard },
  { href: "#room", label: "Room twin", icon: House },
  { href: "#controls", label: "Controls", icon: SlidersHorizontal },
  { href: "#trends", label: "Trends", icon: Activity },
] as const;

export function Sidebar({
  deviceCode,
  online,
}: {
  deviceCode: string;
  online: boolean;
}) {
  const [active, setActive] = useState("#overview");
  useEffect(() => {
    const update = () => setActive(window.location.hash || "#overview");
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return (
    <aside className="sidebar">
      <a className="brand" href="#overview" aria-label="Smart Room overview">
        <span className="brand-mark">
          <House size={23} aria-hidden="true" />
        </span>
        <span>
          smartroom<span className="brand-caption">Your space, connected.</span>
        </span>
      </a>
      <p className="nav-label">YOUR WORKSPACE</p>
      <nav aria-label="Dashboard sections">
        {links.map(({ href, label, icon: Icon }) => (
          <a
            key={href}
            className={`nav-link${active === href ? " nav-link-active" : ""}`}
            aria-current={active === href ? "location" : undefined}
            href={href}
          >
            <Icon size={19} aria-hidden="true" />
            <span>{label}</span>
          </a>
        ))}
      </nav>
      <div className="sidebar-room">
        <span className="nav-label">CONNECTED ROOM</span>
        <div>
          <span className="room-icon">
            <House size={19} aria-hidden="true" />
          </span>
          <span>
            <strong>{deviceCode}</strong>
            <small>{online ? "Device online" : "Device offline"}</small>
          </span>
          <span className={`connection-dot${online ? " is-online" : ""}`} />
        </div>
      </div>
      <div className="sidebar-bottom">
        <div className="sidebar-note">
          <Leaf size={25} aria-hidden="true" />
          <strong>A little more comfort.</strong>
          <p>Keep an eye on your space. Let your room take care of the rest.</p>
          <a href="#controls">
            Manage your room <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        </div>
        <div className="sidebar-foot">
          <Wifi size={15} aria-hidden="true" /> Smart Room Digital Twin
        </div>
      </div>
    </aside>
  );
}
