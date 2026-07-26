"use client";

import { useEffect, useRef, useState } from "react";

type Row = { who: string; w: string; from?: string; to?: number; raw?: string };

const dootRows: Row[] = [
  { who: "HOTEL A", w: "46%", from: "3,200", to: 2750 },
  { who: "HOTEL B", w: "60%", from: "3,600", to: 2900 },
  { who: "HOTEL C", w: "34%", from: "3,000", to: 2600 },
  { who: "HOTEL D", w: "72%", from: "3,900", to: 3150 },
  { who: "HOTEL E", w: "52%", from: "3,400", to: 2820 },
];

const humanRows: Row[] = [
  { who: "CALL 1", w: "80%", to: 3200 },
  { who: "CALL 2", w: "20%", raw: "·" },
  { who: "CALL 3", w: "8%", raw: "···" },
  { who: "CALL 4", w: "0%", raw: "·" },
  { who: "CALL 5", w: "0%", raw: "·" },
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
          <span className="amt">
            {r.from && <s>{r.from}</s>}
            {r.to != null ? (
              <span data-count={r.to}>0</span>
            ) : (
              r.raw
            )}
          </span>
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
        <div className="sec-head rv">
          <h2>Parallel competitive leverage</h2>
          <span className="k">The differentiator</span>
        </div>
        <p className="lead rv">
          Orydl holds every quote live and plays them against each other.{" "}
          <b>A human physically cannot do this.</b>
        </p>

        <div className="lev-grid" ref={ref} data-stagger="90">
          <div className="lev-cell doot rv" data-rv="scale">
            <span className="tag">◆ ORYDL · 5 CALLS LIVE</span>
            <h3>Every quote, held at once</h3>
            <p>One quote becomes the lever against the next.</p>
            <div className="quotebar">
              <QuoteRows rows={dootRows} active={active} />
            </div>
          </div>
          <div className="lev-cell human rv" data-rv="scale">
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
