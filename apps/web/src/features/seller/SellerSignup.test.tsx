import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, api, sellerToken } from "../../lib/api";
import { renderRoute } from "../../test/utils";
import SellerLogin from "./SellerLogin";
import SellerSignup from "./SellerSignup";

const signChallenge = vi.fn();
vi.mock("../../lib/nearWallet", async (orig) => ({ ...(await orig<typeof import("../../lib/nearWallet")>()), signChallenge: (...a: unknown[]) => signChallenge(...a) }));

const CHALLENGE = { nonce: Buffer.alloc(32, 3).toString("base64"), message: "Sign in to Doorstep as a seller.", recipient: "Doorstep", expiresAt: new Date(Date.now() + 300_000).toISOString() };
const SIG = { accountId: "chai-corner.near", publicKey: "ed25519:8hSHprDq2StXwMtNd43wDTXQYsjXcD4MJTXQYsjXcD4M", signature: "c2lnbmF0dXJl".repeat(8) };
const SESSION = { token: "session-token-abc", created: true, shop: { id: "w-1", name: "Chai Corner", account: "chai-corner.near", beta: true, maxPriceUnits: "25000000" } };

beforeEach(() => {
  sellerToken.clear();
  signChallenge.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("Start selling (NEAR wallet sign-up)", () => {
  it("asks for the shop name before opening the wallet", async () => {
    const user = userEvent.setup();
    const challenge = vi.spyOn(api.seller.auth, "challenge");
    renderRoute(<SellerSignup />, { path: "/seller/signup", url: "/seller/signup" });
    await user.click(screen.getByRole("button", { name: /Create shop with NEAR Mobile/ }));
    expect(await screen.findByText("Enter your shop's name")).toBeInTheDocument();
    expect(challenge).not.toHaveBeenCalled();
    expect(signChallenge).not.toHaveBeenCalled();
  });

  it("signs the challenge with NEAR Mobile, creates the shop and opens the dashboard", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.seller.auth, "challenge").mockResolvedValue(CHALLENGE);
    const near = vi.spyOn(api.seller.auth, "near").mockResolvedValue(SESSION);
    signChallenge.mockResolvedValue(SIG);
    renderRoute(<SellerSignup />, { path: "/seller/signup", url: "/seller/signup", extraRoutes: [{ path: "/seller", element: <p>dashboard</p> }] });

    await user.type(screen.getByLabelText("Shop name"), "Chai Corner");
    await user.type(screen.getByLabelText(/City or area/), "Jaipur");
    await user.click(screen.getByRole("button", { name: /Create shop with NEAR Mobile/ }));

    expect(await screen.findByText("dashboard")).toBeInTheDocument();
    expect(signChallenge).toHaveBeenCalledWith("near-mobile-wallet", CHALLENGE);
    expect(near).toHaveBeenCalledWith({ ...SIG, nonce: CHALLENGE.nonce, shop: { name: "Chai Corner", area: "Jaipur" } });
    expect(sellerToken.get()).toBe("session-token-abc");
  });

  it("shows the wallet's error and lets the seller try another wallet", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.seller.auth, "challenge").mockResolvedValue(CHALLENGE);
    signChallenge.mockRejectedValue(new Error("User rejected the request"));
    renderRoute(<SellerSignup />, { path: "/seller/signup", url: "/seller/signup" });
    await user.type(screen.getByLabelText("Shop name"), "Chai Corner");
    await user.click(screen.getByRole("button", { name: /Create shop with Meteor/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("User rejected the request");
    expect(screen.getByRole("button", { name: /Create shop with HOT/ })).toBeEnabled();
    expect(sellerToken.get()).toBeNull();
  });
});

describe("Seller sign-in with a NEAR wallet", () => {
  it("points an account without a shop to sign-up", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.seller.auth, "challenge").mockResolvedValue(CHALLENGE);
    vi.spyOn(api.seller.auth, "near").mockRejectedValue(new ApiRequestError(404, "not_found", "There's no shop for chai-corner.near yet."));
    signChallenge.mockResolvedValue(SIG);
    renderRoute(<SellerLogin />, { path: "/seller/login", url: "/seller/login" });
    await user.click(await screen.findByRole("button", { name: /Continue with NEAR Mobile/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("There's no shop for this NEAR account yet");
    expect(screen.getAllByRole("link", { name: "Create your shop" })[0]).toHaveAttribute("href", "/seller/signup");
  });

  it("signs an existing shop in and keeps the seller-token option", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.seller.auth, "challenge").mockResolvedValue(CHALLENGE);
    vi.spyOn(api.seller.auth, "near").mockResolvedValue({ ...SESSION, created: false });
    signChallenge.mockResolvedValue(SIG);
    renderRoute(<SellerLogin />, { path: "/seller/login", url: "/seller/login", extraRoutes: [{ path: "/seller", element: <p>dashboard</p> }] });
    expect(await screen.findByText(/or use a seller token/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Seller token")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /Continue with HOT/ }));
    expect(await screen.findByText("dashboard")).toBeInTheDocument();
    expect(sellerToken.get()).toBe("session-token-abc");
  });
});

describe("MetaMask sign-up", () => {
  afterEach(() => {
    delete (window as unknown as { ethereum?: unknown }).ethereum;
  });

  it("signs the challenge text with personal_sign and creates a shop paid to that 0x address", async () => {
    const user = userEvent.setup();
    const SIGNATURE = "0x" + "ab".repeat(65);
    const request = vi.fn(async ({ method }: { method: string; params?: string[] }) => {
      if (method === "eth_requestAccounts") return ["0x55F2000000000000000000000000000000000001"];
      if (method === "personal_sign") return SIGNATURE;
      throw new Error(`unexpected ${method}`);
    });
    (window as unknown as { ethereum?: unknown }).ethereum = { request };
    vi.spyOn(api.seller.auth, "challenge").mockResolvedValue(CHALLENGE);
    const evm = vi.spyOn(api.seller.auth, "evm").mockResolvedValue({ ...SESSION, shop: { ...SESSION.shop, account: "0x55f2000000000000000000000000000000000001" } });
    renderRoute(<SellerSignup />, { path: "/seller/signup", url: "/seller/signup", extraRoutes: [{ path: "/seller", element: <p>dashboard</p> }] });

    await user.type(screen.getByLabelText("Shop name"), "Spice Route");
    await user.click(screen.getByRole("button", { name: /Create shop with MetaMask/ }));

    expect(await screen.findByText("dashboard")).toBeInTheDocument();
    const signCall = request.mock.calls.find((c) => c[0].method === "personal_sign")![0];
    const text = new TextDecoder().decode(Uint8Array.from(signCall.params![0]!.slice(2).match(/../g)!.map((h) => parseInt(h, 16))));
    expect(text).toContain(`Challenge: ${CHALLENGE.nonce}`);
    expect(signCall.params![1]).toBe("0x55F2000000000000000000000000000000000001");
    expect(evm).toHaveBeenCalledWith({ address: "0x55F2000000000000000000000000000000000001", signature: SIGNATURE, nonce: CHALLENGE.nonce, shop: { name: "Spice Route" } });
    expect(sellerToken.get()).toBe("session-token-abc");
  });

  it("explains a cancel in MetaMask", async () => {
    const user = userEvent.setup();
    (window as unknown as { ethereum?: unknown }).ethereum = {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === "eth_requestAccounts") return ["0x55F2000000000000000000000000000000000001"];
        throw Object.assign(new Error("User rejected"), { code: 4001 });
      }),
    };
    vi.spyOn(api.seller.auth, "challenge").mockResolvedValue(CHALLENGE);
    renderRoute(<SellerSignup />, { path: "/seller/signup", url: "/seller/signup" });
    await user.type(screen.getByLabelText("Shop name"), "Spice Route");
    await user.click(screen.getByRole("button", { name: /Create shop with MetaMask/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You cancelled in your wallet");
  });

  it("says MetaMask isn't installed on a desktop without a wallet", () => {
    renderRoute(<SellerSignup />, { path: "/seller/signup", url: "/seller/signup" });
    expect(screen.getByRole("button", { name: "MetaMask (not installed)" })).toBeDisabled();
  });
});
