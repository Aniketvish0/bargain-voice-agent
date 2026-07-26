export default function Hero() {
  return (
    <section className="hero">
      <div
        className="blob peri"
        style={{ width: 520, height: 520, top: -160, right: -120 }}
      />
      <div
        className="blob amber"
        style={{ width: 380, height: 380, top: 120, left: -160, opacity: 0.35 }}
      />
      <div className="wrap hero-top">
        <h1 className="hero-h rv">
          You give it one goal. It calls{" "}
          <span className="em">ten places at once.</span>
        </h1>

        <p className="hero-sub rv">
          One goal in. <b>Orydl makes every call in parallel.</b>
        </p>

        <div className="hero-cta rv">
          <a
            href="https://t.me/orydl_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="btn solid"
          >
            SEND ORYDL ON YOUR FIRST CALL
          </a>
          <a href="#console" className="btn ghost">
            WATCH IT NEGOTIATE →
          </a>
          <span className="note">Zero calls made by you.</span>
        </div>
      </div>

      <div className="wrap">
        <div className="hero-photo rv">
          <img
            className="photo-img"
            src="/assets/golden-temple-dusk.jpg"
            alt="A boatman on still water before the Golden Temple at dusk in Amritsar, rendered as a signal-orange duotone."
            loading="eager"
          />
          <div className="photo-halftone" aria-hidden="true" />
          <div className="photo-lines" aria-hidden="true" />
          <div className="photo-scrim" aria-hidden="true" />
          <div className="frame-lbls" aria-hidden="true">
            <span>AMRITSAR / 18:42 IST</span>
            <span>DUOTONE · SIGNAL-ORANGE</span>
          </div>
        </div>
      </div>
    </section>
  );
}
