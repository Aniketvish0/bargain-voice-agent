import ThemeToggle from "./ThemeToggle";

export default function Nav() {
  return (
    <header className="nav">
      <div className="wrap nav-in">
        <div className="brand">
          ORYDL<span className="dev">.</span>
          <span className="deva">the calling envoy</span>
        </div>
        <nav className="nav-meta">
          <a href="#leverage" className="hidem">
            LEVERAGE
          </a>
          <a href="#console" className="hidem">
            CONSOLE
          </a>
          <a href="#stack" className="hidem">
            VOICE STACK
          </a>
          <ThemeToggle />
          <a href="#cta" className="btn ghost">
            GIVE IT A GOAL
          </a>
        </nav>
      </div>
    </header>
  );
}
