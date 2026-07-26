import { useMemo, useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { Search } from "./Icons";

const TYPE_LABEL: Record<string, string> = {
  availability: "availability",
  quote: "quote",
  negotiate: "negotiate",
};

/** ChatGPT-style recency buckets — the mental model people already have. */
function bucket(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  if (ts >= startOfToday) return "Today";
  if (ts >= startOfToday - 86_400_000) return "Yesterday";
  if (ts >= startOfToday - 7 * 86_400_000) return "Previous 7 days";
  if (ts >= startOfToday - 30 * 86_400_000) return "Previous 30 days";
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

export function MissionRail({
  missions,
  activeId,
  onSelect,
  token,
}: {
  missions: any[] | undefined;
  activeId: Id<"missions"> | null;
  onSelect: (id: Id<"missions">) => void;
  /** Needed only to tell "not signed in" apart from "still loading". */
  token?: string | null;
}) {
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    if (!missions) return [];
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? missions.filter((m) =>
          [m.rawRequest, m.category, m.locality]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(needle),
        )
      : missions;

    const out: Array<{ label: string; items: any[] }> = [];
    for (const m of filtered) {
      const label = bucket(m.createdAt);
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(m);
      else out.push({ label, items: [m] });
    }
    return out;
  }, [missions, q]);

  return (
    <>
      <div className="rail-search">
        <Search />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search missions"
          aria-label="Search missions"
        />
      </div>

      <div className="rail-list">
        {/*
          `useQuery(..., "skip")` also returns undefined, so a MISSING TOKEN
          looked exactly like a slow network and the rail said "Loading
          missions…" forever. Distinguish the two — a stuck spinner tells the
          user nothing about what to actually do.
        */}
        {missions === undefined && !token && (
          <div className="rail-empty">
            Not connected. Send <b>/start</b> to <b>@orydl_bot</b> and open the
            link it DMs you.
          </div>
        )}

        {missions === undefined && token && (
          <div className="rail-empty">Loading missions…</div>
        )}

        {missions?.length === 0 && (
          <div className="rail-empty">
            No missions yet. Send a goal to <b>@orydl_bot</b> — type it, or hold
            the mic and say it.
          </div>
        )}

        {missions && missions.length > 0 && groups.length === 0 && (
          <div className="rail-empty">Nothing matches “{q}”.</div>
        )}

        {groups.map((g) => (
          <div key={g.label}>
            <div className="rail-group">{g.label}</div>
            {g.items.map((m) => (
              <button
                key={m._id}
                className={`mission${m._id === activeId ? " active" : ""}`}
                onClick={() => onSelect(m._id)}
              >
                <div className="m-top">
                  <span className="m-title">
                    {m.rawRequest || m.category || "Untitled mission"}
                  </span>
                  {m.liveCount > 0 && <span className="dot talking" />}
                </div>
                <div className="m-meta">
                  <span>{m.category}</span>
                  {m.locality && (
                    <>
                      <span className="sep">·</span>
                      <span>{m.locality}</span>
                    </>
                  )}
                  <span className="sep">·</span>
                  <span>{TYPE_LABEL[m.missionType] ?? m.missionType}</span>
                  {m.savedInr ? (
                    <>
                      <span className="sep">·</span>
                      <span className="m-saved">
                        −₹{m.savedInr.toLocaleString("en-IN")}
                      </span>
                    </>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
