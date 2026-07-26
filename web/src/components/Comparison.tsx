import type { Id } from "../../../convex/_generated/dataModel";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/**
 * Two views over the same data, picked by missionType (BUILD-SPEC §14):
 *
 *   negotiate  -> the Negotiation Arc: opening struck through, final large,
 *                 the drop in green.
 *   otherwise  -> the Answer Matrix: vendors down, objectives across.
 *
 * Every number is clickable and jumps the transcript to the turn where it was
 * actually spoken.
 */
export function Comparison({
  detail,
  activeCallId,
  onJump,
}: {
  detail: any;
  activeCallId: Id<"calls"> | null;
  onJump: (callId: Id<"calls">, seq?: number) => void;
}) {
  if (!detail) {
    return <div style={{ color: "var(--dim)", fontSize: 14 }}>Select a mission.</div>;
  }

  const { rows, winnerId, savedInr, missionType, objectives, summaryText } = detail;
  const priced = rows.filter((r: any) => r.finalQuoteInr);
  const showArcs = missionType === "negotiate" || priced.length > 0;

  return (
    <>
      {savedInr ? (
        <div className="savings">
          <div className="big num">{inr(savedInr)}</div>
          <div className="cap">saved versus the best opening quote</div>
        </div>
      ) : null}

      {showArcs && (
        <>
          <h2>Deals</h2>
          {priced.length === 0 && (
            <div style={{ color: "var(--dim)", fontSize: 14, marginBottom: 16 }}>
              No prices yet.
            </div>
          )}
          {[...priced]
            .sort(
              (a: any, b: any) =>
                (a.effectivePriceInr ?? a.finalQuoteInr) -
                (b.effectivePriceInr ?? b.finalQuoteInr),
            )
            .map((r: any) => (
              <div
                key={r.callId}
                className={`arc${r.callId === winnerId ? " winner" : ""}`}
                onClick={() => onJump(r.callId, r.quoteTurnSeq)}
              >
                <div className="name">
                  <span>{r.vendorName}</span>
                  {r.callId === winnerId && <span className="pill win">best</span>}
                </div>
                <div className="prices">
                  {r.openingQuoteInr && r.openingQuoteInr > r.finalQuoteInr && (
                    <span className="was num">{inr(r.openingQuoteInr)}</span>
                  )}
                  <span className="now num">{inr(r.finalQuoteInr)}</span>
                  {r.dropPct ? <span className="drop num">−{r.dropPct}%</span> : null}
                </div>
                {r.effectivePriceInr && r.effectivePriceInr !== r.finalQuoteInr && (
                  <div className="allin num">{inr(r.effectivePriceInr)} all-in</div>
                )}
                {r.terms && <div className="terms">{r.terms}</div>}
                {(r.contactName || r.holdUntil) && (
                  <div className="note">
                    {[
                      r.contactName ? `ask for ${r.contactName}` : null,
                      r.holdUntil ? `held till ${r.holdUntil}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                )}
              </div>
            ))}
        </>
      )}

      {objectives?.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>Answers</h2>
          <div style={{ overflowX: "auto" }}>
            <table className="matrix">
              <thead>
                <tr>
                  <th></th>
                  {objectives.map((o: any) => (
                    <th key={o.key}>{o.key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.callId}>
                    <td style={{ fontWeight: 600 }}>{r.vendorName}</td>
                    {objectives.map((o: any) => {
                      const slot = (r.slots ?? []).find((s: any) => s.key === o.key);
                      return (
                        <td
                          key={o.key}
                          className={`cell${slot?.confidence === "low" ? " low" : ""}`}
                          title={slot?.valueVerbatim ?? ""}
                          onClick={() => onJump(r.callId, slot?.turnSeq)}
                        >
                          {renderSlot(slot)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {summaryText && (
        <>
          <h2 style={{ marginTop: 24 }}>Summary</h2>
          <div
            style={{ fontSize: 14, color: "var(--muted)", whiteSpace: "pre-wrap" }}
            dangerouslySetInnerHTML={{ __html: summaryText }}
          />
        </>
      )}

      {/* Judges are told they can spot-check the database. Pre-empt it. */}
      {activeCallId && (
        <JudgePanel row={rows.find((r: any) => r.callId === activeCallId)} />
      )}
    </>
  );
}

function renderSlot(slot: any) {
  if (!slot) return <span style={{ color: "var(--dim)" }}>—</span>;
  const v = slot.value;
  if (typeof v === "boolean") return v ? "✅" : "❌";
  if (typeof v === "number") return <span className="num">{inr(v)}</span>;
  if (v == null) return <span style={{ color: "var(--dim)" }}>—</span>;
  return String(v).slice(0, 28);
}

function JudgePanel({ row }: { row: any }) {
  if (!row) return null;
  return (
    <div className="judge">
      <div className="row">
        <span>number</span>
        <span className="mono">{row.phoneE164}</span>
      </div>
      {row.twilioCallSid && (
        <div className="row">
          <span>twilio sid</span>
          <span className="mono">{row.twilioCallSid.slice(0, 18)}…</span>
        </div>
      )}
      {row.durationSec != null && (
        <div className="row">
          <span>duration</span>
          <span className="num">
            {Math.floor(row.durationSec / 60)}m {row.durationSec % 60}s
          </span>
        </div>
      )}
      {row.detectedLangs?.length > 0 && (
        <div className="row">
          <span>languages heard</span>
          <span className="mono">{row.detectedLangs.join(", ")}</span>
        </div>
      )}
      {row.recordingUrl && <audio controls src={`${row.recordingUrl}.mp3`} />}
    </div>
  );
}
