"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Phone } from "./Icons";

/**
 * Type a number, say what to ask, press Call.
 *
 * The discovery path (goal → roster → pick) is the interesting one, but it
 * assumes we can FIND the business. When the user already has the number,
 * making them describe a category so we can rediscover it is theatre — and on
 * a thin category it just fails.
 *
 * This deliberately does NOT skip the compliance gate. `direct.createDirectMission`
 * runs `gate.check` server-side and returns its refusal reason, which is
 * rendered below in full rather than swallowed: showing the gate refuse is
 * worth more than a form that silently does nothing (BUILD-SPEC §15).
 */
export function DirectDial({
  token,
  defaultLanguage,
  onMission,
}: {
  token: string;
  defaultLanguage: string;
  onMission: (id: Id<"missions">) => void;
}) {
  const createDirect = useAction(api.direct.createDirectMission);

  const [phone, setPhone] = useState("");
  const [category, setCategory] = useState("");
  const [locality, setLocality] = useState("");
  const [objectives, setObjectives] = useState("");
  const [target, setTarget] = useState("");
  const [personas, setPersonas] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const personaList = personas
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);

  const canCall = phone.trim().length >= 10 && category.trim().length > 0 && !busy;

  async function call() {
    if (!canCall) return;
    setBusy(true);
    setRefusal(null);
    setOk(null);
    try {
      const res = await createDirect({
        token,
        phoneE164: phone.trim(),
        category: category.trim(),
        locality: locality.trim() || undefined,
        objectives: objectives.trim() || undefined,
        targetPriceInr: target.trim() ? Number(target.replace(/[^\d]/g, "")) : undefined,
        language: (defaultLanguage as any) || undefined,
        personas: personaList.length ? personaList : undefined,
      });

      if (!res.ok) {
        setRefusal(res.reason ?? "Blocked by the compliance gate");
        return;
      }
      setOk(`Dialling ${res.phoneE164} — ${res.missionType}.`);
      setPhone("");
      setObjectives("");
      setTarget("");
      if (res.missionId) onMission(res.missionId as Id<"missions">);
    } catch (e: any) {
      setRefusal(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="direct">
      <div className="direct-h">
        <span className="mono-label">Call a number directly</span>
        <span className="direct-sub">skips discovery · not the gate</span>
      </div>

      <div className="direct-grid">
        <label className="fld wide">
          <span className="fl">Phone number</span>
          <input
            className="ph-input"
            value={phone}
            placeholder="+91 75093 95093"
            inputMode="tel"
            onChange={(e) => setPhone(e.target.value)}
            aria-label="Phone number to call"
          />
        </label>

        <label className="fld">
          <span className="fl">What are they?</span>
          <input
            value={category}
            placeholder="hotel, plumber, fridge shop…"
            onChange={(e) => setCategory(e.target.value)}
          />
        </label>

        <label className="fld">
          <span className="fl">
            Area <i>optional</i>
          </span>
          <input
            value={locality}
            placeholder="Jaipur"
            onChange={(e) => setLocality(e.target.value)}
          />
        </label>

        <label className="fld wide">
          <span className="fl">
            What should orydl ask? <i>optional — it will work it out otherwise</i>
          </span>
          <textarea
            rows={2}
            value={objectives}
            placeholder="ask if an AC double room is free on the 14th for two nights, and the rate per night"
            onChange={(e) => setObjectives(e.target.value)}
          />
        </label>

        <label className="fld">
          <span className="fl">
            Target price <i>optional — turns it into a negotiation</i>
          </span>
          <input
            value={target}
            inputMode="numeric"
            placeholder="₹3000"
            onChange={(e) => setTarget(e.target.value)}
          />
        </label>

        <label className="fld wide">
          <span className="fl">
            Personas <i>optional — comma separated, max 5. Same number, called once per name.</i>
          </span>
          <input
            value={personas}
            placeholder="Leela Hotel, Lalit Hotel, Hayath Hotel"
            onChange={(e) => setPersonas(e.target.value)}
          />
          <span className="fl" style={{ color: "var(--text-3)" }}>
            {personaList.length > 1
              ? `${personaList.length} sequential calls — call 2 onward inherits what call 1 learned and cites its price by name.`
              : "Leave blank for a single call. Use this to exercise cross-call leverage on a consented test line."}
          </span>
        </label>

        <div className="fld direct-go">
          <button className="btn solid" disabled={!canCall} onClick={call}>
            {busy ? "…" : <><Phone /> Call{personaList.length > 1 ? ` ${personaList.length}×` : ""}</>}
          </button>
        </div>
      </div>

      {refusal && (
        <div className="gate-refusal">
          <b>Compliance gate refused this number.</b>
          <span>{refusal}</span>
        </div>
      )}
      {ok && <div className="gate-ok">{ok}</div>}
    </div>
  );
}
