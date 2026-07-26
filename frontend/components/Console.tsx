"use client";

import { useState } from "react";

export default function Console() {
  const [resolved, setResolved] = useState(false);
  const [showDone, setShowDone] = useState(false);

  function resolveCk() {
    if (resolved) return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    setResolved(true);
    setTimeout(
      () => {
        setShowDone(true);
      },
      reduce ? 0 : 650
    );
  }

  return (
    <section className="composition" id="console">
      <div className="wrap">
        <div className="sec-head rv">
          <h2>This is Orydl, mid-dispatch.</h2>
          <span className="k">Live console</span>
        </div>
        <p className="lead rv">
          Five hotels, negotiated at once, one checkpoint on your tap.
        </p>

        <div className="stage rv">
          <div className="bg" aria-hidden="true">
            <img
              src="/assets/wallpaper-valley.jpg"
              alt=""
              data-parallax="82"
              data-parallax-scale="1.22"
            />
            <div className="vig" />
          </div>

          {/* macOS window */}
          <div className="macwin">
            <div className="macbar">
              <div className="traffic">
                <i className="r" />
                <i className="y" />
                <i className="g" />
              </div>
              <div className="mac-title">
                ORYDL · <b>Jaipur / room · 2 pax · ≤ ₹4,000</b>
              </div>
              <div className="mac-live">
                <span className="pulse" />5 CALLS LIVE
              </div>
            </div>
            <div className="macbody">
              <aside className="macside">
                <p className="sh">The goal</p>
                <div className="goal">
                  <span className="mic">🎤</span> &quot;Room in Jaipur, 2 people,
                  under ₹4k, near the old city.&quot;
                </div>
                <div className="bestcard">
                  <div className="lb">◆ Best deal so far</div>
                  <div className="price">
                    <span data-count="2750" data-count-prefix="₹">₹0</span>
                    <s>₹3,200</s>
                  </div>
                  <div className="who">Hotel Pearl Palace · Old City</div>
                </div>
                <p className="foot">
                  Best quote pushed into <b>3 open calls</b>.
                </p>
              </aside>
              <div className="macmain">
                <div className="mm-h">
                  <span>Parallel call board</span>
                  <span className="cnt">03 negotiating · 01 won</span>
                </div>

                <div className="crow best">
                  <span className="ix">01</span>
                  <div>
                    <div className="who">Hotel Pearl Palace</div>
                    <div className="sub">Hindi · anchored on quote #3</div>
                  </div>
                  <div className="pr">
                    <s>3,200</s>
                    <b data-count="2750">0</b>
                  </div>
                  <button className="book">BOOK</button>
                </div>
                <div className="crow">
                  <span className="ix">02</span>
                  <div>
                    <div className="who">Hotel Arya Niwas</div>
                    <div className="sub">Hindi · countered 3,400 → 2,900</div>
                  </div>
                  <div className="pr">
                    <s>3,400</s>
                    <b data-count="2900">0</b>
                  </div>
                  <span className="pill neg">Negotiating</span>
                </div>
                <div className="crow">
                  <span className="ix">03</span>
                  <div>
                    <div className="who">Umaid Bhawan</div>
                    <div className="sub">Hindi-Eng · using Pearl&apos;s 2,750</div>
                  </div>
                  <div className="pr">
                    <s>3,000</s>
                    <b data-count="2680">0</b>
                  </div>
                  <span className="pill anchor">Anchoring</span>
                </div>
                <div className="crow">
                  <span className="ix">04</span>
                  <div>
                    <div className="who">Tara Niwas Haveli</div>
                    <div className="sub">Breakfast +₹500, off policy</div>
                  </div>
                  <div className="pr">
                    <b data-count="2880">0</b>
                  </div>
                  <span className="pill ckb">Checkpoint B</span>
                </div>
                <div className="crow">
                  <span className="ix">05</span>
                  <div>
                    <div className="who">Hotel Kalyan</div>
                    <div className="sub">Opted out · logged, won&apos;t redial</div>
                  </div>
                  <div className="pr">·</div>
                  <span className="pill passed">Passed</span>
                </div>
                <div className="mm-foot">
                  <span className="sig">◆ CROSS-CALL LEVERAGE.</span> ₹2,750 pushed
                  into 3 open calls. Every price still moving.
                </div>
              </div>
            </div>
          </div>

          {/* phone */}
          <div className="phone">
            <div className="notch" />
            <div className="screen">
              <div className="tg-top">
                <div className="av">O</div>
                <div>
                  <div className="nm">Orydl</div>
                  <div className="on">negotiating · 5 lines</div>
                </div>
              </div>
              <div className="tg-scroll">
                <div className="b sys">Today 18:38</div>
                <div className="vnote">
                  <span className="play">▶</span>
                  <span className="wave" aria-hidden="true">
                    <i style={{ height: 6 }} />
                    <i style={{ height: 12 }} />
                    <i style={{ height: 18 }} />
                    <i style={{ height: 9 }} />
                    <i style={{ height: 14 }} />
                    <i style={{ height: 7 }} />
                    <i style={{ height: 16 }} />
                    <i style={{ height: 11 }} />
                    <i style={{ height: 5 }} />
                  </span>
                  <span className="dur">0:07</span>
                </div>
                <div className="b in">
                  Got it. Room in Jaipur, 2 guests, under ₹4k, near the old city.{" "}
                  <b>Calling 5 hotels near Hawa Mahal</b> now.{" "}
                  <span className="t">Orydl · 18:38</span>
                </div>

                <div
                  className="ckcard"
                  style={resolved ? { opacity: 0.5 } : undefined}
                >
                  <div className="top">
                    <span className="lb">
                      ◆ Checkpoint B · Tara Niwas Haveli
                    </span>
                    They&apos;ll do ₹2,880 but want +₹500 for breakfast (2). Off
                    your policy: take it or hold?
                  </div>
                  <div className="btns">
                    <button
                      className="yes"
                      onClick={resolveCk}
                      disabled={resolved}
                      style={resolved ? { cursor: "default" } : undefined}
                    >
                      ✓ YES, TAKE IT
                    </button>
                    <button
                      className="no"
                      onClick={resolveCk}
                      disabled={resolved}
                      style={resolved ? { cursor: "default" } : undefined}
                    >
                      ✕ HOLD THE LINE
                    </button>
                  </div>
                </div>

                {resolved && (
                  <div className="b out">
                    Hold the line. Breakfast&apos;s not worth it.{" "}
                    <span className="t">You · 18:42</span>
                  </div>
                )}
                {showDone && (
                  <div className="b in">
                    Done. Kept ₹2,750 with Pearl Palace, no add-ons.{" "}
                    <span className="t">Orydl · 18:42</span>
                  </div>
                )}

                <div className="dealcard">
                  <div className="lb">◆ Best deal so far</div>
                  <div className="p">
                    <span data-count="2750" data-count-prefix="₹">₹0</span>{" "}
                    <s>₹3,200</s>
                  </div>
                  <div className="m">
                    Pearl Palace · Hindi · beat 4 quotes · recording attached 🎧
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <p className="comp-caption">
          ↑ Checkpoint B is live. Try the buttons.
        </p>
      </div>
    </section>
  );
}
