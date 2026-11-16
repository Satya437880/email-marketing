import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./index.css";
import { ToastProvider } from "./ui";

// The whole app is drawn smaller (UI_SCALE) so that at 100% browser zoom it looks like it does at 80%. Browsers disagree on how CSS zoom treats
// percentage sizes, so check with a hidden test box: if a zoomed box of width 100% still spans the window, percentages are already measured
// in zoomed space; otherwise the body must be made 1 / UI_SCALE of the window so that, once shrunk, it fills it exactly.
const UI_SCALE = 0.8;
function applyUiScale() {
  const probe = document.createElement("div");
  probe.style.cssText = `zoom:${UI_SCALE};position:absolute;left:0;top:0;width:100%;height:100%;visibility:hidden;pointer-events:none`;
  document.body.appendChild(probe);
  const ratio = probe.getBoundingClientRect().width / document.documentElement.clientWidth;
  probe.remove();
  const fill = ratio > 0.9 ? "100%" : `${100 / UI_SCALE}%`;
  Object.assign(document.body.style, { zoom: String(UI_SCALE), width: fill, height: fill });
}
applyUiScale();

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 } } });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
