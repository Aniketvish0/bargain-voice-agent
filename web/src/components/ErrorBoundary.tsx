import { Component, type ReactNode } from "react";

/**
 * Convex throws query errors during render, so anything the backend rejects
 * unmounts the whole tree and leaves a white screen. Catch it and say what
 * happened.
 *
 * Convex redacts server error messages sent to browser clients — they arrive
 * as a bare "Server Error" with a request id. So the common causes have to be
 * inferred from WHICH query failed rather than from the text. Every query the
 * console makes takes a session token, which makes a bad or foreign token by
 * far the likeliest explanation.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[orydl] render crashed:", error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const msg = error.message ?? String(error);
    const url = import.meta.env.VITE_CONVEX_URL ?? "(unset)";
    const missingFn = /Could not find public function/i.test(msg);
    const isQuery = /\[CONVEX Q\(/.test(msg);

    return (
      <div className="gate">
        <h1>{missingFn ? "Backend is missing these functions" : "Can't load your missions"}</h1>

        {missingFn ? (
          <p>
            The deployment at <code>{url}</code> doesn't have the console's
            functions deployed. Run <b>npx convex dev</b> against it, or point{" "}
            <b>VITE_CONVEX_URL</b> at the deployment that does.
          </p>
        ) : isQuery ? (
          <>
            <p>
              The deployment answered, but rejected the request. Every console
              query carries a session token, and the usual cause is a token that
              was issued by a <b>different deployment</b> than the one this build
              points at.
            </p>
            <p>
              Currently pointing at <code>{url}</code>. Sessions are per-deployment,
              so a token minted anywhere else will not validate here — get a fresh
              one by sending <b>/start</b> to{" "}
              <a href="https://t.me/orydl_bot" target="_blank" rel="noreferrer">
                @orydl_bot
              </a>{" "}
              and opening the link it DMs you.
            </p>
          </>
        ) : null}

        <code>{msg.split("\n").slice(0, 3).join("\n")}</code>

        <p style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <button
            className="btn"
            onClick={() => {
              localStorage.removeItem("orydl_token");
              location.href = location.pathname;
            }}
          >
            Clear token &amp; reload
          </button>
          <button className="btn ghost" onClick={() => location.reload()}>
            Retry
          </button>
        </p>
      </div>
    );
  }
}
