const CHECKS = [
  {
    letter: "A",
    label: "Checkpoint A",
    title: "Approve the plan",
    body: "Approve the plan before Orydl dials.",
    when: "Before dialing",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    ),
  },
  {
    letter: "B",
    label: "Checkpoint B",
    title: "Mid-call escalation",
    body: "A callee goes off-policy, Orydl pings you Yes or No.",
    when: "During the call",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
      </svg>
    ),
  },
  {
    letter: "C",
    label: "Checkpoint C",
    title: "Pick the winner & book",
    body: "Pick the winner, Orydl books it.",
    when: "Closing",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="m8.5 12.5 2.5 2.5 4.5-5" />
      </svg>
    ),
  },
];

export default function Checkpoints() {
  return (
    <section className="flow" id="flow">
      <div
        className="blob amber"
        style={{ width: 360, height: 360, top: 60, right: -160, opacity: 0.28 }}
      />
      <div className="wrap">
        <div className="sec-head">
          <h2>Three checkpoints. You stay in the loop.</h2>
          <span className="k">Human-in-the-loop</span>
        </div>
        <p className="lead rv">Orydl pings you only at the moments that matter.</p>

        <div className="checks">
          {CHECKS.map((c) => (
            <div className="check rv" key={c.letter}>
              <span className="chk-letter" aria-hidden="true">
                {c.letter}
              </span>
              <span className="chk-ico">{c.icon}</span>
              <span className="badge">
                <span className="dot" />
                {c.label}
              </span>
              <h4>{c.title}</h4>
              <p>{c.body}</p>
              <div className="when">{c.when}</div>
            </div>
          ))}
        </div>

        <p className="flow-note rv">
          → <b>Telegram, voice-first.</b> Say the goal, Orydl does the rest.
        </p>
      </div>
    </section>
  );
}
