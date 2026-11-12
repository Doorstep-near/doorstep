// Demo mode: seed data and the one-step "advance" button. No network at all.
import type { Order } from "@doorstep/shared";
import { messages } from "@doorstep/shared";
import type { MockBorzo } from "./borzo/mock";
import type { Db } from "./db";
import { newSigner } from "./ed25519";
import { fail } from "./errors";
import type { FakeEscrow } from "./near/fake-escrow";
import type { FakeOneClick } from "./oneclick/fake";
import { MIN, type OrderService } from "./service";

export interface DemoKit {
  escrow: FakeEscrow;
  oneclick: FakeOneClick;
  borzo: MockBorzo;
}

const DEMO_PAY_ASSET = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near"; // USDC on Base
const DEMO_REFUND_TO = "0x8ba1f109551bd432803012645ac136ddd64dba72";
const DEMO_REFUND_ACCOUNT = "0x8ba1f109551bd432803012645ac136ddd64dba72";

export class Demo {
  constructor(
    private svc: OrderService,
    private kit: DemoKit,
    private db: Db,
    private now: () => number,
  ) {}

  /** Moves an order one step: Draft -> Created (with a real quote) -> Funded -> Shipped (booked) -> picked up -> Delivered (checker) -> Released. */
  async advance(id: string): Promise<Order> {
    let row = await this.svc.syncChain(this.svc.must(id), true);
    switch (row.status) {
      case "Draft": {
        if (!row.buyerPk) await this.svc.registerBuyer(id, { buyerPk: newSigner().publicKey, refundAccount: DEMO_REFUND_ACCOUNT });
        else await this.svc.registerBuyer(id, { buyerPk: row.buyerPk, refundAccount: row.buyerRefund ?? DEMO_REFUND_ACCOUNT });
        await this.svc.quote(id, { originAsset: DEMO_PAY_ASSET, refundTo: DEMO_REFUND_TO, dry: false });
        break;
      }
      case "Created": {
        const db = this.db;
        if (!db.latestPayment(id)) await this.svc.quote(id, { originAsset: DEMO_PAY_ASSET, refundTo: DEMO_REFUND_TO, dry: false });
        const p = db.latestPayment(id)!;
        this.kit.oneclick.settleNow(p.depositAddress);
        await this.svc.pollPayment(db.latestPayment(id)!);
        break;
      }
      case "Funded": {
        if (row.deliveryMethod === "borzo" && row.deliveryAddress) await this.svc.ship(id, { method: "borzo" });
        else if (row.deliveryMethod === "tracking") await this.svc.ship(id, { method: "tracking", carrier: "indiapost", trackingNumber: "EE123456789IN" });
        else await this.svc.ship(id, { method: "hand" });
        break;
      }
      case "Shipped": {
        const pickedUp = row.courierStage === "picked_up";
        if (row.borzoOrderId) {
          this.kit.borzo.setStatus(row.borzoOrderId, pickedUp ? "finished" : "parcel_picked_up");
          await this.svc.handleBorzoUpdate(row.borzoOrderId); // the same path a signed Borzo webhook takes
        } else if (!pickedUp) {
          this.db.updateOrder(id, { courierStage: "picked_up", courierRaw: null, courierUpdatedAt: this.now() });
        } else {
          await this.svc.checkerConfirm(row, row.courierRef ?? "code");
        }
        break;
      }
      case "Delivered": {
        this.kit.escrow.fastForwardWindow(row.chainOrderId!);
        row = await this.svc.syncChain(row, true);
        await this.svc.releaseNow(row);
        break;
      }
      case "Disputed":
        fail("invalid_state", "Disputed orders are decided by the escrow owner");
        break;
      default:
        fail("invalid_state", `Order is ${row.status} (final)`);
    }
    return this.svc.view(this.svc.must(id));
  }

  /** A demo shop with a few orders in different states. */
  async seed() {
    const deliverBy = () => new Date(this.now() + 2 * 24 * 60 * MIN).toISOString();

    this.svc.createOrder({
      item: "Roasted makhana, 500 g",
      note: "Peri-peri flavour",
      priceUnits: "2000000",
      buyerPhone: "+91 98765 43210",
      deliveryMethod: "hand",
      deliveryArea: "Noida",
      deliverBy: deliverBy(),
    });

    const pickle = this.svc.createOrder({
      item: "Mango pickle, 1 kg jar",
      priceUnits: "6500000",
      buyerPhone: "+91 99110 22334",
      deliveryMethod: "borzo",
      deliveryAddress: "B-42, Sector 50, Noida, Uttar Pradesh 201301",
      deliveryArea: "Noida",
      deliverBy: deliverBy(),
    });
    await this.advance(pickle.id); // Created + quote
    await this.advance(pickle.id); // Funded

    const ghee = this.svc.createOrder({
      item: "A2 desi ghee, 1 L",
      priceUnits: "12000000",
      buyerPhone: "+91 98111 45678",
      deliveryMethod: "tracking",
      deliveryArea: "Gurugram",
      deliveryAddress: "Tower 3, DLF Phase 2, Gurugram",
      deliverBy: deliverBy(),
    });
    const buyer = newSigner();
    await this.svc.registerBuyer(ghee.id, { buyerPk: buyer.publicKey, refundAccount: DEMO_REFUND_ACCOUNT });
    await this.advance(ghee.id); // Funded (quote + pay)
    await this.advance(ghee.id); // Shipped with a tracking number
    const chainId = this.svc.must(ghee.id).chainOrderId!;
    await this.svc.confirm(ghee.id, buyer.sign(messages.delivered(chainId, this.kit.escrow.account))); // buyer's own proof
    await this.advance(ghee.id); // Released
  }
}
