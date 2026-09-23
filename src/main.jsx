import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { installErrorReporting, reportIssue } from "./lib/diagnostics.js";
import { onRenderError } from "./lib/markdown.js";
import "./style.css";

installErrorReporting();
onRenderError((error) => reportIssue({ code: "markdown", message: error.message, detail: error.stack }));

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
