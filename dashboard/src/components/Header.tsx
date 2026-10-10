import { ChevronRight, House, Radio } from "lucide-react";
import type { DevicePresence } from "@srdt/contracts";
import { ago } from "@/lib/format";

const PRESENCE_LABEL: Record<DevicePresence, string> = {
  online: "Online",
  offline: "Offline",
  unknown: "Unknown",
};

export function Header(props: {
  deviceName: string;
  presence: DevicePresence;
  lastSeenAt: number | null;
  stale: boolean;
  now: number;
}) {
  return (
    <header className="header" id="overview">
      <div>
        <div className="breadcrumb">
          <House size={14} aria-hidden="true" /> My space{" "}
          <ChevronRight size={13} aria-hidden="true" />
          <span>Overview</span>
        </div>
        <h1>
          Your room, at a glance<span className="heading-dot">.</span>
        </h1>
        <p className="muted">A little insight. A more comfortable space.</p>
      </div>
      <div className="header-status">
        <div className="device-label">
          <Radio size={18} aria-hidden="true" />
          <strong>{props.deviceName}</strong>
        </div>
        <div className="header-presence">
          <span className={`badge badge-${props.presence}`}>
            <span className="dot" aria-hidden="true" />
            {PRESENCE_LABEL[props.presence]}
          </span>
          {props.stale && <span className="badge badge-stale">Stale data</span>}
        </div>
        <span className="small muted">
          Last seen {ago(props.lastSeenAt, props.now)}
        </span>
      </div>
    </header>
  );
}
