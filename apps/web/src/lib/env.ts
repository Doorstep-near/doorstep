// Runtime mode: real API or the in-browser mock ("sandbox").
// VITE_MOCK=1 forces the mock; otherwise a visitor can opt into the sandbox
// (sample data in their browser) from the landing page or when the API is down.
const SANDBOX_KEY = "doorstep:sandbox";

function readSandboxFlag(): boolean {
  try {
    return window.localStorage.getItem(SANDBOX_KEY) === "1";
  } catch {
    return false;
  }
}

export const env = {
  apiUrl: ((import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:8787").replace(/\/+$/, ""),
  /** Build-time mock (npm run dev:mock). */
  forcedMock: import.meta.env.VITE_MOCK === "1" || import.meta.env.VITE_MOCK === "true",
  githubUrl: "https://github.com/Doorstep-near/doorstep",
};

/** True when requests go to the in-browser mock instead of the API. Fixed for the page's lifetime. */
export const isMock: boolean = env.forcedMock || readSandboxFlag();

/** Switches to the in-browser sandbox (or back) and reloads to the given path. */
export function setSandbox(on: boolean, path = window.location.pathname): void {
  try {
    if (on) window.localStorage.setItem(SANDBOX_KEY, "1");
    else window.localStorage.removeItem(SANDBOX_KEY);
  } catch {
    /* ignore */
  }
  window.location.assign(path);
}
