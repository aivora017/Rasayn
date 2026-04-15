import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { setIpcHandler, type IpcCall } from "./lib/ipc.js";
import "./styles.css";

// Production: route to Tauri. Dev fallback: stub with empty responses.
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
  <StrictMode><App /></StrictMode>,
);
