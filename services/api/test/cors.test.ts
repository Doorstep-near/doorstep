import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config";
import { makeLive } from "./helpers";

const allowOrigin = async (t: Awaited<ReturnType<typeof makeLive>>, origin: string) =>
  (await t.app.inject({ method: "GET", url: "/config", headers: { origin } })).headers["access-control-allow-origin"];

describe("CORS", () => {
  it("allows WEB_URL and every CORS_ORIGINS entry, and nothing else", async () => {
    const t = await makeLive({ config: { webUrl: "https://doorstep-near.vercel.app", corsOrigins: ["https://doorstep-near.onrender.com"] } });
    expect(await allowOrigin(t, "https://doorstep-near.vercel.app")).toBe("https://doorstep-near.vercel.app");
    expect(await allowOrigin(t, "https://doorstep-near.onrender.com")).toBe("https://doorstep-near.onrender.com");
    expect(await allowOrigin(t, "https://evil.example")).toBeUndefined();
    expect(await allowOrigin(t, "http://localhost:5173")).toBeUndefined();
  });

  it("parses CORS_ORIGINS as a comma-separated list without trailing slashes", () => {
    expect(readConfig({ CORS_ORIGINS: " https://a.example/ , https://b.example,," }).corsOrigins).toEqual(["https://a.example", "https://b.example"]);
    expect(readConfig({}).corsOrigins).toEqual([]);
  });
});
