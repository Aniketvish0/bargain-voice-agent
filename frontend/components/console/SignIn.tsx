"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Phone } from "./Icons";

/**
 * Getting into the console WITHOUT Telegram.
 *
 * The old flow was: message @orydl_bot, wait for a DM, open the `?t=` link.
 * That made the bot a hard dependency of the dashboard, which is backwards —
 * they are peer front-ends over one store. The `?t=` path still works and is
 * still the way to arrive from a Telegram DM; this is the other door.
 *
 * Entering a Telegram numeric id signs you into the SAME user row the bot
 * uses, so one history covers both surfaces. Anything else makes a
 * console-only identity.
 */
export function SignIn({ onToken }: { onToken: (t: string) => void }) {
  const signIn = useMutation(api.console.signIn);
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await signIn({ handle: handle.trim() || undefined });
      try {
        localStorage.setItem("orydl_token", res.token);
      } catch {
        /* private mode — the session still works for this tab */
      }
      onToken(res.token);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="empty">
      <div className="glyph">
        <Phone />
      </div>
      <h2>Open the console</h2>
      <p>
        Enter your <b>Telegram user ID</b> to pick up the missions you started in the
        bot, or any name for a console-only workspace. Both land in the same
        history.
      </p>

      <div className="signin">
        <input
          className="ph-input"
          value={handle}
          placeholder="1212129150  ·  or  ·  pulkit"
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          aria-label="Telegram user ID or a name"
        />
        <button className="btn solid" onClick={go} disabled={busy}>
          {busy ? "…" : "Enter"}
        </button>
      </div>

      {err && <div className="gate-refusal">{err}</div>}

      <div className="mono" style={{ marginTop: 14 }}>
        arrived from a Telegram DM? the ?t=… link signs you in automatically
      </div>
    </div>
  );
}
