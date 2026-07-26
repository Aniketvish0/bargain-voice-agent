import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MissionRail } from "./components/MissionRail";
import { Transcript } from "./components/Transcript";
import { Comparison } from "./components/Comparison";

/**
 * orydl dashboard.
 *
 * Auth is a token in the URL (?t=...) that the Telegram bot DMs you, stashed
 * in localStorage. Deliberately minimal — see BUILD-SPEC Contract 5, including
 * the honest note about tokens appearing in function args and logs.
 */
export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [missionId, setMissionId] = useState<Id<"missions"> | null>(null);
  const [callId, setCallId] = useState<Id<"calls"> | null>(null);
  const [scrollToSeq, setScrollToSeq] = useState<number | null>(null);

  useEffect(() => {
    const fromUrl = new URLSearchParams(location.search).get("t");
    if (fromUrl) {
      localStorage.setItem("orydl_token", fromUrl);
      history.replaceState({}, "", location.pathname);
      setToken(fromUrl);
      return;
    }
    setToken(localStorage.getItem("orydl_token"));
  }, []);

  const missions = useQuery(api.missions.list, token ? { token } : "skip");
  const detail = useQuery(
    api.missions.comparison,
    token && missionId ? { token, missionId } : "skip",
  );

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

  // Auto-select the newest mission so a fresh Telegram request appears without
  // a click during the demo.
  useEffect(() => {
    if (!missionId && missions?.length) setMissionId(missions[0]._id);
  }, [missions, missionId]);

  if (token === null) {
    return (
      <div className="gate">
        <h1>orydl</h1>
        <p>
          Open the link the bot DM'd you, or send <b>/start</b> to{" "}
          <a href="https://t.me/orydl_bot" style={{ color: "var(--agent)" }}>
            @orydl_bot
          </a>{" "}
          to get one.
        </p>
        <code>https://…/?t=YOUR_TOKEN</code>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="rail">
        <div className="brand">
          <h1>orydl</h1>
          <span>दूत</span>
        </div>
        <MissionRail
          missions={missions}
          activeId={missionId}
          onSelect={(id) => {
            setMissionId(id);
            setCallId(null);
          }}
        />
      </div>

      <div className="center">
        <Transcript
          token={token}
          rows={detail?.rows ?? []}
          callId={callId}
          onSelectCall={setCallId}
          scrollToSeq={scrollToSeq}
        />
      </div>

      <div className="side">
        <Comparison detail={detail} activeCallId={callId} onJump={(cid, seq) => {
          setCallId(cid);
          setScrollToSeq(seq ?? null);
        }} />
      </div>
    </div>
  );
}
