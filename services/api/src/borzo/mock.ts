// Demo mode courier: behaves like Borzo's API, with Borzo's raw statuses.
import type { Borzo, BorzoOrder, BorzoOrderRequest } from "./client";

export class MockBorzo implements Borzo {
  private orders = new Map<string, BorzoOrder>();
  private nextId = 1250032;

  private price(req: BorzoOrderRequest) {
    return (60 + Math.min(4, req.points.length) * 15).toFixed(2);
  }

  async calculate(req: BorzoOrderRequest): Promise<BorzoOrder> {
    return { order_id: 0, status: "new", payment_amount: this.price(req), points: req.points };
  }

  async create(req: BorzoOrderRequest): Promise<BorzoOrder> {
    const id = this.nextId++;
    const order: BorzoOrder = {
      order_id: id,
      status: "available",
      payment_amount: this.price(req),
      points: req.points.map((p, i) => ({
        ...p,
        tracking_url: i === req.points.length - 1 ? `https://borzodelivery.com/in/track/demo-${id}` : null,
        delivery: { status: "planned" },
      })),
      courier: null,
    };
    this.orders.set(String(id), order);
    return structuredClone(order);
  }

  async getOrder(id: string) {
    const o = this.orders.get(id);
    return o ? structuredClone(o) : null;
  }

  /** Demo: move the parcel along ("parcel_picked_up", "finished", ...). */
  setStatus(id: string, deliveryStatus: string) {
    const o = this.orders.get(id);
    if (!o) return;
    const drop = o.points?.[o.points.length - 1];
    if (drop) drop.delivery = { status: deliveryStatus };
    o.status = deliveryStatus === "finished" ? "completed" : "active";
    o.courier ??= { name: "Ravi", surname: "Kumar", phone: "918880000001" };
  }
}
