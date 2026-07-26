// Imported per-route, not in the root layout: /console ships a different
// design system that defines the same custom-property names with different
// values, and loading both stylesheets on one page makes whichever lost the
// cascade look broken.
import "./globals.css";
import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import Leverage from "@/components/Leverage";
import Console from "@/components/Console";
import Checkpoints from "@/components/Checkpoints";
import VoiceStack from "@/components/VoiceStack";
import Trust from "@/components/Trust";
import Footer from "@/components/Footer";
import Flourish from "@/components/Flourish";
import RevealInit from "@/components/RevealInit";

export default function Page() {
  return (
    <>
      {/* duotone filter: luminance -> ink to signal-orange ramp */}
      <svg
        width="0"
        height="0"
        aria-hidden="true"
        style={{ position: "absolute" }}
      >
        <filter id="orydl-duo" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="0.33 0.34 0.33 0 0
                    0.33 0.34 0.33 0 0
                    0.33 0.34 0.33 0 0
                    0    0    0    1 0"
          />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.04 0.30 0.72 1.0" />
            <feFuncG type="table" tableValues="0.03 0.10 0.31 0.55" />
            <feFuncB type="table" tableValues="0.03 0.06 0.14 0.28" />
          </feComponentTransfer>
        </filter>
      </svg>

      <div className="grain" aria-hidden="true" />

      <Nav />
      <main>
        <Hero />
        <Flourish />
        <Leverage />
        <Console />
        <Flourish />
        <Checkpoints />
        <VoiceStack />
        <Trust />
        <Footer />
      </main>

      <RevealInit />
    </>
  );
}
