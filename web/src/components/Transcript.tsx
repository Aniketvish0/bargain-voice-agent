import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

/**
 * The live transcript.
 *
 * Subscribes to TWO queries, per BUILD-SPEC §9 rule 2:
 *   - `turns`       COLD, re-runs only when a final lands
 *   - `livePartial` HOT, reads exactly one document, up to 4 Hz
 * and renders [...turns, partial]. Merging them into one query would make
 * every partial re-read the whole turn history.
 */
export function Transcript({
  token,
  rows,
  callId,
  onSelectCall,
  scrollToSeq,
}: {
  token: string;
  rows: any[];
  callId: Id<"calls"> | null;
  onSelectCall: (id: Id<"calls">) => void;
  scrollToSeq: number | null;
}) {
  const turns = useQuery(api.transcripts.turns, callId ? { token, callId } : "skip");
  const partial = useQuery(api.transcripts.livePartial, callId ? { callId } : "skip");
  const switches = useQuery(
    api.transcripts.langSwitchesForCall,
    callId ? { token, callId } : "skip",
  );

  const endRef = useRef<HTMLDivElement>(null);
  const seqRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns?.length, partial?.text]);

  // Clicking a price in the comparison panel scrolls to the line where it was
  // spoken. That link between a number and its evidence is what makes the
  // whole thing feel real rather than generated.
  useEffect(() => {
    if (scrollToSeq == null) return;
    const el = seqRefs.current[scrollToSeq];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.style.transition = "background 200ms";
      el.style.background = "rgba(77,163,255,.14)";
      setTimeout(() => { el.style.background = "transparent"; }, 1600);
    }
  }, [scrollToSeq, turns]);

  const active = rows.find((r) => r.callId === callId);
  const switchAt = new Map<number, any>();
  for (const s of switches ?? []) switchAt.set(s.atMs, s);

  return (
    <>
      {rows.length > 0 && (
        <div className="tabs">
          {rows.map((r) => (
            <button
              key={r.callId}
              className={`tab${r.callId === callId ? " active" : ""}`}
              onClick={() => onSelectCall(r.callId)}
            >
              <span className={`dot ${r.status}`} />
              {r.vendorName}
              {r.finalQuoteInr ? (
                <b className="num">₹{r.finalQuoteInr.toLocaleString("en-IN")}</b>
              ) : null}
            </button>
          ))}
        </div>
      )}

      <div className="transcript">
        {!callId && (
          <div className="empty">
            <div className="big">No call selected</div>
            <div>Pick a mission on the left, or send a request to @orydl_bot.</div>
          </div>
        )}

        {callId && turns?.length === 0 && !partial && (
          <div className="empty">
            <div className="big">
              {active?.status === "dialing" || active?.status === "ringing"
                ? "☎ Ringing…"
                : "Waiting for the call to connect"}
            </div>
            <div className="mono">{active?.phoneE164}</div>
          </div>
        )}

        {(turns ?? []).map((t: any) => (
          <div
            key={t._id}
            className={`turn ${t.role}`}
            ref={(el) => { seqRefs.current[t.seq] = el; }}
          >
            <div className="who">
              {t.role === "agent" ? "orydl" : t.role === "vendor" ? active?.vendorName ?? "them" : "system"}
              {t.langCode && t.role === "vendor" && (
                <span className="lang-badge">{t.langCode}</span>
              )}
            </div>
            <div className="body">{t.text}</div>
            {t.romanized && <div className="roman">{t.romanized}</div>}
            {t.textEn && t.textEn !== t.text && <div className="roman">{t.textEn}</div>}
          </div>
        ))}

        {partial?.text && (
          <div className={`turn ${partial.role}`}>
            <div className="who">
              {partial.role === "agent" ? "orydl" : active?.vendorName ?? "them"}
            </div>
            <div className="body">
              {partial.text}
              <span className="cursor" />
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>
    </>
  );
}
