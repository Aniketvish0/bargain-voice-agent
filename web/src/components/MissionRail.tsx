import type { Id } from "../../../convex/_generated/dataModel";

const TYPE_LABEL: Record<string, string> = {
  availability: "availability",
  quote: "quote",
  negotiate: "negotiate",
};

export function MissionRail({
  missions,
  activeId,
  onSelect,
}: {
  missions: any[] | undefined;
  activeId: Id<"missions"> | null;
  onSelect: (id: Id<"missions">) => void;
}) {
  if (missions === undefined) {
    return <div style={{ padding: 20, color: "var(--dim)" }}>Loading…</div>;
  }
  if (missions.length === 0) {
    return (
      <div style={{ padding: 20, color: "var(--dim)", fontSize: 14 }}>
        No missions yet. Send a request to <b>@orydl_bot</b> — text or a voice note.
      </div>
    );
  }

  return (
    <>
      {missions.map((m) => (
        <div
          key={m._id}
          className={`mission${m._id === activeId ? " active" : ""}`}
          onClick={() => onSelect(m._id)}
        >
          <h3>{m.category}</h3>
          <div className="meta">
            <span>{m.locality || "—"}</span>
            {m.liveCount > 0 ? (
              <span className="pill live">● live</span>
            ) : (
              <span className="pill">{TYPE_LABEL[m.missionType] ?? m.missionType}</span>
            )}
            {m.savedInr ? (
              <span className="saved num">saved ₹{m.savedInr.toLocaleString("en-IN")}</span>
            ) : null}
          </div>
        </div>
      ))}
    </>
  );
}
