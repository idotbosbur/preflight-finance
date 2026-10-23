import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/index.ts";
import { App } from "./App.tsx";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
