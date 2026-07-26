import Flourish from "./Flourish";

export default function Footer() {
  return (
    <>
      {/* FOOTER CTA */}
      <section className="foot-cta" id="cta">
        <div
          className="blob sig"
          style={{
            width: 520,
            height: 300,
            bottom: -140,
            left: "50%",
            transform: "translateX(-50%)",
            opacity: 0.5,
          }}
        />
        <div className="wrap">
          <div className="deva">The calling envoy</div>
          <h2>Send an envoy. Skip the phone.</h2>
          <p>One goal in, the best deal out.</p>
          <div className="cta">
            <a href="#" className="btn solid">
              GIVE IT A GOAL
            </a>
            <a href="#flow" className="btn ghost">
              SEE HOW IT WORKS
            </a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <section className="cyclefoot">
        <Flourish paddingTop={0} />
        <div className="wrap ko-wrap">
          <h2 className="knockout" aria-label="Orydl">ORYDL</h2>
        </div>
      </section>
    </>
  );
}
