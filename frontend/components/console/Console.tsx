"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MissionRail } from "./MissionRail";
import { Transcript } from "./Transcript";
import { Comparison } from "./Comparison";
import { ThemeToggle } from "./ThemeToggle";
import { Composer } from "./Composer";
import { DirectDial } from "./DirectDial";
import { VoicePicker } from "./VoicePicker";
import { SignIn } from "./SignIn";
import { Insights, Panel, Plus } from "./Icons";

/**
 * orydl console.
 *
 * Two ways in and one store behind them: describe a goal and it discovers real
 * businesses, or type a number you already have. Either way nothing dials
 * until you say so, and the compliance gate sits in front of both.
 *
 * Auth: `?t=` from a Telegram DM, else a token in localStorage, else the
 * Telegram-free sign-in. The bot is a peer front-end, never a prerequisite.
 */
export function Console() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [missionId, setMissionId] = useState<Id<"missions"> | null>(null);
  const [callId, setCallId] = useState<Id<"calls"> | null>(null);
  const [scrollToSeq, setScrollToSeq] = useState<number | null>(null);
  const [showRail, setShowRail] = useState(true);
  const [showSide, setShowSide] = useState(true);
  const [sidePane, setSidePane] = useState<"results" | "voice">("results");
  const [busy, setBusy] = useState(false);

  // Everything browser-only happens after mount: this page is statically
  // exported, so the first render also runs in Node during `next build`.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("t");
    if (fromUrl) {
      try {
        localStorage.setItem("orydl_token", fromUrl);
      } catch {
        /* private mode — the session still works for this tab */
      }
      window.history.replaceState({}, "", window.location.pathname);
      setToken(fromUrl);
    } else {
      try {
        setToken(localStorage.getItem("orydl_token"));
      } catch {
        setToken(null);
      }
    }
    setShowRail(window.innerWidth > 700);
    setShowSide(window.innerWidth > 900);
    setReady(true);
  }, []);

  const missions = useQuery(api.missions.list, token ? { token } : "skip");
  const full = useQuery(api.missions.get, token && missionId ? { token, missionId } : "skip");
  const detail = useQuery(
    api.missions.comparison,
    token && missionId ? { token, missionId } : "skip",
  );
  const roster = useQuery(
    api.webconsole.roster,
    token && missionId ? { token, missionId } : "skip",
  );
  const me = useQuery(api.users.me, token ? { token } : "skip");
  // One thread across Telegram and the console. BUILD-SPEC "single place".
  const history = useQuery(
    api.console.history,
    token ? { token, missionId: missionId ?? undefined } : "skip",
  );

  const command = useAction(api.webconsole.command);
  const startCalls = useMutation(api.webconsole.startCalls);
  const logChat = useMutation(api.console.log);

  // A token that no longer resolves (expired, or a wiped deployment) must not
  // trap the user on a spinner — drop it and show the door again.
  useEffect(() => {
    if (token && me === null) {
      try {
        localStorage.removeItem("orydl_token");
      } catch {
        /* nothing to clean up */
      }
      setToken(null);
    }
  }, [token, me]);

  // Follow the action: jump to whichever call is live.
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

  const messages = useMemo(
    () =>
      (history ?? []).map((m: any) => ({
        id: m._id,
        role: m.role === "assistant" ? ("agent" as const) : ("user" as const),
        text: m.surface === "telegram" ? `${m.text}` : m.text,
        surface: m.surface,
        at: m.createdAt,
      })),
    [history],
  );

  const send = useCallback(
    async (text: string) => {
      if (!token || busy) return;
      setBusy(true);
      try {
        await logChat({ token, role: "user", text, missionId: missionId ?? undefined });
        const res = await command({ token, text, missionId: missionId ?? undefined });
        await logChat({
          token,
          role: "assistant",
          text: res.reply,
          missionId: (res.missionId ?? missionId) as Id<"missions"> | undefined,
        });
        if (res.missionId && res.missionId !== missionId) {
          setMissionId(res.missionId as Id<"missions">);
          setCallId(null);
        }
      } catch (err: any) {
        await logChat({
          token,
          role: "assistant",
          text: `That failed: ${err?.message ?? String(err)}`,
          missionId: missionId ?? undefined,
        }).catch(() => {});
      } finally {
        setBusy(false);
      }
    },
    [token, busy, missionId, command, logChat],
  );

  const callPicked = useCallback(
    async (vendorIds: Id<"vendors">[]) => {
      if (!token || !missionId || busy) return;
      setBusy(true);
      try {
        const res = await startCalls({ token, missionId, vendorIds });
        await logChat({
          token,
          role: "assistant",
          missionId,
          text:
            res.queued > 0
              ? `Dialling ${res.queued} ${res.queued === 1 ? "number" : "numbers"}, one at a time.${
                  res.capped ? ` Capped at ${res.cap} businesses per request.` : ""
                }`
              : "Nothing was queued — those numbers are already called or gate-blocked.",
        });
      } catch (err: any) {
        await logChat({
          token,
          role: "assistant",
          missionId,
          text: `Couldn't start calls: ${err?.message ?? String(err)}`,
        }).catch(() => {});
      } finally {
        setBusy(false);
      }
    },
    [token, missionId, busy, startCalls, logChat],
  );

  if (!ready) return <div className="app-boot" />;

  if (!token) {
    return (
      <div className="app no-rail no-side">
        <main className="center">
          <div className="thread">
            <SignIn onToken={setToken} />
          </div>
        </main>
      </div>
    );
  }

  const cls = ["app", showRail ? "" : "no-rail", showSide ? "" : "no-side"]
    .filter(Boolean)
    .join(" ");

  const composerHint = missionId
    ? "Enter to send · Shift+Enter for a new line · nothing dials until you say so"
    : "Describe what you want, or use “Call a number directly” above.";

  const suggestions = missionId
    ? roster?.vendors?.some((v: any) => v.gatePassed && !v.queued)
      ? ["call the top 3", "status", "stop"]
      : ["status"]
    : [
        "Goa mein 14 tarikh se do raat AC hotel, 4000 se kam",
        "Restaurant in HSR Layout for 4 tonight under ₹2000",
      ];

  return (
    <div className={cls}>
      {/* ------------------------------ left rail ------------------------------ */}
      <aside className="rail">
        <div className="rail-head">
          <a className="brand" href="/" title="Back to orydl.com">
            ORYDL<span className="dev">.</span>
            <span className="deva">the calling envoy</span>
          </a>
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
          <div className="avatar">{(me?.displayName ?? "O").slice(0, 1).toUpperCase()}</div>
          <div className="who">
            <div className="nm">{me?.displayName ?? "orydl user"}</div>
            <div className="sub">
              {me?.totalSavedInr ? (
                <>
                  saved <b>₹{me.totalSavedInr.toLocaleString("en-IN")}</b> so far
                </>
              ) : (
                <>voice: {me?.preferredVoice ?? "simran"}</>
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
                : "describe a goal · or dial a number you already have"}
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

        {!missionId && (
          <DirectDial
            token={token}
            defaultLanguage={me?.preferredLang ?? "hi-IN"}
            onMission={(id) => {
              setMissionId(id);
              setCallId(null);
            }}
          />
        )}

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
          token={token}
          mission={full?.mission}
          roster={roster}
          rows={rows}
          callId={callId}
          scrollToSeq={scrollToSeq}
          messages={messages as any}
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
          <div className="vp-seg">
            <button
              className={`vp-segb${sidePane === "results" ? " on" : ""}`}
              onClick={() => setSidePane("results")}
            >
              Results
            </button>
            <button
              className={`vp-segb${sidePane === "voice" ? " on" : ""}`}
              onClick={() => setSidePane("voice")}
            >
              Voice
            </button>
          </div>
          <button
            className="icon-btn"
            onClick={() => setShowSide(false)}
            title="Hide panel"
            aria-label="Hide panel"
          >
            <Insights />
          </button>
        </div>
        <div className="side-body">
          {sidePane === "results" ? (
            <Comparison
              detail={detail}
              activeCallId={callId}
              onJump={(cid, seq) => {
                setCallId(cid);
                setScrollToSeq(seq ?? null);
              }}
            />
          ) : (
            <VoicePicker
              token={token}
              language={me?.preferredLang ?? "hi-IN"}
              voice={me?.preferredVoice ?? "simran"}
            />
          )}
        </div>
      </aside>
    </div>
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
