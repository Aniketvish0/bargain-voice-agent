import { useCallback, useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MissionRail } from "./components/MissionRail";
import { Transcript } from "./components/Transcript";
import { Comparison } from "./components/Comparison";
import { ThemeToggle } from "./components/ThemeToggle";
import { Composer } from "./components/Composer";
import { Insights, Panel, Plus } from "./components/Icons";
import { useThread } from "./lib/thread";

/**
 * orydl console.
 *
 * One control line drives everything: describe a goal and it discovers real
 * businesses; then tell it who to call. Nothing dials without that second
 * instruction — Checkpoint A, BUILD-SPEC §15.
 *
 * Auth is a token the Telegram bot DMs you (?t=...), stashed in localStorage.
 * Locally, VITE_DEV_TOKEN skips that handshake.
 */
export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [missionId, setMissionId] = useState<Id<"missions"> | null>(null);
  const [callId, setCallId] = useState<Id<"calls"> | null>(null);
  const [scrollToSeq, setScrollToSeq] = useState<number | null>(null);
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
      localStorage.getItem("orydl_token") ?? import.meta.env.VITE_DEV_TOKEN ?? null,
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
  const roster = useQuery(
    api.webconsole.roster,
    token && missionId ? { token, missionId } : "skip",
  );
  const me = useQuery(api.users.me, token ? { token } : "skip");

  const command = useAction(api.webconsole.command);
  const startCalls = useMutation(api.webconsole.startCalls);

  const { messages, push, adopt } = useThread(missionId);

  // Follow the action: when a mission is selected, jump to whichever call is
  // live. On stage you never want to be hunting for the right tab.
  useEffect(() => {
    if (!detail?.rows?.length) return;
    const live = detail.rows.find((r: any) =>
      ["talking", "dialing", "ringing"].includes(r.status),
    );
    const target = live ?? detail.rows[0];
    setCallId((prev) => {
      if (prev && detail.rows.some((r: any) => r.callId === prev) && !live) return prev;
      return target.callId;
    });
  }, [detail]);

  const mission = missions?.find((m) => m._id === missionId);
  const rows = detail?.rows ?? [];
  const liveCount = rows.filter((r: any) =>
    ["talking", "dialing", "ringing"].includes(r.status),
  ).length;

  const send = useCallback(
    async (text: string) => {
      if (!token || busy) return;
      push("user", text);
      setBusy(true);
      try {
        const res = await command({
          token,
          text,
          missionId: missionId ?? undefined,
        });
        push("agent", res.reply);
        if (res.missionId && res.missionId !== missionId) {
          adopt(res.missionId);
          setMissionId(res.missionId as Id<"missions">);
          setCallId(null);
        }
      } catch (err: any) {
        push("agent", `That failed: ${err?.message ?? String(err)}`);
      } finally {
        setBusy(false);
      }
    },
    [token, busy, missionId, command, push, adopt],
  );

  const callPicked = useCallback(
    async (vendorIds: Id<"vendors">[]) => {
      if (!token || !missionId || busy) return;
      setBusy(true);
      try {
        const res = await startCalls({ token, missionId, vendorIds });
        push(
          "agent",
          res.queued > 0
            ? `Dialling ${res.queued} ${res.queued === 1 ? "number" : "numbers"}, one at a time.${
                res.capped ? ` Capped at ${res.cap} businesses per request.` : ""
              }`
            : "Nothing was queued — those numbers are already called or gate-blocked.",
        );
      } catch (err: any) {
        push("agent", `Couldn't start calls: ${err?.message ?? String(err)}`);
      } finally {
        setBusy(false);
      }
    },
    [token, missionId, busy, startCalls, push],
  );

  const cls = ["app", showRail ? "" : "no-rail", showSide ? "" : "no-side"]
    .filter(Boolean)
    .join(" ");

  const composerHint = missionId
    ? "Enter to send · Shift+Enter for a new line · nothing dials until you say so"
    : "Describe what you want. orydl finds the businesses first — you choose who it calls.";

  const suggestions = missionId
    ? roster?.vendors?.some((v: any) => v.gatePassed && !v.queued)
      ? ["call the top 3", "status", "stop"]
      : ["status"]
    : [
        "Goa mein 14 tarikh se do raat AC hotel, 4000 se kam",
        "Restaurant in HSR Layout for 4 tonight under ₹2000",
      ];

  return (
    <>
      <div className={cls}>
        {/* ------------------------------ left rail ------------------------------ */}
        <aside className="rail">
          <div className="rail-head">
            <div className="brand">
              ORYDL<span className="dev">.</span>
              <span className="deva">the calling envoy</span>
            </div>
          </div>

          <button
            className="newmission"
            onClick={() => {
              setMissionId(null);
              setCallId(null);
            }}
          >
            <Plus /> New mission
          </button>

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
                {me?.totalSavedInr ? (
                  <>
                    saved <b>₹{me.totalSavedInr.toLocaleString("en-IN")}</b> so far
                  </>
                ) : (
                  "connected via Telegram"
                )}
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
              <h1>{mission ? mission.rawRequest || mission.category : "New mission"}</h1>
              <div className="t-sub">
                {mission
                  ? [
                      mission.category,
                      mission.locality,
                      `${mission.callCount} ${mission.callCount === 1 ? "call" : "calls"}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "describe a goal · orydl finds the numbers"}
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
                    <span className="pr">₹{r.finalQuoteInr.toLocaleString("en-IN")}</span>
                  ) : null}
                </button>
              ))}
            </div>
          )}

          <Transcript
            token={token!}
            mission={full?.mission}
            roster={roster}
            rows={rows}
            callId={callId}
            scrollToSeq={scrollToSeq}
            messages={messages}
            busy={busy}
            hasToken={!!token}
            loadingMissions={missions === undefined}
            onCall={callPicked}
            onSuggest={send}
          />

          <Composer
            placeholder={
              missionId
                ? "Tell orydl what to do — “call the top 3”, “call Empire”, “stop”…"
                : "What do you need? e.g. “AC hotel in South Goa for two nights under ₹4,000”"
            }
            hint={composerHint}
            busy={busy}
            suggestions={suggestions}
            onSubmit={send}
          />
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
    awaiting_approval: ["amber", "pick who to call"],
    pending: ["", "pending"],
    discovering: ["peri", "finding numbers"],
    calling: ["live", "calling"],
    done: ["ok", "done"],
    failed: ["", "failed"],
    cancelled: ["", "stopped"],
  };
  const [tone, label] = map[status] ?? ["", status];
  return <span className={`chip ${tone}`}>{label}</span>;
}
