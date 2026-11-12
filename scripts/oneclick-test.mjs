#!/usr/bin/env node
// Thursday go/no-go test: pay a real Doorstep order through 1Click with
// customRecipientMsg, and check the escrow marks it Funded.
//
// 1. Preview (no money moves):
//      node scripts/oneclick-test.mjs --escrow escrow.you.near --order 1 --from base:USDC --refund-to 0xYourBaseAddress
// 2. Real run: add --go, send exactly the amount shown to the deposit address
//    from your wallet, and leave the script running; it watches until done.
// 3. If you closed it, resume watching (add --tx-hash <your deposit tx> to speed it up):
//      node scripts/oneclick-test.mjs --escrow escrow.you.near --order 1 --watch <depositAddress>
//
// Auth: set ONECLICK_API_KEY (sent as X-API-Key) or ONECLICK_JWT (sent as a
// Bearer token). Without either, 1Click charges an extra 0.1%.
//
// Safety: it refuses to request a deposit address unless the order exists and
// is unpaid, and the escrow is registered with the USDC contract. 1Click warns
// that funds sent with customRecipientMsg are lost if the recipient can't take
// them, so those two checks matter.
import { mkdirSync, writeFileSync } from "node:fs";
import { viewCall, USDC_NEAR, USDC_NEAR_ASSET, DEFAULT_RPC, parseArgs } from "./lib/near.mjs";

const ONECLICK = process.env.ONECLICK_URL || "https://1click.chaindefuser.com";
const args = parseArgs(process.argv.slice(2));

function need(name) {
  if (!args[name] || args[name] === true) fail(`Missing --${name}`);
  return args[name];
}

function fail(msg) {
  console.error(`\nNO-GO: ${msg}\n`);
  process.exit(1);
}

function authHeaders() {
  if (process.env.ONECLICK_API_KEY) return { "X-API-Key": process.env.ONECLICK_API_KEY };
  if (process.env.ONECLICK_JWT) return { Authorization: `Bearer ${process.env.ONECLICK_JWT}` };
  console.warn("Note: no ONECLICK_API_KEY or ONECLICK_JWT set; 1Click adds a 0.1% fee.");
  return {};
}

async function oneclick(path, init = {}) {
  const res = await fetch(`${ONECLICK}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...authHeaders(), ...(init.headers || {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`1Click ${path} -> HTTP ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nearblocks = (h) => `https://nearblocks.io/txns/${h}`;

async function checkOrder(escrow, orderId) {
  const order = await viewCall(escrow, "get_order", { order_id: String(orderId) });
  if (!order) fail(`Order ${orderId} does not exist on ${escrow}. Create it first (see scripts/README.md).`);
  return order;
}

async function watch(escrow, orderId, depositAddress, depositMemo) {
  console.log(`\nWatching 1Click status for ${depositAddress} (Ctrl+C to stop; resume with --watch).`);
  let last = "";
  const started = Date.now();
  while (Date.now() - started < 60 * 60 * 1000) {
    const q = new URLSearchParams({ depositAddress });
    if (depositMemo) q.set("depositMemo", depositMemo);
    let st;
    try {
      st = await oneclick(`/v0/status?${q}`);
    } catch (e) {
      console.warn(`  status check failed, retrying: ${e.message}`);
      await sleep(5000);
      continue;
    }
    if (st.status !== last) {
      last = st.status;
      console.log(`  ${new Date().toISOString()}  ${st.status}`);
    }
    const d = st.swapDetails || {};
    if (st.status === "SUCCESS") {
      (d.nearTxHashes || []).forEach((h) => console.log(`  NEAR tx: ${nearblocks(h)}`));
      (d.destinationChainTxHashes || []).forEach((t) => console.log(`  destination tx: ${t.explorerUrl || t.hash || JSON.stringify(t)}`));
      break;
    }
    if (["REFUNDED", "FAILED", "INCOMPLETE_DEPOSIT"].includes(st.status)) {
      console.log(JSON.stringify(d, null, 2));
      fail(`1Click ended with ${st.status}. Your funds go back to refundTo; check the details above.`);
    }
    await sleep(5000);
  }

  // 1Click says delivered. Did the escrow accept it for this order?
  for (let i = 0; i < 12; i++) {
    const order = await checkOrder(escrow, orderId);
    if (order.status === "Funded") {
      console.log(`\nGO: order ${orderId} is Funded with ${order.paid} USDC units. customRecipientMsg works end to end.\n`);
      return;
    }
    await sleep(5000);
  }
  const parked = await viewCall(escrow, "get_unmatched", {});
  const mine = parked.filter((p) => p.order_id === String(orderId) || p.msg === String(orderId));
  if (mine.length) {
    console.log(JSON.stringify(mine, null, 2));
    fail("The money reached the escrow but was parked as unmatched (see reason above). It is safe; the owner can refund it with refund_unmatched.");
  }
  fail("1Click reports SUCCESS but the order is not Funded and nothing is parked. Check the NEAR tx above: msg may not have been passed. Use the collector fallback.");
}

async function main() {
  const escrow = need("escrow");
  const orderId = need("order");
  console.log(`Escrow ${escrow}, order ${orderId}, RPC ${DEFAULT_RPC}`);

  if (args.watch) {
    // Optional: tell 1Click about your deposit tx to speed things up.
    if (args["tx-hash"] && args["tx-hash"] !== true) {
      await oneclick("/v0/deposit/submit", { method: "POST", body: JSON.stringify({ txHash: args["tx-hash"], depositAddress: args.watch }) });
    }
    return watch(escrow, orderId, args.watch, args.memo === true ? undefined : args.memo);
  }

  const order = await checkOrder(escrow, orderId);
  if (order.status !== "Created") fail(`Order ${orderId} is ${order.status}, not Created. Make a fresh order.`);
  if (Number(order.deadline_ms) < Date.now() + 40 * 60 * 1000) fail("Order deadline is under 40 minutes away. Make a fresh order.");
  console.log(`Order OK: price ${order.price} units (${Number(order.price) / 1e6} USDC), seller ${order.seller}`);

  const storage = await viewCall(USDC_NEAR, "storage_balance_of", { account_id: escrow });
  if (!storage) fail(`${escrow} is not registered with the USDC contract. Run the storage_deposit step in scripts/README.md first.`);
  console.log("Escrow is registered with USDC.");

  const [chain, symbol] = need("from").split(":");
  const tokens = await oneclick("/v0/tokens");
  const origin = tokens.find((t) => t.blockchain?.toLowerCase() === chain.toLowerCase() && t.symbol?.toLowerCase() === symbol?.toLowerCase());
  if (!origin) {
    const chains = tokens.filter((t) => t.symbol?.toLowerCase() === symbol?.toLowerCase()).map((t) => t.blockchain);
    fail(`No ${symbol} on "${chain}" in 1Click's token list. ${symbol} is available on: ${[...new Set(chains)].join(", ")}`);
  }
  if (!tokens.some((t) => t.assetId === USDC_NEAR_ASSET)) fail("USDC on NEAR is missing from 1Click's token list.");
  console.log(`Paying from ${origin.symbol} on ${origin.blockchain} (${origin.assetId})`);

  const go = args.go === true;
  const request = {
    dry: !go,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: Number(args.slippage || 100),
    originAsset: origin.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: USDC_NEAR_ASSET,
    amount: order.price,
    refundTo: need("refund-to"),
    refundType: "ORIGIN_CHAIN",
    recipient: escrow,
    recipientType: "DESTINATION_CHAIN",
    customRecipientMsg: String(orderId),
    deadline: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    referral: "doorstep",
  };
  const res = await oneclick("/v0/quote", { method: "POST", body: JSON.stringify(request) });
  const q = res.quote || {};
  console.log(`\nQuote: send ${q.amountInFormatted} ${origin.symbol} (${q.amountIn} units; min ${q.minAmountIn}), escrow receives ${q.amountOutFormatted} USDC. ETA ${q.timeEstimate}s.`);

  if (!go) {
    console.log("\nPreview only. Re-run with --go to get a deposit address.\n");
    return;
  }

  mkdirSync(".runs", { recursive: true });
  const file = `.runs/quote-order${orderId}-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(res, null, 2));
  console.log(`\nSaved the signed quote to ${file} (keep it in case of a dispute).`);
  console.log(`\n  Send exactly ${q.amountInFormatted} ${origin.symbol} on ${origin.blockchain} to:\n\n    ${q.depositAddress}${q.depositMemo ? `\n    memo: ${q.depositMemo}` : ""}\n\n  before ${q.deadline}.`);
  await watch(escrow, orderId, q.depositAddress, q.depositMemo);
}

main().catch((e) => fail(e.message));
