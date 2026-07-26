"use client";

import { useEffect } from "react";

export default function RevealInit() {
  useEffect(() => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const revealEls = Array.from(document.querySelectorAll<HTMLElement>(".rv"));
    const countEls = Array.from(
      document.querySelectorAll<HTMLElement>("[data-count]")
    );

    // ---- helpers -------------------------------------------------------
    const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

    const setCountFinal = (el: HTMLElement) => {
      const to = Number(el.dataset.count || "0");
      const prefix = el.dataset.countPrefix || "";
      el.textContent = prefix + fmt(to);
    };

    // ---- reduced motion: show everything in final state, no motion -----
    if (reduce) {
      revealEls.forEach((el) => el.classList.add("in"));
      countEls.forEach(setCountFinal);
      // keep the nav legible without the scroll-driven transition
      document.querySelector("header.nav")?.classList.add("scrolled");
      return;
    }

    const cleanups: Array<() => void> = [];

    // ---- stagger delays for grouped reveals ---------------------------
    // A parent with [data-stagger] cascades its .rv descendants.
    document
      .querySelectorAll<HTMLElement>("[data-stagger]")
      .forEach((group) => {
        const gap = Number(group.dataset.stagger) || 78;
        const items = Array.from(group.querySelectorAll<HTMLElement>(".rv"));
        items.forEach((item, i) => {
          item.style.transitionDelay = `${i * gap}ms`;
        });
      });

    // ---- scroll reveals -----------------------------------------------
    const revealIO = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const el = e.target as HTMLElement;
            el.classList.add("in");
            // drop the stagger delay after reveal so hover stays snappy
            const delay = el.style.transitionDelay;
            if (delay && delay !== "0ms") {
              window.setTimeout(() => {
                el.style.transitionDelay = "";
              }, 800 + parseInt(delay, 10));
            }
            revealIO.unobserve(e.target);
          }
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -8% 0px" }
    );
    revealEls.forEach((el) => revealIO.observe(el));
    cleanups.push(() => revealIO.disconnect());

    // ---- count-up numbers ----------------------------------------------
    const runCount = (el: HTMLElement) => {
      const to = Number(el.dataset.count || "0");
      const prefix = el.dataset.countPrefix || "";
      const dur = 1100;
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
        el.textContent = prefix + fmt(to * eased);
        if (t < 1) requestAnimationFrame(tick);
        else el.textContent = prefix + fmt(to);
      };
      requestAnimationFrame(tick);
    };
    countEls.forEach((el) => {
      el.textContent = (el.dataset.countPrefix || "") + "0";
    });
    const countIO = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            runCount(e.target as HTMLElement);
            countIO.unobserve(e.target);
          }
        });
      },
      { threshold: 0.5 }
    );
    countEls.forEach((el) => countIO.observe(el));
    cleanups.push(() => countIO.disconnect());

    // ---- rAF scroll loop: nav state + parallax ------------------------
    const nav = document.querySelector<HTMLElement>("header.nav");
    const parallaxEls = Array.from(
      document.querySelectorAll<HTMLElement>("[data-parallax]")
    );

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const vh = window.innerHeight;
        const y = window.scrollY;

        if (nav) nav.classList.toggle("scrolled", y > 64);

        for (const el of parallaxEls) {
          const rect = el.getBoundingClientRect();
          if (rect.bottom < -200 || rect.top > vh + 200) continue;
          const strength = Number(el.dataset.parallax) || 40;
          const scale = el.dataset.parallaxScale || "";
          // progress: -1 (below) .. 1 (above) relative to viewport centre
          const progress = (rect.top + rect.height / 2 - vh / 2) / vh;
          const ty = Math.max(-1, Math.min(1, progress)) * -strength;
          el.style.transform = `translate3d(0,${ty.toFixed(2)}px,0)${
            scale ? ` scale(${scale})` : ""
          }`;
        }
        ticking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    onScroll(); // prime initial state
    cleanups.push(() => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    });

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return null;
}
