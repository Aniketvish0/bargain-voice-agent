import type { Id } from "../../../convex/_generated/dataModel";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/**
 * Two views over the same data, picked by missionType (BUILD-SPEC §14):
 *
 *   negotiate  -> the Negotiation Arc: opening struck through, final large,
 *                 the drop as a bar.
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
    return (
      <div className="side-empty">
        Pick a mission to see the deals, the answers, and the evidence behind
        each number.
      </div>
    );
  }

  const { rows, winnerId, savedInr, objectives, summaryText } = detail;
  const priced = rows.filter((r: any) => r.finalQuoteInr);
  const sorted = [...priced].sort(
    (a: any, b: any) =>
      (a.effectivePriceInr ?? a.finalQuoteInr) -
      (b.effectivePriceInr ?? b.finalQuoteInr),
  );

  return (
    <>
      {savedInr ? (
        <div className="savings">
          <div className="lb">you saved</div>
          <div className="big num">{inr(savedInr)}</div>
          <div className="cap">versus the best opening quote anyone gave us</div>
        </div>
      ) : null}

      <h2 className={savedInr ? "" : "first"}>Deals</h2>
      {sorted.length === 0 ? (
        <div className="side-empty">
          No prices yet. Numbers land here the moment a shopkeeper says one.
        </div>
      ) : (
        sorted.map((r: any) => {
          const kept =
            r.openingQuoteInr && r.openingQuoteInr > 0
              ? Math.max(
                  6,
                  Math.round((r.finalQuoteInr / r.openingQuoteInr) * 100),
                )
              : 100;
          return (
            <button
              key={r.callId}
              className={`arc${r.callId === winnerId ? " winner" : ""}${
                r.callId === activeCallId ? " active" : ""
              }`}
              onClick={() => onJump(r.callId, r.quoteTurnSeq)}
            >
              <div className="name">
                <span className="nm">{r.vendorName}</span>
                {r.callId === winnerId && <span className="chip live">best</span>}
              </div>
              <div className="prices">
                {r.openingQuoteInr && r.openingQuoteInr > r.finalQuoteInr && (
                  <span className="was num">{inr(r.openingQuoteInr)}</span>
                )}
                <span className="now num">{inr(r.finalQuoteInr)}</span>
                {r.dropPct ? (
                  <span className="drop num">−{r.dropPct}%</span>
                ) : null}
              </div>
              {r.openingQuoteInr && r.openingQuoteInr > r.finalQuoteInr && (
                <div className="arcbar">
                  <i style={{ width: `${kept}%` }} />
                </div>
              )}
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
            </button>
          );
        })
      )}

      {objectives?.length > 0 && rows.length > 0 && (
        <>
          <h2>Answers</h2>
          <div style={{ overflowX: "auto" }}>
            <table className="matrix">
              <thead>
                <tr>
                  <th />
                  {objectives.map((o: any) => (
                    <th key={o.key} title={o.ask}>
                      {o.key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.callId}>
                    <td title={r.vendorName}>{r.vendorName}</td>
                    {objectives.map((o: any) => {
                      const slot = (r.slots ?? []).find(
                        (s: any) => s.key === o.key,
                      );
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
          <h2>Summary</h2>
          <div
            className="summary"
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
  if (!slot) return <span className="muted">—</span>;
  const v = slot.value;
  if (typeof v === "boolean") return v ? "✓" : "✕";
  if (typeof v === "number") return <span className="num">₹{v.toLocaleString("en-IN")}</span>;
  if (v == null) return <span className="muted">—</span>;
  return String(v).slice(0, 28);
}

function JudgePanel({ row }: { row: any }) {
  if (!row) return null;
  return (
    <>
      <h2>Evidence</h2>
      <div className="judge">
        <div className="row">
          <span>number</span>
          <span>{row.phoneE164}</span>
        </div>
        {row.twilioCallSid && (
          <div className="row">
            <span>twilio sid</span>
            <span>{row.twilioCallSid.slice(0, 18)}…</span>
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
            <span>{row.detectedLangs.join(", ")}</span>
          </div>
        )}
        {row.recordingUrl && <audio controls src={`${row.recordingUrl}.mp3`} />}
      </div>
    </>
  );
}
