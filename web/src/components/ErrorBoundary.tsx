import { Component, type ReactNode } from "react";

/**
 * Convex throws query errors during render, so anything the backend rejects —
 * a stale token, a function that isn't deployed — unmounts the whole tree and
 * leaves a white screen. Catch it and say what happened instead.
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
    const missingFn = /Could not find public function/i.test(msg);
    const badSession = /Invalid session|Session expired/i.test(msg);

    return (
      <div className="gate">
        <h1>The console hit an error</h1>
        {missingFn && (
          <p>
            The Convex deployment at <code>{import.meta.env.VITE_CONVEX_URL}</code>{" "}
            doesn't have these functions. This project runs an anonymous local
            backend — start it with <b>npx convex dev</b> and point{" "}
            <b>VITE_CONVEX_URL</b> at <b>http://127.0.0.1:3210</b>.
          </p>
        )}
        {badSession && (
          <p>
            Your dashboard session is invalid or expired. Send <b>/start</b> to{" "}
            <a href="https://t.me/orydl_bot">@orydl_bot</a> for a fresh link.
          </p>
        )}
        <code>{msg.split("\n").slice(0, 3).join("\n")}</code>
        <p style={{ marginTop: 16 }}>
          <button className="btn" onClick={() => location.reload()}>
            Reload
          </button>
        </p>
      </div>
    );
  }
}
