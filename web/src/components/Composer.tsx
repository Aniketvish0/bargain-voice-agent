import { useEffect, useRef, useState } from "react";

/**
 * The control line. One input drives everything: a new goal when nothing is
 * selected, a command against the current mission when something is.
 */
export function Composer({
  placeholder,
  hint,
  busy,
  suggestions,
  onSubmit,
}: {
  placeholder: string;
  hint: string;
  busy: boolean;
  suggestions: string[];
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the content, up to a ceiling, the way every chat composer does.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [text]);

  function send() {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    onSubmit(t);
  }

  return (
    <div className="composer">
      <div className="composer-in">
        {suggestions.length > 0 && !text && (
          <div className="suggests">
            {suggestions.map((s) => (
              <button key={s} className="suggest" onClick={() => onSubmit(s)} disabled={busy}>
                {s}
              </button>
            ))}
          </div>
        )}

        <div className={`inputwrap${busy ? " busy" : ""}`}>
          <textarea
            ref={ref}
            rows={1}
            value={text}
            disabled={busy}
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            className="send"
            onClick={send}
            disabled={busy || !text.trim()}
            aria-label="Send"
            title="Send"
          >
            {busy ? <span className="spin" /> : <Arrow />}
          </button>
        </div>

        <div className="composer-note">{hint}</div>
      </div>
    </div>
  );
}

const Arrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);
