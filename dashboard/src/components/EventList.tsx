import { Activity, CheckCheck, CircleAlert, Clock3 } from "lucide-react";
import type { EventRecord } from "@srdt/contracts";
import { clockTime } from "@srdt/twin-core";

function detail(e: EventRecord): string {
  if (e.type === "STATE_CHANGED") {
    const reasons = (e.data.reasons as string[] | undefined)?.join(", ");
    return reasons ? `${e.message} (${reasons})` : e.message;
  }
  return e.message;
}

function eventLabel(type: string) {
  const text = type.toLowerCase().replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function EventList({ events }: { events: EventRecord[] }) {
  return (
    <section className="card activity-card" aria-label="Recent room activity">
      <div className="card-head">
        <div>
          <h2>Recent activity</h2>
          <p className="section-description">The latest from your room.</p>
        </div>
        <Activity size={19} className="muted" aria-hidden="true" />
      </div>
      {events.length === 0 ? (
        <div className="activity-empty">
          <CheckCheck size={25} aria-hidden="true" />
          <strong>All quiet for now</strong>
          <p>Room updates and alerts will appear here.</p>
        </div>
      ) : (
        <ul className="list events">
          {events.map((e) => (
            <li key={e.id} className="event-row">
              <span className={`event-icon sev-${e.severity}`}>
                {e.severity === "info" ? (
                  <Activity size={15} aria-hidden="true" />
                ) : (
                  <CircleAlert size={15} aria-hidden="true" />
                )}
              </span>
              <div className="event-content">
                <div className="event-title">
                  <strong title={e.type}>{eventLabel(e.type)}</strong>
                  <span
                    className={`event-severity level-${e.severity === "critical" ? "danger" : e.severity}`}
                  >
                    {e.severity}
                  </span>
                </div>
                <p>{detail(e)}</p>
                <span
                  className="event-time"
                  title={`Device time ${clockTime(e.measuredAt)}`}
                >
                  <Clock3 size={11} aria-hidden="true" />
                  {clockTime(e.createdAt)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
