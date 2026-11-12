// Chain names as 1Click uses them, with display names and refund-address rules.
import { NearAccountId } from "@doorstep/shared";

export type ChainFamily = "evm" | "near" | "other";

interface ChainInfo {
  name: string;
  family: ChainFamily;
  /** Accent for the chain badge (letter avatar background). */
  color: string;
  /** Validates an origin-chain address (for 1Click refunds). */
  address?: RegExp;
  placeholder?: string;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const CHAINS: Record<string, ChainInfo> = {
  eth: { name: "Ethereum", family: "evm", color: "#627EEA", address: EVM_ADDRESS },
  base: { name: "Base", family: "evm", color: "#0052FF", address: EVM_ADDRESS },
  arb: { name: "Arbitrum", family: "evm", color: "#28A0F0", address: EVM_ADDRESS },
  op: { name: "Optimism", family: "evm", color: "#FF0420", address: EVM_ADDRESS },
  pol: { name: "Polygon", family: "evm", color: "#8247E5", address: EVM_ADDRESS },
  bsc: { name: "BNB Chain", family: "evm", color: "#F0B90B", address: EVM_ADDRESS },
  avax: { name: "Avalanche", family: "evm", color: "#E84142", address: EVM_ADDRESS },
  gnosis: { name: "Gnosis", family: "evm", color: "#04795B", address: EVM_ADDRESS },
  bera: { name: "Berachain", family: "evm", color: "#814625", address: EVM_ADDRESS },
  near: { name: "NEAR", family: "near", color: "#00C08B" },
  sol: { name: "Solana", family: "other", color: "#9945FF", address: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, placeholder: "Your Solana address" },
  btc: { name: "Bitcoin", family: "other", color: "#F7931A", address: /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/, placeholder: "bc1… or 1… / 3…" },
  tron: { name: "Tron", family: "other", color: "#EB0029", address: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, placeholder: "T…" },
  doge: { name: "Dogecoin", family: "other", color: "#C2A633", address: /^[DA9][1-9A-HJ-NP-Za-km-z]{25,34}$/, placeholder: "D…" },
  xrp: { name: "XRP Ledger", family: "other", color: "#23292F", address: /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/, placeholder: "r…" },
  zec: { name: "Zcash", family: "other", color: "#F4B728", address: /^t[13][1-9A-HJ-NP-Za-km-z]{33}$/, placeholder: "t1…" },
  ton: { name: "TON", family: "other", color: "#0098EA", address: /^[A-Za-z0-9_-]{48}$/, placeholder: "UQ… or EQ…" },
  sui: { name: "Sui", family: "other", color: "#4DA2FF", address: /^0x[0-9a-fA-F]{64}$/, placeholder: "0x… (64 hex)" },
  ltc: { name: "Litecoin", family: "other", color: "#345D9D", address: /^(ltc1[02-9ac-hj-np-z]{11,71}|[LM3][1-9A-HJ-NP-Za-km-z]{25,34})$/, placeholder: "ltc1… or L…" },
  stellar: { name: "Stellar", family: "other", color: "#7D00FF", address: /^G[A-Z2-7]{55}$/, placeholder: "G…" },
};

export function chainInfo(chain: string): ChainInfo {
  return (
    CHAINS[chain.toLowerCase()] ?? {
      name: chain.length <= 4 ? chain.toUpperCase() : chain[0]!.toUpperCase() + chain.slice(1),
      family: "other",
      color: "#6B7684",
    }
  );
}

export const chainName = (chain: string) => chainInfo(chain).name;

/** What the buyer needs to enter so refunds can reach them. */
export interface RefundPlan {
  family: ChainFamily;
  /** Origin-chain address for 1Click (refundTo). */
  refundTo: string;
  /** NEAR account the escrow refunds to (refundAccount). */
  refundAccount: string;
}

/** Returns an error message, or null when the origin address is valid. */
export function validateOriginAddress(chain: string, value: string): string | null {
  const v = value.trim();
  const info = chainInfo(chain);
  if (!v) return info.family === "near" ? "Enter your NEAR account" : `Enter your ${info.name} address`;
  if (info.family === "near") {
    return validateNearAccount(v);
  }
  if (info.address && !info.address.test(v)) return `That doesn't look like a ${info.name} address`;
  if (!info.address && (v.length < 10 || v.length > 120)) return `That doesn't look like a ${info.name} address`;
  return null;
}

/** NEAR account for escrow refunds. Accepts named accounts and 0x EVM addresses (eth-implicit accounts). */
export function validateNearAccount(value: string): string | null {
  const v = value.trim();
  if (!v) return "Enter a NEAR account";
  if (EVM_ADDRESS.test(v)) return null;
  if (/^[0-9a-f]{64}$/.test(v)) return null;
  if (!NearAccountId.safeParse(v.toLowerCase()).success) return "Enter a NEAR account like yourname.near, or a 0x address";
  if (!/\.(near|tg|testnet)$/.test(v.toLowerCase()) && !v.includes(".")) return "Enter a full account like yourname.near";
  return null;
}

export function normaliseNearAccount(value: string): string {
  return value.trim().toLowerCase();
}

/** Builds the refund pair from the form values. Assumes they validated. */
export function refundPlan(chain: string, originAddress: string, nearAccount: string): RefundPlan {
  const info = chainInfo(chain);
  const origin = originAddress.trim();
  if (info.family === "evm") return { family: "evm", refundTo: origin, refundAccount: origin.toLowerCase() };
  if (info.family === "near") return { family: "near", refundTo: normaliseNearAccount(origin), refundAccount: normaliseNearAccount(origin) };
  return { family: "other", refundTo: origin, refundAccount: normaliseNearAccount(nearAccount) };
}

// Well-formed public example addresses, used only for price previews (dry
// quotes) before the buyer has typed their own refund address.
const SAMPLE_ADDRESS: Record<string, string> = {
  near: "doorstep.near",
  sol: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  btc: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
  tron: "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7",
  doge: "DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L",
  xrp: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
  ton: "EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N",
  sui: "0x0000000000000000000000000000000000000000000000000000000000000002",
  stellar: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7",
};

/** The buyer's address if it's valid, else a well-formed example for this chain. */
export function previewRefundTo(chain: string, typed: string): string {
  if (typed && !validateOriginAddress(chain, typed)) return chainInfo(chain).family === "near" ? normaliseNearAccount(typed) : typed.trim();
  if (chainInfo(chain).family === "evm") return "0x8ba1f109551bD432803012645Ac136ddd64DBA72";
  return SAMPLE_ADDRESS[chain] ?? "0x8ba1f109551bD432803012645Ac136ddd64DBA72";
}
