import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { ThemeBackdrop } from "./components/theme/ThemeBackdrop.jsx";
import { installErrorReporting, reportIssue } from "./lib/diagnostics.js";
import { onRenderError } from "./lib/markdown.js";
import { initTheme } from "./lib/theme.js";
import "./style.css";

// Apply the saved theme before the first paint so the app never flashes the
// default look.
initTheme();
installErrorReporting();
onRenderError((error) => reportIssue({ code: "markdown", message: error.message, detail: error.stack }));

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <ThemeBackdrop />
    <App />
  </ErrorBoundary>,
);
