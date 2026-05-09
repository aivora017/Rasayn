// Backwards-compat re-export. Real implementation lives in ./ipc-stub.ts
// per the S28-A2 owned-file scope. Kept as a stub because the Linux
// mount cannot remove files written from the agent (Windows-mount
// permission quirk).
export {
  installIpcStub,
  getIpcCalls,
  expectCmdCalled,
} from "./ipc-stub.js";
