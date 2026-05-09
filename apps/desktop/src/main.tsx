import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { initI18n } from "@pharmacare/design-system";

// S28-D1 (Q-007 + ADR-0074): default locale is Marathi for the Vaidyanath
// pilot (Maharashtra). Cashier explicitly switches to en/hi via Settings;
// `pc-locale` localStorage value wins when present.
initI18n((localStorage.getItem("pc-locale") as "en"|"hi"|"mr"|null) ?? "mr");
import { setIpcHandler, type IpcCall } from "./lib/ipc.js";

// CSS load order is binding (North Star §4):
//   1. Design system tokens (CSS custom properties)
//   2. Tailwind 4 + @theme bridge
//   3. Legacy styles.css (back-compat for un-reskinned screens)
import "@pharmacare/design-system/tokens.css";
import "./tailwind.css";
import "./styles.css";

async function installHandler() {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    setIpcHandler(async (call: IpcCall) => invoke(call.cmd, call.args as Record<string, unknown>));
  } catch {
    setIpcHandler(async () => { console.warn("IPC: no Tauri, using empty stub"); return null; });
  }
}
void installHandler();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App initialMode="dashboard" />
  </StrictMode>,
);
