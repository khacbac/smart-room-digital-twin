import type { EventRecord } from "@srdt/contracts";
import { clockTime } from "@/lib/format";

function detail(e: EventRecord): string {
  if (e.type === "STATE_CHANGED") {
    const reasons = (e.data.reasons as string[] | undefined)?.join(", ");
    return reasons ? `${e.message} (${reasons})` : e.message;
  }
  return e.message;
}

export function EventList({ events }: { events: EventRecord[] }) {
  return (
    <section className="card" aria-label="Recent events">
      <div className="card-head">
        <h2>Recent events</h2>
      </div>
      {events.length === 0 ? (
        <p className="muted small">No events yet.</p>
      ) : (
        <ul className="list events">
          {events.map((e) => (
            <li key={e.id} className="list-row">
              <span className={`sev sev-${e.severity}`} title={e.severity} />
              <span className="muted small mono" title={`device time ${clockTime(e.measuredAt)}`}>
                {clockTime(e.createdAt)}
              </span>
              <span className="mono small">{e.type}</span>
              <span className="small grow ellipsis" title={detail(e)}>
                {detail(e)}
              </span>
              {e.source === "server" && <span className="tag">server</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
