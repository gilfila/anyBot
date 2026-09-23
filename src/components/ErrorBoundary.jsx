import React from "react";
import { AlertCircle, Copy, RotateCcw } from "lucide-react";
import { reportIssue } from "../lib/diagnostics.js";
import "./diagnostics.css";

// Last line of defense for render bugs: without it one bad component blanks
// the whole window. The crash is recorded in Settings → Diagnostics.
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, stack: "", copied: false };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    const stack = `${error?.stack || error}\n\nComponent stack:${info?.componentStack || ""}`;
    this.setState({ stack });
    reportIssue({ code: "crash", message: error?.message || String(error), detail: stack });
  }
  render() {
    if (!this.state.error) return this.props.children;
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(this.state.stack);
        this.setState({ copied: true });
      } catch {
        // Clipboard access can be denied; the details are in the log anyway.
      }
    };
    return (
      <div className="crash-screen" role="alert">
        <div className="crash-card">
          <AlertCircle size={22} />
          <h1>Something went wrong on this screen</h1>
          <p>
            Any Bot recorded the details under Settings → Diagnostics. Your bots, chats, and running work are unaffected.
          </p>
          <pre>{String(this.state.error?.message || this.state.error)}</pre>
          <div className="crash-actions">
            <button type="button" className="primary" onClick={() => window.location.reload()}>
              <RotateCcw size={15} />
              Reload
            </button>
            <button type="button" className="secondary" onClick={copy}>
              <Copy size={15} />
              {this.state.copied ? "Copied" : "Copy details"}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
