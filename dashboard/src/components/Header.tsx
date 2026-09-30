import type { DevicePresence } from "@srdt/contracts";
import { ago } from "@/lib/format";

const PRESENCE_LABEL: Record<DevicePresence, string> = { online: "Online", offline: "Offline", unknown: "Unknown" };

export function Header(props: {
  deviceCode: string;
  deviceName: string;
  presence: DevicePresence;
  lastSeenAt: number | null;
  stale: boolean;
  source: string;
  now: number;
}) {
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" aria-hidden />
        <div>
          <h1>Smart Room Digital Twin</h1>
          <p className="muted">
            {props.deviceName} · <code>{props.deviceCode}</code>
          </p>
        </div>
      </div>

      <div className="header-status">
        <span className={`badge badge-${props.presence}`}>
          <span className="dot" aria-hidden />
          {PRESENCE_LABEL[props.presence]}
        </span>
        {props.stale && <span className="badge badge-stale">Stale data</span>}
        <span className="muted">last seen {ago(props.lastSeenAt, props.now)}</span>
        <span className="tag" title="NEXT_PUBLIC_DATA_SOURCE">
          source: {props.source}
        </span>
      </div>
    </header>
  );
}
