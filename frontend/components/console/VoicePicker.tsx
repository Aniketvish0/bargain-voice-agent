"use client";

import { useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

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
 * Choose who does the talking, and hear them before you commit.
 *
 * The preview renders through the SAME model, language and speaker the call
 * will use, so the audition is honest — a voice that sounds right in English
 * can be wrong in Tamil, and you only find that out on a real call otherwise.
 *
 * Only speakers present in `V3_SPEAKERS` are offered, because a name outside
 * that set is a 400 from Sarvam TTS at dial time — a dead call, not a styling
 * bug. The list comes from the server (`console.voices`) so it cannot drift.
 */
export function VoicePicker({
  token,
  language,
  voice,
}: {
  token: string;
  language: string;
  voice: string;
}) {
  const opts = useQuery(api.console.voices, {});
  const setPrefs = useMutation(api.console.setPrefs);
  const preview = useAction(api.console.previewVoice);

  const [playing, setPlaying] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "female" | "male">("all");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const voices = (opts?.voices ?? []).filter(
    (v: any) => filter === "all" || v.gender === filter,
  );

  async function hear(id: string) {
    setErr(null);
    setPlaying(id);
    try {
      const res = await preview({ token, voice: id, language: language as any });
      if (!res.ok || !res.base64) {
        setErr(res.reason ?? "Preview failed");
        return;
      }
      audioRef.current?.pause();
      const el = new Audio(`data:${res.mime ?? "audio/wav"};base64,${res.base64}`);
      audioRef.current = el;
      el.onended = () => setPlaying(null);
      await el.play();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      // `onended` clears it for a clip that actually played; this covers errors.
      setTimeout(() => setPlaying((p) => (p === id ? null : p)), 4000);
    }
  }

  return (
    <div className="voicepick">
      <div className="side-head" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <span className="mono-label">Who calls for you</span>
      </div>

      <div className="vp-row">
        <select
          className="vp-select"
          value={language}
          onChange={(e) => setPrefs({ token, language: e.target.value as any })}
          aria-label="Call language"
        >
          {(opts?.languages ?? ["hi-IN", "en-IN"]).map((l: string) => (
            <option key={l} value={l}>
              {LANG_NAME[l] ?? l}
            </option>
          ))}
        </select>

        <div className="vp-seg">
          {(["all", "female", "male"] as const).map((g) => (
            <button
              key={g}
              className={`vp-segb${filter === g ? " on" : ""}`}
              onClick={() => setFilter(g)}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      <div className="vp-list">
        {voices.map((v: any) => (
          <div key={v.id} className={`vp-item${v.id === voice ? " on" : ""}`}>
            <button
              className="vp-play"
              onClick={() => hear(v.id)}
              title={`Hear ${v.label}`}
              aria-label={`Hear ${v.label}`}
            >
              {playing === v.id ? <span className="spin" /> : "▶"}
            </button>
            <div className="vp-who">
              <div className="nm">
                {v.label}
                <span className={`vp-g ${v.gender}`}>{v.gender === "female" ? "F" : "M"}</span>
              </div>
              <div className="sub">{v.note}</div>
            </div>
            <button
              className={`vp-use${v.id === voice ? " on" : ""}`}
              onClick={() => setPrefs({ token, voice: v.id })}
              disabled={v.id === voice}
            >
              {v.id === voice ? "in use" : "use"}
            </button>
          </div>
        ))}
      </div>

      {err && <div className="gate-refusal">{err}</div>}
      <div className="vp-note">
        Previews use the same bulbul:v3 speaker and language the call will use.
      </div>
    </div>
  );
}
