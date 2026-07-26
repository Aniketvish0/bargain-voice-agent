import { useEffect, useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";

/**
 * The roster, rendered as the parallel call board from the landing page:
 * numbered rows, business, provenance, status pill. Gate-blocked numbers stay
 * on screen struck through — a judge should be able to SEE the gate refusing
 * to dial something (BUILD-SPEC §15).
 *
 * Nothing here dials on its own. You pick, then you press the button.
 */
export function CallBoard({
  roster,
  rows,
  busy,
  onCall,
}: {
  roster: any;
  rows: any[];
  busy: boolean;
  onCall: (vendorIds: Id<"vendors">[]) => void;
}) {
  const vendors: any[] = roster?.vendors ?? [];
  const callable = vendors.filter((v) => v.gatePassed && !v.queued);
  const cap: number = roster?.maxDials ?? 3;

  const [picked, setPicked] = useState<Set<string>>(new Set());

  // Preselect the top N dialable, which is what "call the top 3" would do.
  useEffect(() => {
    setPicked(new Set(callable.slice(0, cap).map((v) => v._id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendors.length, cap]);

  if (!vendors.length) return null;

  // `missions.comparison` rows carry phoneE164, not vendorId — join on that.
  const byPhone = new Map(rows.map((r: any) => [r.phoneE164, r]));
  const atCap = picked.size >= cap;

  function toggle(id: string, disabled: boolean) {
    if (disabled) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < cap) next.add(id);
      return next;
    });
  }

  return (
    <div className="board">
      <div className="board-h">
        <span className="mono-label">Parallel call board</span>
        <span className="board-count">
          {vendors.length} found · <b>{callable.length}</b> dialable
        </span>
      </div>

      <div className="board-rows">
        {vendors.map((v, i) => {
          const call = byPhone.get(v.phoneE164);
          const blocked = !v.gatePassed;
          const isPicked = picked.has(v._id);
          const disabled = blocked || v.queued || (!isPicked && atCap);

          return (
            <div
              key={v._id}
              className={`brow${blocked ? " blocked" : ""}${isPicked ? " picked" : ""}`}
              onClick={() => toggle(v._id, blocked || v.queued)}
            >
              <span className="ix num">{String(i + 1).padStart(2, "0")}</span>

              <span className="pick">
                {blocked || v.queued ? (
                  <span className="pick-x">{blocked ? "✕" : "✓"}</span>
                ) : (
                  <input
                    type="checkbox"
                    checked={isPicked}
                    disabled={disabled && !isPicked}
                    onChange={() => toggle(v._id, false)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${v.name}`}
                  />
                )}
              </span>

              <span className="who">
                <span className="nm">{v.name}</span>
                <span className="sub">
                  <code>{v.phoneE164}</code>
                  <span className="sep">·</span>
                  {v.source}
                  {v.address ? (
                    <>
                      <span className="sep">·</span>
                      {v.address.slice(0, 42)}
                    </>
                  ) : null}
                </span>
              </span>

              <StatusPill vendor={v} call={call} />
            </div>
          );
        })}
      </div>

      {callable.length > 0 && (
        <div className="board-f">
          <span className="lev">
            Calls run <b>one at a time</b> — each carries the last real quote in as leverage.
          </span>
          <div className="board-actions">
            <span className="cap">
              {picked.size}/{cap} picked
            </span>
            <button
              className="btn solid"
              disabled={busy || picked.size === 0}
              onClick={() => onCall([...picked] as Id<"vendors">[])}
            >
              {busy ? "…" : `Call ${picked.size}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ vendor, call }: { vendor: any; call: any }) {
  if (!vendor.gatePassed) {
    return (
      <span className="pill passed" title={vendor.gateReason}>
        {shortReason(vendor.gateReason)}
      </span>
    );
  }
  if (!call) return <span className="pill idle">not called</span>;

  const map: Record<string, [string, string]> = {
    queued: ["ckb", "queued"],
    dialing: ["anchor", "dialing"],
    ringing: ["anchor", "ringing"],
    talking: ["neg", "on call"],
    closed: ["won", "closed"],
    no_answer: ["passed", "no answer"],
    failed: ["passed", "failed"],
  };
  const [tone, label] = map[call.status] ?? ["idle", call.status];
  return (
    <span className={`pill ${tone}`}>
      {call.finalQuoteInr ? `₹${call.finalQuoteInr.toLocaleString("en-IN")}` : label}
    </span>
  );
}

function shortReason(reason?: string): string {
  if (!reason) return "blocked";
  const r = reason.toLowerCase();
  if (r.includes("do-not-call") || r.includes("dnc")) return "on DNC";
  if (r.includes("24h") || r.includes("already")) return "called today";
  if (r.includes("window") || r.includes("hour")) return "outside window";
  if (r.includes("cap") || r.includes("daily")) return "daily cap";
  return reason.slice(0, 22);
}
