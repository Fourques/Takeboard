import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./app-error-boundary";
import { AuthGate } from "./auth-ui";
import { resolveDisplayScale } from "./display-scale";
import { readThemePreference, rememberTheme } from "./theme-preferences";
import "./styles.css";

rememberTheme(readThemePreference());
let savedDisplayScale: string | null = null;
try {
  savedDisplayScale = window.localStorage.getItem("takeboard.display-scale");
} catch {
  // Blocked browser storage must not break first paint or theme recovery.
}
const displayScale = resolveDisplayScale(savedDisplayScale);
document.documentElement.style.setProperty("--ui-scale", String(displayScale));
document.documentElement.style.setProperty("--ui-scale-inverse", String(1 / displayScale));
document.documentElement.dataset.displayScale = String(displayScale).replace(".", "-");

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("TakeBoard root element is missing");
}

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <AuthGate>
        <App />
      </AuthGate>
    </AppErrorBoundary>
  </StrictMode>,
);
