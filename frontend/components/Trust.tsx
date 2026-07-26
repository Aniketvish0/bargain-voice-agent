const items = [
  {
    no: "01",
    h: "AI disclosure, first line, every call",
    p: <>Orydl says what it is before it asks anything.</>,
  },
  {
    no: "02",
    h: "Do-not-call honoured and logged",
    p: <>Opt out once, never dialed again.</>,
  },
  {
    no: "03",
    h: "Signed recording + transcript per call",
    p: <>Every price is <b>provable</b>, with the receipts.</>,
  },
  {
    no: "04",
    h: "No autonomous payment. No giving out your ID.",
    p: <>Money and identity are <b>always yours to approve</b>.</>,
  },
];

export default function Trust() {
  return (
    <section className="trust">
      <div className="wrap">
        <div className="sec-head">
          <h2>Consent, built in, not bolted on.</h2>
          <span className="k">Trust</span>
        </div>
        <div className="tlist rv">
          {items.map((it) => (
            <div className="titem" key={it.h}>
              <div>
                <h5>{it.h}</h5>
                <p>{it.p}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
