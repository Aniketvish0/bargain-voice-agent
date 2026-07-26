"use client";

import { useEffect, useRef, useState } from "react";

type Row = { who: string; w: string; amt: React.ReactNode };

const dootRows: Row[] = [
  { who: "HOTEL A", w: "46%", amt: (<><s>3,200</s>2,750</>) },
  { who: "HOTEL B", w: "60%", amt: (<><s>3,600</s>2,900</>) },
  { who: "HOTEL C", w: "34%", amt: (<><s>3,000</s>2,600</>) },
  { who: "HOTEL D", w: "72%", amt: (<><s>3,900</s>3,150</>) },
  { who: "HOTEL E", w: "52%", amt: (<><s>3,400</s>2,820</>) },
];

const humanRows: Row[] = [
  { who: "CALL 1", w: "80%", amt: "3,200" },
  { who: "CALL 2", w: "20%", amt: "·" },
  { who: "CALL 3", w: "8%", amt: "···" },
  { who: "CALL 4", w: "0%", amt: "·" },
  { who: "CALL 5", w: "0%", amt: "·" },
];

function QuoteRows({ rows, active }: { rows: Row[]; active: boolean }) {
  return (
    <>
      {rows.map((r, i) => (
        <div className="qrow" key={i}>
          <span className="who">{r.who}</span>
          <span className="bar">
            <i className="fill" style={{ width: active ? r.w : "0%" }} />
          </span>
          <span className="amt">{r.amt}</span>
        </div>
      ))}
    </>
  );
}

export default function Leverage() {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setActive(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setActive(true);
            io.disconnect();
          }
        });
      },
      { threshold: 0.3 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section className="leverage" id="leverage">
      <div
        className="blob peri"
        style={{ width: 400, height: 400, top: 40, left: -180, opacity: 0.3 }}
      />
      <div className="wrap">
        <div className="sec-head">
          <h2>Parallel competitive leverage</h2>
          <span className="k">The differentiator</span>
        </div>
        <p className="lead rv">
          Orydl holds every quote live and plays them against each other.{" "}
          <b>A human physically cannot do this.</b>
        </p>

        <div className="lev-grid rv" ref={ref}>
          <div className="lev-cell doot">
            <span className="tag">◆ ORYDL · 5 CALLS LIVE</span>
            <h3>Every quote, held at once</h3>
            <p>One quote becomes the lever against the next.</p>
            <div className="quotebar">
              <QuoteRows rows={dootRows} active={active} />
            </div>
          </div>
          <div className="lev-cell human">
            <span className="tag">◇ YOU · ONE THUMB</span>
            <h3>You, with your thumb and 40 minutes</h3>
            <p>One call at a time. Nobody&apos;s competing.</p>
            <div className="quotebar">
              <QuoteRows rows={humanRows} active={active} />
            </div>
            <p className="lev-foot">
              Google Duplex made <b>one</b> call, and never shipped in India.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
