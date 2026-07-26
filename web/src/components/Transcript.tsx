import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Mic, Phone, Shield, Text } from "./Icons";

const LANG_NAME: Record<string, string> = {
  "hi-IN": "Hindi",
  "en-IN": "English",
  "bn-IN": "Bengali",
  "gu-IN": "Gujarati",
  "kn-IN": "Kannada",
  "ml-IN": "Malayalam",
  "mr-IN": "Marathi",
  "od-IN": "Odia",
  "pa-IN": "Punjabi",
  "ta-IN": "Tamil",
  "te-IN": "Telugu",
};

/**
 * The mission thread, read top to bottom like a chat:
 *   the ask → what the agent understood → the live call transcript.
 *
 * Subscribes to TWO queries for the transcript, per BUILD-SPEC §9 rule 2:
 *   - `turns`       COLD, re-runs only when a final lands
 *   - `livePartial` HOT, reads exactly one document, up to 4 Hz
 * Merging them into one query would make every partial re-read the whole
 * turn history.
 */
export function Transcript({
  token,
  mission,
  vendors,
  rows,
  callId,
  scrollToSeq,
}: {
  token: string;
  mission: any;
  vendors: any[];
  rows: any[];
  callId: Id<"calls"> | null;
  scrollToSeq: number | null;
}) {
  const turns = useQuery(
    api.transcripts.turns,
    callId ? { token, callId } : "skip",
  );
  const partial = useQuery(
    api.transcripts.livePartial,
    callId ? { callId } : "skip",
  );

  const endRef = useRef<HTMLDivElement>(null);
  const seqRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns?.length, partial?.text, callId]);

  // Clicking a price in the side panel scrolls to the line where it was
  // spoken. That link between a number and its evidence is what makes the
  // whole thing feel real rather than generated.
  useEffect(() => {
    if (scrollToSeq == null) return;
    const el = seqRefs.current[scrollToSeq];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("flash");
    void el.offsetWidth; // restart the animation
    el.classList.add("flash");
  }, [scrollToSeq, turns]);

  const active = rows.find((r) => r.callId === callId);
  const blocked = vendors.filter((v) => !v.gatePassed);
  const brief = mission?.brief;
  const connecting =
    active && ["queued", "dialing", "ringing"].includes(active.status);

  return (
    <div className="thread">
      <div className="thread-in">
        {mission && (
          <>
            <div className="daymark">
              {new Date(mission.createdAt).toLocaleString("en-IN", {
                day: "numeric",
                month: "short",
                hour: "numeric",
                minute: "2-digit",
              })}
            </div>

            <div className="ask">
              <div className="lb">
                {mission.inputMode === "voice" ? <Mic /> : <Text />}
                {mission.inputMode === "voice" ? "voice note" : "you"}
              </div>
              {mission.rawRequest}
            </div>

            {brief && (
              <div className="brief">
                <div className="lb">what orydl understood</div>
                <div className="tags">
                  <span className="tag">
                    <b>{brief.category}</b>
                  </span>
                  {brief.locality && <span className="tag">{brief.locality}</span>}
                  <span className="tag">
                    {LANG_NAME[brief.language] ?? brief.language}
                  </span>
                  {(brief.constraints ?? []).map((c: string) => (
                    <span className="tag" key={c}>
                      {c}
                    </span>
                  ))}
                  {brief.targetPriceInr ? (
                    <span className="tag">
                      target <b className="num">₹{brief.targetPriceInr.toLocaleString("en-IN")}</b>
                    </span>
                  ) : null}
                  {brief.walkAwayInr ? (
                    <span className="tag">
                      walk away <b className="num">₹{brief.walkAwayInr.toLocaleString("en-IN")}</b>
                    </span>
                  ) : null}
                </div>

                {brief.objectives?.length > 0 && (
                  <div className="objs">
                    {brief.objectives.map((o: any, i: number) => (
                      <div className="obj" key={o.key}>
                        <span className="n">{i + 1}</span>
                        <span>{o.ask}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {blocked.length > 0 && (
              <div className="turn system">
                <div className="body">
                  <Shield />
                  {"  "}
                  compliance gate blocked {blocked.length}{" "}
                  {blocked.length === 1 ? "number" : "numbers"} —{" "}
                  {[...new Set(blocked.map((b) => b.gateReason).filter(Boolean))].join(
                    "; ",
                  ) || "not dialable"}
                </div>
              </div>
            )}
          </>
        )}

        {!callId && mission && rows.length === 0 && (
          <div className="turn system">
            <div className="body">no calls placed yet</div>
          </div>
        )}

        {active && (
          <div className="daymark">
            <Phone /> {active.vendorName} · {active.phoneE164}
          </div>
        )}

        {callId && turns?.length === 0 && !partial && (
          <div className="turn vendor">
            <div className="who">{active?.vendorName ?? "them"}</div>
            <div className="body typing">
              {connecting ? (
                <>
                  <i />
                  <i />
                  <i />
                </>
              ) : (
                <span style={{ fontSize: 13, color: "var(--paper-dim)" }}>
                  {active?.status === "no_answer"
                    ? "Didn't pick up."
                    : active?.status === "failed"
                      ? "Call failed."
                      : "No transcript for this call."}
                </span>
              )}
            </div>
          </div>
        )}

        {(turns ?? []).map((t: any) => (
          <div
            key={t._id}
            className={`turn ${t.role}`}
            ref={(el) => {
              seqRefs.current[t.seq] = el;
            }}
          >
            <div className="who">
              {t.role === "agent"
                ? "orydl"
                : t.role === "vendor"
                  ? (active?.vendorName ?? "them")
                  : "system"}
              {t.langCode && t.role === "vendor" && (
                <span className="lang-badge">{t.langCode}</span>
              )}
            </div>
            <div className="body">{t.text}</div>
            {t.romanized && <div className="roman">{t.romanized}</div>}
            {t.textEn && t.textEn !== t.text && (
              <div className="roman">{t.textEn}</div>
            )}
          </div>
        ))}

        {partial?.text && (
          <div className={`turn ${partial.role}`}>
            <div className="who">
              {partial.role === "agent"
                ? "orydl"
                : (active?.vendorName ?? "them")}
            </div>
            <div className="body">
              {partial.text}
              <span className="cursor" />
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>
    </div>
  );
}
