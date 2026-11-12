// Borzo (India) Business API client.
// Docs: https://borzodelivery.com/in/business-api/doc
import { createHmac, timingSafeEqual } from "node:crypto";
import type { CourierStage } from "@doorstep/shared";
import { AppError } from "../errors";

export interface BorzoPoint {
  address: string;
  contact_person: { phone: string; name?: string | null };
  note?: string | null;
  client_order_id?: string | null;
  tracking_url?: string | null;
  delivery?: { status?: string | null } | null;
}

export interface BorzoOrder {
  order_id: number;
  status: string;
  payment_amount?: string | null;
  points?: BorzoPoint[];
  courier?: { name?: string | null; surname?: string | null; phone?: string | null } | null;
}

export interface BorzoOrderRequest {
  matter: string;
  vehicle_type_id?: number;
  points: BorzoPoint[];
}

export interface Borzo {
  calculate(req: BorzoOrderRequest): Promise<BorzoOrder>;
  create(req: BorzoOrderRequest): Promise<BorzoOrder>;
  getOrder(borzoOrderId: string): Promise<BorzoOrder | null>;
}

/**
 * X-DV-Signature check, as specified in Borzo's docs ("Notification about
 * order changes" / "Notification about delivery changes", including their PHP
 * example): the header is hash_hmac('sha256', <raw request body>,
 * CALLBACK_SECRET_KEY), i.e. lowercase hex HMAC-SHA256 of the exact body bytes,
 * keyed with the Callback Secret Key from the Borzo personal cabinet.
 * https://borzodelivery.com/in/business-api/doc
 */
export function verifyBorzoSignature(rawBody: string | Buffer, header: string | undefined, secret: string): boolean {
  if (!secret || !header) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const got = header.trim().toLowerCase();
  if (got.length !== expected.length || !/^[0-9a-f]+$/.test(got)) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/** The drop point is the last point; its delivery status is what proves delivery. */
export function dropPoint(o: BorzoOrder): BorzoPoint | undefined {
  return o.points?.[o.points.length - 1];
}

export function deliveryStatus(o: BorzoOrder): string | null {
  return dropPoint(o)?.delivery?.status ?? null;
}

/** Normalises Borzo's delivery status (falls back to the order status) to our courier stage. */
export function borzoStage(o: BorzoOrder): CourierStage {
  const s = deliveryStatus(o) ?? o.status;
  if (s === "finished" || s === "reattempt_finished" || s === "completed") return "delivered";
  if (s === "canceled" || s === "deleted" || s === "invalid") return "canceled";
  if (s.startsWith("return_")) return "failed";
  if (["parcel_picked_up", "courier_arrived", "active", "reattempt_courier_picked_up"].includes(s)) return "picked_up";
  return "booked";
}

export class LiveBorzo implements Borzo {
  constructor(
    private baseUrl: string,
    private authToken: string,
    private fetchFn: typeof fetch = fetch,
  ) {}

  private async request<T>(path: string, body?: unknown): Promise<T> {
    if (!this.authToken) throw new AppError("courier_error", "Borzo is not configured (set BORZO_AUTH_TOKEN)");
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json", "X-DV-Auth-Token": this.authToken },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new AppError("courier_error", `Borzo unreachable: ${(e as Error).message}`);
    }
    const data = (await res.json().catch(() => ({}))) as { is_successful?: boolean; errors?: string[]; parameter_errors?: unknown } & T;
    if (!res.ok || data.is_successful === false) {
      const why = [...(data.errors ?? []), data.parameter_errors ? JSON.stringify(data.parameter_errors).slice(0, 200) : ""].filter(Boolean).join("; ");
      throw new AppError("courier_error", `Borzo ${path.split("?")[0]} failed (HTTP ${res.status})${why ? `: ${why}` : ""}`);
    }
    return data;
  }

  async calculate(req: BorzoOrderRequest) {
    return (await this.request<{ order: BorzoOrder }>("/calculate-order", req)).order;
  }
  async create(req: BorzoOrderRequest) {
    return (await this.request<{ order: BorzoOrder }>("/create-order", req)).order;
  }
  async getOrder(borzoOrderId: string) {
    const r = await this.request<{ orders?: BorzoOrder[] }>(`/orders?order_id=${encodeURIComponent(borzoOrderId)}`);
    return r.orders?.find((o) => String(o.order_id) === String(borzoOrderId)) ?? null;
  }
}
