import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { resolveDisplayScale } from "./display-scale";
import "./styles.css";

const savedTheme = window.localStorage.getItem("takeboard.theme");
document.documentElement.dataset.theme =
  savedTheme === "light" || savedTheme === "chroma" ? savedTheme : "noir";
const displayScale = resolveDisplayScale(window.localStorage.getItem("takeboard.display-scale"));
document.documentElement.style.setProperty("--ui-scale", String(displayScale));
document.documentElement.style.setProperty("--ui-scale-inverse", String(1 / displayScale));
document.documentElement.dataset.displayScale = String(displayScale).replace(".", "-");

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("TakeBoard root element is missing");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
