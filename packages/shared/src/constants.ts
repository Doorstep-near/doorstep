/** Native USDC on NEAR (6 decimals). The only token the escrow accepts. */
export const USDC_NEAR = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
/** The same token as NEAR Intents / 1Click name it. */
export const USDC_NEAR_ASSET = `nep141:${USDC_NEAR}`;
export const USDC_DECIMALS = 6;

/** Where payouts and refunds are credited (the escrow's default `intents` account). */
export const INTENTS_CONTRACT = "intents.near";
/** Where a seller (or refunded buyer) withdraws from NEAR Intents to any chain. */
export const INTENTS_APP_URL = "https://app.near-intents.org";
export const EXPLORER_TX_URL = "https://nearblocks.io/txns/";

/**
 * Demo mode and the in-browser sandbox hand out deposit addresses that start with this.
 * The hyphens make them invalid on every chain, so no wallet or exchange can send real
 * money to one by mistake.
 */
export const DEMO_DEPOSIT_PREFIX = "DEMO-NOT-REAL-";
export const isDemoDepositAddress = (address: string | null | undefined): boolean => !!address?.startsWith(DEMO_DEPOSIT_PREFIX);

/** Default ports used by `npm run demo`. */
export const API_PORT = 8787;
export const WEB_PORT = 5173;
