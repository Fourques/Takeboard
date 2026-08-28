import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const savedTheme = window.localStorage.getItem("takeboard.theme");
document.documentElement.dataset.theme =
  savedTheme === "light" || savedTheme === "chroma" ? savedTheme : "noir";
const savedDisplayScale = Number(window.localStorage.getItem("takeboard.display-scale"));
const displayScale = [0.9, 1, 1.12, 1.24, 1.4].includes(savedDisplayScale) ? savedDisplayScale : 1;
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
