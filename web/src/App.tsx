import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MissionRail } from "./components/MissionRail";
import { Transcript } from "./components/Transcript";
import { Comparison } from "./components/Comparison";
import { ThemeToggle } from "./components/ThemeToggle";
import { Insights, Panel, Phone } from "./components/Icons";

/**
 * orydl console.
 *
 * Auth is a token the Telegram bot DMs you (?t=...), stashed in localStorage —
 * BUILD-SPEC Contract 5, including the honest note about tokens appearing in
 * function args and logs. Locally, VITE_DEV_TOKEN skips that handshake so the
 * console opens straight up.
 */
export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [missionId, setMissionId] = useState<Id<"missions"> | null>(null);
  const [callId, setCallId] = useState<Id<"calls"> | null>(null);
  const [scrollToSeq, setScrollToSeq] = useState<number | null>(null);
  // Start collapsed on narrow windows so neither panel opens as an overlay
  // over the transcript on first paint.
  const [showRail, setShowRail] = useState(() => window.innerWidth > 700);
  const [showSide, setShowSide] = useState(() => window.innerWidth > 900);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fromUrl = new URLSearchParams(location.search).get("t");
    if (fromUrl) {
      localStorage.setItem("orydl_token", fromUrl);
      history.replaceState({}, "", location.pathname);
      setToken(fromUrl);
      return;
    }
    setToken(
      localStorage.getItem("orydl_token") ??
        import.meta.env.VITE_DEV_TOKEN ??
        null,
    );
  }, []);

  const missions = useQuery(api.missions.list, token ? { token } : "skip");
  const full = useQuery(
    api.missions.get,
    token && missionId ? { token, missionId } : "skip",
  );
  const detail = useQuery(
    api.missions.comparison,
    token && missionId ? { token, missionId } : "skip",
  );
  const me = useQuery(api.users.me, token ? { token } : "skip");

  const approve = useMutation(api.missions.approve);
  const cancel = useMutation(api.missions.cancel);

  // Auto-select the newest mission so a fresh Telegram request appears without
  // a click during the demo.
  useEffect(() => {
    if (!missionId && missions?.length) setMissionId(missions[0]._id);
  }, [missions, missionId]);

  // Follow the action: when a mission is selected, jump to whichever call is
  // live. On stage you never want to be hunting for the right tab.
  useEffect(() => {
    if (!detail?.rows?.length) return;
    const live = detail.rows.find((r: any) =>
      ["talking", "dialing", "ringing"].includes(r.status),
    );
    const target = live ?? detail.rows[0];
    setCallId((prev) => {
      if (prev && detail.rows.some((r: any) => r.callId === prev) && !live)
        return prev;
      return target.callId;
    });
  }, [detail]);

  const mission = missions?.find((m) => m._id === missionId);
  const rows = detail?.rows ?? [];
  const liveCount = rows.filter((r: any) =>
    ["talking", "dialing", "ringing"].includes(r.status),
  ).length;

  const cls = ["app", showRail ? "" : "no-rail", showSide ? "" : "no-side"]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div className="grain" />
      <div
        className="blob peri"
        style={{ width: 520, height: 520, top: -180, left: 180 }}
      />
      <div
        className="blob sig"
        style={{ width: 440, height: 440, bottom: -200, right: 120 }}
      />

      <div className={cls}>
        {/* ------------------------------ left rail ------------------------------ */}
        <aside className="rail">
          <div className="rail-head">
            <div className="brand">
              ORYDL<span className="dev">.</span>
              <span className="deva">the calling envoy</span>
            </div>
          </div>

          <MissionRail
            missions={missions}
            activeId={missionId}
            onSelect={(id) => {
              setMissionId(id);
              setCallId(null);
            }}
          />

          <div className="rail-foot">
            <div className="avatar">
              {(me?.displayName ?? "O").slice(0, 1).toUpperCase()}
            </div>
            <div className="who">
              <div className="nm">{me?.displayName ?? "orydl user"}</div>
              <div className="sub">
                {me?.totalSavedInr
                  ? <>saved <b>₹{me.totalSavedInr.toLocaleString("en-IN")}</b> so far</>
                  : "connected via Telegram"}
              </div>
            </div>
            <ThemeToggle />
          </div>
        </aside>

        {/* ------------------------------- center -------------------------------- */}
        <main className="center">
          <header className="topbar">
            <button
              className="icon-btn"
              onClick={() => setShowRail((v) => !v)}
              title="Toggle missions"
              aria-label="Toggle mission list"
            >
              <Panel />
            </button>

            <div className="t-title">
              <h1>
                {mission
                  ? mission.rawRequest || mission.category
                  : "orydl console"}
              </h1>
              <div className="t-sub">
                {mission
                  ? [
                      mission.category,
                      mission.locality,
                      `${mission.callCount} ${mission.callCount === 1 ? "call" : "calls"}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "live calls, in their language"}
              </div>
            </div>

            {mission && <StatusChip status={mission.status} live={liveCount} />}

            <div className="t-actions">
              <button
                className="icon-btn"
                onClick={() => setShowSide((v) => !v)}
                title="Toggle results"
                aria-label="Toggle results panel"
              >
                <Insights />
              </button>
            </div>
          </header>

          {rows.length > 0 && (
            <div className="calls">
              {rows.map((r: any) => (
                <button
                  key={r.callId}
                  className={`calltab${r.callId === callId ? " active" : ""}${
                    r.callId === detail?.winnerId ? " win" : ""
                  }`}
                  onClick={() => setCallId(r.callId)}
                >
                  <span className={`dot ${r.status}`} />
                  <span className="nm">{r.vendorName}</span>
                  {r.finalQuoteInr ? (
                    <span className="pr">
                      ₹{r.finalQuoteInr.toLocaleString("en-IN")}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}

          {missionId ? (
            <Transcript
              token={token!}
              mission={full?.mission}
              vendors={full?.vendors ?? []}
              rows={rows}
              callId={callId}
              scrollToSeq={scrollToSeq}
            />
          ) : (
            <Welcome loading={missions === undefined} hasToken={!!token} />
          )}

          <div className="composer">
            <div className="composer-in">
              <ActionBar
                mission={mission}
                liveCount={liveCount}
                busy={busy}
                onApprove={async () => {
                  if (!token || !missionId) return;
                  setBusy(true);
                  try {
                    await approve({ token, missionId });
                  } finally {
                    setBusy(false);
                  }
                }}
                onCancel={async () => {
                  if (!token || !missionId) return;
                  setBusy(true);
                  try {
                    await cancel({ token, missionId });
                  } finally {
                    setBusy(false);
                  }
                }}
              />
              <div className="composer-note">
                New goals start in Telegram —{" "}
                <a href="https://t.me/orydl_bot" target="_blank" rel="noreferrer">
                  @orydl_bot
                </a>
                . Type it or hold the mic.
              </div>
            </div>
          </div>
        </main>

        {/* ----------------------------- right panel ----------------------------- */}
        <aside className="side">
          <div className="side-head">
            <span className="mono-label">Results</span>
            <button
              className="icon-btn"
              onClick={() => setShowSide(false)}
              title="Hide results"
              aria-label="Hide results panel"
            >
              <Insights />
            </button>
          </div>
          <div className="side-body">
            <Comparison
              detail={detail}
              activeCallId={callId}
              onJump={(cid, seq) => {
                setCallId(cid);
                setScrollToSeq(seq ?? null);
              }}
            />
          </div>
        </aside>
      </div>
    </>
  );
}

function StatusChip({ status, live }: { status: string; live: number }) {
  if (live > 0) {
    return (
      <span className="chip live">
        <span className="pulse" />
        {live} live
      </span>
    );
  }
  const map: Record<string, [string, string]> = {
    awaiting_approval: ["amber", "needs approval"],
    pending: ["", "pending"],
    discovering: ["peri", "finding shops"],
    calling: ["live", "calling"],
    done: ["ok", "done"],
    failed: ["", "failed"],
    cancelled: ["", "cancelled"],
  };
  const [tone, label] = map[status] ?? ["", status];
  return <span className={`chip ${tone}`}>{label}</span>;
}

/**
 * The bottom bar is where a chat app puts its composer. New goals arrive from
 * Telegram, so this slot carries the one decision the dashboard genuinely
 * owns: Checkpoint A — nothing dials until you tap.
 */
function ActionBar({
  mission,
  liveCount,
  busy,
  onApprove,
  onCancel,
}: {
  mission: any;
  liveCount: number;
  busy: boolean;
  onApprove: () => void;
  onCancel: () => void;
}) {
  if (!mission) {
    return (
      <div className="actionbar">
        <div className="txt">
          <div className="hd">Nothing selected</div>
          <div className="sb">
            Pick a mission on the left to watch its calls unfold.
          </div>
        </div>
      </div>
    );
  }

  if (mission.status === "awaiting_approval") {
    return (
      <div className="actionbar pending">
        <div className="txt">
          <div className="hd">Checkpoint A — nothing has dialled yet</div>
          <div className="sb">
            Approve and orydl calls the shortlist one at a time, carrying each
            quote into the next call.
          </div>
        </div>
        <div className="btns">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            Discard
          </button>
          <button className="btn solid" onClick={onApprove} disabled={busy}>
            {busy ? "…" : "Approve & call"}
          </button>
        </div>
      </div>
    );
  }

  if (liveCount > 0 || mission.status === "calling") {
    return (
      <div className="actionbar">
        <div className="txt">
          <div className="hd">
            {liveCount > 0
              ? `${liveCount} ${liveCount === 1 ? "call" : "calls"} in flight`
              : "Working the shortlist"}
          </div>
          <div className="sb">
            Every quote gets carried into the next call as leverage.
          </div>
        </div>
        <div className="btns">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            Stop
          </button>
        </div>
      </div>
    );
  }

  if (mission.status === "discovering") {
    return (
      <div className="actionbar">
        <div className="txt">
          <div className="hd">Finding shops in {mission.locality || "the area"}</div>
          <div className="sb">
            Each number runs the compliance gate before it can be dialled.
          </div>
        </div>
        <div className="btns">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            Stop
          </button>
        </div>
      </div>
    );
  }

  const done: Record<string, string> = {
    done: "Mission complete",
    failed: "Mission failed",
    cancelled: "Mission cancelled",
    pending: "Queued",
  };
  return (
    <div className="actionbar">
      <div className="txt">
        <div className="hd">{done[mission.status] ?? mission.status}</div>
        <div className="sb">
          {mission.savedInr
            ? `Saved ₹${mission.savedInr.toLocaleString("en-IN")} against the best opening quote.`
            : `${mission.callCount} ${mission.callCount === 1 ? "call" : "calls"} placed. Transcripts and evidence stay here.`}
        </div>
      </div>
    </div>
  );
}

function Welcome({
  loading,
  hasToken,
}: {
  loading: boolean;
  hasToken: boolean;
}) {
  if (!hasToken) {
    return (
      <div className="empty">
        <div className="glyph">
          <Phone />
        </div>
        <h2>Connect your console</h2>
        <p>
          Send <b>/start</b> to{" "}
          <a href="https://t.me/orydl_bot" style={{ color: "var(--peri)" }}>
            @orydl_bot
          </a>{" "}
          and open the link it DMs you. That link carries the session this
          dashboard reads.
        </p>
        <div className="mono">https://…/?t=YOUR_TOKEN</div>
      </div>
    );
  }

  return (
    <div className="empty">
      <div className="glyph">
        <Phone />
      </div>
      <h2>{loading ? "Loading your missions…" : "Give it a goal"}</h2>
      <p>
        You give orydl one goal. It calls the shops, haggles each one down in
        their own language, and brings back the best deal — while you do
        something else.
      </p>
      {!loading && (
        <div className="prompts">
          <div className="prompt-card">
            <div className="k">negotiate</div>
            <div className="q">
              “Goa mein 14 tarikh se do raat ke liye AC hotel chahiye, chaar
              hazaar se kam per night”
            </div>
          </div>
          <div className="prompt-card">
            <div className="k">quote</div>
            <div className="q">
              “Find me the cheapest 1.5 ton split AC installation in Indiranagar”
            </div>
          </div>
          <div className="prompt-card">
            <div className="k">availability</div>
            <div className="q">
              “Which clinics near Koramangala can do a blood test tomorrow
              morning?”
            </div>
          </div>
          <div className="prompt-card">
            <div className="k">negotiate</div>
            <div className="q">
              “Jaipur mein hotel chahiye teen hazaar se kam”
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
