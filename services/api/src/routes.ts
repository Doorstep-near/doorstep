import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  CreateOrderRequest,
  DepositSubmitRequest,
  INTENTS_APP_URL,
  OrderStatus,
  OtpRevealRequest,
  OtpVerifyRequest,
  PublicOrderId,
  QuoteRequest,
  RegisterBuyerRequest,
  ShipQuoteRequest,
  ShipRequest,
  SignatureRequest,
  type AppConfig,
  type SellerMe,
} from "@doorstep/shared";
import { verifyBorzoSignature } from "./borzo/client";
import { allMerchants, type Merchant } from "./config";
import type { Demo } from "./demo";
import { AppError, errorBody, fail, parseBody } from "./errors";
import type { Deps, OrderService } from "./service";

const sha = (s: string) => createHash("sha256").update(s).digest();
/** Constant-time string compare (hashing first equalises lengths). */
export const safeEqual = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

function orderId(req: FastifyRequest): string {
  const id = (req.params as { id?: string }).id ?? "";
  if (!PublicOrderId.safeParse(id).success) fail("not_found", "No such order");
  return id;
}

export function registerRoutes(app: FastifyInstance, svc: OrderService, d: Deps, demo: Demo | null) {
  const { config } = d;

  // ------------------------------------------------------------------ meta

  app.get("/health", async () => ({ ok: true }));

  app.get("/config", async (): Promise<AppConfig> => ({
    network: config.network,
    escrow: d.escrow.account,
    demoMode: config.demoMode,
    shopName: config.shopName,
    complaintWindowMs: svc.windowMs,
    inrPerUsd: config.inrPerUsd,
    explorerTxUrl: config.explorerTxUrl,
    intentsAppUrl: INTENTS_APP_URL,
    webUrl: config.webUrl,
  }));

  app.get("/tokens", async () => ({ tokens: await svc.tokens() }));
  app.get("/stats", async () => svc.stats());

  // ---------------------------------------------------------------- seller

  app.register(async (seller) => {
    // Each shop has its own seller token; it only ever sees and changes its own orders.
    seller.addHook("onRequest", async (req) => {
      const h = req.headers.authorization ?? "";
      const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
      let found: Merchant | undefined;
      // Compare against every shop (no early exit), so timing doesn't reveal which tokens exist.
      for (const m of allMerchants(config)) if (token && safeEqual(token, m.token) && !found) found = m;
      if (!found) throw new AppError("unauthorized", "Seller token missing or wrong");
      req.merchant = found;
    });
    const me = (req: FastifyRequest): Merchant => req.merchant!;

    seller.get("/seller/me", async (req): Promise<SellerMe> => ({ id: me(req).id, name: me(req).name, account: me(req).account }));

    seller.post("/seller/orders", async (req, reply) => {
      const order = svc.createOrder(parseBody(CreateOrderRequest, req.body), me(req));
      return reply.status(201).send(order);
    });

    seller.get("/seller/orders", async (req) => {
      const raw = (req.query as { status?: string }).status;
      const statuses = raw
        ? raw.split(",").map((s) => {
            const r = OrderStatus.safeParse(s.trim());
            return r.success ? r.data : fail("invalid_input", `Unknown status "${s}"`);
          })
        : undefined;
      return { orders: await svc.list(statuses, me(req)) };
    });

    seller.get("/seller/summary", async (req) => svc.summary(me(req)));
    seller.get("/seller/orders/:id", async (req) => svc.getForSeller(orderId(req), me(req)));

    seller.post("/seller/orders/:id/ship/quote", async (req) => {
      svc.mustOwn(orderId(req), me(req));
      parseBody(ShipQuoteRequest, req.body);
      return svc.shipQuote(orderId(req));
    });

    seller.post("/seller/orders/:id/ship", async (req) => {
      svc.mustOwn(orderId(req), me(req));
      return svc.ship(orderId(req), parseBody(ShipRequest, req.body));
    });

    seller.post("/seller/orders/:id/otp/verify", async (req) => {
      svc.mustOwn(orderId(req), me(req));
      return svc.verifyOtp(orderId(req), parseBody(OtpVerifyRequest, req.body).code);
    });
  });

  // ----------------------------------------------------------------- buyer

  app.get("/orders/:id", async (req) => svc.getPublic(orderId(req)));
  app.post("/orders/:id/buyer", async (req) => svc.registerBuyer(orderId(req), parseBody(RegisterBuyerRequest, req.body)));
  app.post("/orders/:id/quote", async (req) => svc.quote(orderId(req), parseBody(QuoteRequest, req.body)));
  app.post("/orders/:id/deposit", async (req) => svc.submitDeposit(orderId(req), parseBody(DepositSubmitRequest, req.body)));
  app.post("/orders/:id/confirm", async (req) => svc.confirm(orderId(req), parseBody(SignatureRequest, req.body).signature));
  app.post("/orders/:id/complaint", async (req) => svc.complaint(orderId(req), parseBody(SignatureRequest, req.body).signature));
  app.post("/orders/:id/otp", async (req) => svc.revealOtp(orderId(req), parseBody(OtpRevealRequest, req.body)));

  // -------------------------------------------------------------- webhooks

  app.post("/webhooks/borzo", async (req, reply) => {
    const sig = req.headers["x-dv-signature"];
    if (!config.borzoCallbackSecret) {
      req.log.warn("Borzo callback received but BORZO_CALLBACK_SECRET is not set");
      return reply.status(401).send(errorBody("unauthorized", "Borzo callbacks are not configured"));
    }
    if (!verifyBorzoSignature(req.rawBody ?? "", typeof sig === "string" ? sig : undefined, config.borzoCallbackSecret)) {
      return reply.status(401).send(errorBody("unauthorized", "Bad X-DV-Signature"));
    }
    const body = (req.body ?? {}) as { order?: { order_id?: unknown }; delivery?: { order_id?: unknown } };
    const borzoId = body.order?.order_id ?? body.delivery?.order_id;
    if (borzoId == null) return { ok: true };
    // Never trust the callback body for the decision: re-fetch the order from Borzo.
    const r = await svc.handleBorzoUpdate(String(borzoId));
    return { ok: true, ...r };
  });

  app.post("/webhooks/ship24", async (req, reply) => {
    const h = req.headers.authorization ?? "";
    const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
    if (!config.ship24WebhookSecret || !token || !safeEqual(token, config.ship24WebhookSecret)) {
      return reply.status(401).send(errorBody("unauthorized", "Bad Ship24 secret"));
    }
    const body = (req.body ?? {}) as { trackings?: { tracker?: { trackingNumber?: string }; shipment?: { statusMilestone?: string } }[] };
    let confirmed = 0;
    for (const t of body.trackings ?? []) {
      if (t.shipment?.statusMilestone !== "delivered" || !t.tracker?.trackingNumber) continue;
      confirmed += await svc.handleTrackingDelivered(t.tracker.trackingNumber);
    }
    return { ok: true, confirmed };
  });

  // ------------------------------------------------------------------ demo

  if (demo) app.post("/demo/orders/:id/advance", async (req) => demo.advance(orderId(req)));
}
