const models = [
  {
    idx: "01",
    name: "Saarika",
    role: "Streaming ASR",
    body: "Hears the callee through accents and shop noise.",
  },
  {
    idx: "02",
    name: "Bulbul",
    role: "Text-to-speech",
    body: "Orydl's voice. Firm on price, warm on the close.",
  },
  {
    idx: "03",
    name: "Sarvam-M",
    role: "The negotiation brain",
    body: "Leverage, ranking, and when to ping you.",
  },
  {
    idx: "04",
    name: "Saaras",
    role: "Speech translation · stretch",
    body: "Bridges your language and theirs, live.",
  },
];

export default function VoiceStack() {
  return (
    <section className="stack" id="stack">
      <div
        className="blob peri"
        style={{ width: 420, height: 420, top: 20, left: -180, opacity: 0.28 }}
      />
      <div className="wrap">
        <div className="sec-head rv">
          <h2>Powered by the Sarvam voice stack</h2>
          <span className="k">The engine</span>
        </div>
        <p className="lead rv">
          Four models. One fluent negotiator on every call.
        </p>
        <div className="stack-grid" data-stagger="72">
          {models.map((m) => (
            <div className="sv rv" data-rv="scale" key={m.idx}>
              <div className="name">{m.name}</div>
              <div className="role">{m.role}</div>
              <p>{m.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
