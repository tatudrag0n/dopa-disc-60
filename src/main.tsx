import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root が見つかりません");

document.getElementById("boot")?.remove();

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
