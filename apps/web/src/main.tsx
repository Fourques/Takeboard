import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const savedTheme = window.localStorage.getItem("takeboard.theme");
document.documentElement.dataset.theme =
  savedTheme === "light" || savedTheme === "chroma" ? savedTheme : "noir";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("TakeBoard root element is missing");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
