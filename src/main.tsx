import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@git-diff-view/react/styles/diff-view.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/themes.css";

const reportEarlyRendererDiagnostic = (payload: {
  level: "info" | "warn" | "error";
  category: string;
  message: string;
  details?: string;
}) => {
  const pending = window.orxa?.app?.reportRendererDiagnostic?.({
    ...payload,
    source: "renderer",
  });
  void pending?.catch(() => undefined);
};

window.addEventListener("error", (event) => {
  reportEarlyRendererDiagnostic({
    level: "error",
    category: "renderer.bootstrap-error",
    message: event.message || "Unhandled renderer bootstrap error",
    details: JSON.stringify({
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error instanceof Error ? event.error.stack : undefined,
    }),
  });
});

window.addEventListener("unhandledrejection", (event) => {
  reportEarlyRendererDiagnostic({
    level: "error",
    category: "renderer.bootstrap-unhandledrejection",
    message: event.reason instanceof Error ? event.reason.message : String(event.reason),
    details: event.reason instanceof Error ? event.reason.stack : undefined,
  });
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Renderer root element '#root' was not found.");
}

createRoot(rootElement, {
  onUncaughtError: (error, info) => {
    const resolved = error instanceof Error ? error : new Error(String(error));
    reportEarlyRendererDiagnostic({
      level: "error",
      category: "renderer.root-uncaught",
      message: resolved.message || "Uncaught React root error",
      details: JSON.stringify({
        stack: resolved.stack,
        componentStack: info.componentStack,
      }),
    });
  },
  onCaughtError: (error, info) => {
    const resolved = error instanceof Error ? error : new Error(String(error));
    reportEarlyRendererDiagnostic({
      level: "warn",
      category: "renderer.root-caught",
      message: resolved.message || "Caught React root error",
      details: JSON.stringify({
        stack: resolved.stack,
        componentStack: info.componentStack,
      }),
    });
  },
  onRecoverableError: (error, info) => {
    const resolved = error instanceof Error ? error : new Error(String(error));
    reportEarlyRendererDiagnostic({
      level: "warn",
      category: "renderer.root-recoverable",
      message: resolved.message || "Recoverable React root error",
      details: JSON.stringify({
        stack: resolved.stack,
        componentStack: info.componentStack,
      }),
    });
  },
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
