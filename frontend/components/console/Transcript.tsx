import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CallBoard } from "./CallBoard";
import { Mic, Phone, Text } from "./Icons";

/**
 * One line of the conversation. `surface` is what makes the Telegram bot and
 * the console visibly ONE thread rather than two apps over one database: a
 * mission you started by voice note on your phone shows up here, badged, in
 * order, next to what you typed in the browser.
 */
export type Msg = {
  id: string;
  role: "user" | "agent";
  text: string;
  surface?: "telegram" | "web";
  at: number;
};

function SurfaceBadge({ surface }: { surface?: string }) {
  if (surface !== "telegram") return null;
  return <span className="lang-badge">telegram</span>;
}

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
 * The mission thread, read top to bottom:
 *   goal → what orydl understood → the call board → the live call transcript.
 *
 * The call transcript subscribes to TWO queries, per BUILD-SPEC §9 rule 2:
 *   - `turns`       COLD, re-runs only when a final lands
 *   - `livePartial` HOT, reads exactly one document, up to 4 Hz
 * Merging them would make every partial re-read the whole turn history.
 */
export function Transcript({
  token,
  mission,
  roster,
  rows,
  callId,
  scrollToSeq,
  messages,
  busy,
  hasToken,
  loadingMissions,
  onCall,
  onSuggest,
}: {
  token: string;
  mission: any;
  roster: any;
  rows: any[];
  callId: Id<"calls"> | null;
  scrollToSeq: number | null;
  messages: Msg[];
  busy: boolean;
  hasToken: boolean;
  loadingMissions: boolean;
  onCall: (vendorIds: Id<"vendors">[]) => void;
  onSuggest: (text: string) => void;
}) {
  const turns = useQuery(api.transcripts.turns, callId ? { token, callId } : "skip");
  const partial = useQuery(api.transcripts.livePartial, callId ? { callId } : "skip");

  const endRef = useRef<HTMLDivElement>(null);
  const seqRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns?.length, partial?.text, callId, messages.length, roster?.vendors?.length]);

  // Clicking a price in the side panel scrolls to the line where it was spoken.
  // That link between a number and its evidence is what makes it feel real.
  useEffect(() => {
    if (scrollToSeq == null) return;
    const el = seqRefs.current[scrollToSeq];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("flash");
    void el.offsetWidth; // restart the animation
    el.classList.add("flash");
  }, [scrollToSeq, turns]);

  if (!mission) {
    return (
      <div className="thread">
        <Welcome
          hasToken={hasToken}
          loading={loadingMissions}
          messages={messages}
          busy={busy}
          onSuggest={onSuggest}
        />
        <div ref={endRef} />
      </div>
    );
  }

  const active = rows.find((r) => r.callId === callId);
  const brief = mission.brief;
  const connecting = active && ["queued", "dialing", "ringing"].includes(active.status);

  return (
    <div className="thread">
      <div className="thread-in">
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
              <span className="tag">{LANG_NAME[brief.language] ?? brief.language}</span>
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

        {mission.status === "discovering" && !roster?.vendors?.length && (
          <div className="turn vendor">
            <div className="who">orydl</div>
            <div className="body typing">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}

        <CallBoard roster={roster} rows={rows} busy={busy} onCall={onCall} />

        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "ask" : "turn vendor"}>
            {m.role === "user" ? (
              <>
                <div className="lb">
                  <Text />
                  you
                  <SurfaceBadge surface={m.surface} />
                </div>
                {m.text}
              </>
            ) : (
              <>
                <div className="who">
                  orydl
                  <SurfaceBadge surface={m.surface} />
                </div>
                <div className="body">{m.text}</div>
              </>
            )}
          </div>
        ))}

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
            {t.textEn && t.textEn !== t.text && <div className="roman">{t.textEn}</div>}
          </div>
        ))}

        {partial?.text && (
          <div className={`turn ${partial.role}`}>
            <div className="who">
              {partial.role === "agent" ? "orydl" : (active?.vendorName ?? "them")}
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

function Welcome({
  hasToken,
  loading,
  messages,
  busy,
  onSuggest,
}: {
  hasToken: boolean;
  loading: boolean;
  messages: Msg[];
  busy: boolean;
  onSuggest: (t: string) => void;
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
          and open the link it DMs you.
        </p>
        <div className="mono">https://…/?t=YOUR_TOKEN</div>
      </div>
    );
  }

  // Once the conversation starts, it becomes the thread — no more splash.
  if (messages.length > 0) {
    return (
      <div className="thread-in">
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "ask" : "turn vendor"}>
            {m.role === "user" ? (
              <>
                <div className="lb">
                  <Text />
                  you
                  <SurfaceBadge surface={m.surface} />
                </div>
                {m.text}
              </>
            ) : (
              <>
                <div className="who">
                  orydl
                  <SurfaceBadge surface={m.surface} />
                </div>
                <div className="body">{m.text}</div>
              </>
            )}
          </div>
        ))}
        {busy && (
          <div className="turn vendor">
            <div className="who">orydl</div>
            <div className="body typing">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="empty">
      <h2 className="hero-h">
        Give it a goal<span className="sig">.</span>
      </h2>
      <p>
        orydl finds real businesses with real phone numbers, shows you the list, and
        calls only the ones you pick — haggling each in their own language.
      </p>
      {!loading && (
        <div className="prompts">
          {SAMPLES.map((s) => (
            <button key={s.q} className="prompt-card" onClick={() => onSuggest(s.q)}>
              <div className="k">{s.k}</div>
              <div className="q">{s.q}</div>
              <div className="cov">{s.cov}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Seeded coverage, so a demo never lands on an empty category. */
const SAMPLES = [
  {
    k: "negotiate",
    q: "Goa mein 14 tarikh se do raat ke liye AC hotel chahiye, chaar hazaar se kam per night",
    cov: "27 hotels seeded · South Goa",
  },
  {
    k: "availability",
    q: "Restaurant in HSR Layout for 4 people tonight, under ₹2000",
    cov: "23 restaurants seeded · HSR Layout",
  },
  {
    k: "negotiate",
    q: "Jaipur mein hotel chahiye teen hazaar se kam",
    cov: "18 hotels seeded · Jaipur",
  },
  {
    k: "quote",
    q: "Karol Bagh mein hotel ka rate kya hai do raat ke liye",
    cov: "8 hotels seeded · Karol Bagh",
  },
];
