import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  onError: (error: Error, info: ErrorInfo) => void;
};

type State = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError(error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <section className="startup-overlay app-error-boundary-fallback" aria-live="assertive" role="alert">
          <div className="startup-card app-error-boundary-card">
            <h2>Renderer failed</h2>
            <p>{this.state.error.message || "An unexpected renderer error occurred."}</p>
            <div className="app-error-boundary-actions">
              <button type="button" onClick={() => window.location.reload()}>
                Reload app
              </button>
            </div>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}
