//! Doorstep escrow.
//!
//! Holds USDC for each order and moves it only when:
//! - delivery is proven (the buyer's own signature, or our checker's signature)
//!   and the complaint window has passed -> the seller is paid;
//! - nothing is proven by the deadline -> the buyer is refunded;
//! - the buyer complains inside the window -> the owner decides.
//!
//! Payouts go into NEAR Intents (`intents.near`) by default, so the seller and
//! the buyer can withdraw to any chain.

use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, ext_contract, log, near, require, AccountId, BorshStorageKey, CurveType, Gas, NearToken,
    PanicOnDefault, Promise, PromiseError, PromiseOrValue, PublicKey,
};

#[cfg(test)]
mod tests;

const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const GAS_FT_TRANSFER_CALL: Gas = Gas::from_tgas(50);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_ON_PAYOUT: Gas = Gas::from_tgas(15);
const MAX_REF_LEN: usize = 128;
const MAX_STORED_MSG_LEN: usize = 128;
const DEFAULT_INTENTS: &str = "intents.near";

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128>;
}

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Orders,
    SellerOrders,
    Unmatched,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    /// Order exists, no money yet.
    Created,
    /// The price in USDC arrived.
    Funded,
    /// The seller handed it to a courier (courier reference stored).
    Shipped,
    /// Delivery proven; the complaint window is running.
    Delivered,
    /// The buyer complained inside the window; the owner decides.
    Disputed,
    /// Paid out to the seller. Final.
    Released,
    /// Paid back to the buyer. Final.
    Refunded,
    /// Never paid before the deadline. Final.
    Expired,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Proof {
    /// The buyer signed "delivered" with the key their browser made.
    Buyer,
    /// Our checker signed after a courier update or a 6-digit code.
    Checker { courier_ref: String },
}

/// Where payouts go.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayoutMode {
    /// `ft_transfer_call` to NEAR Intents, crediting the recipient there.
    Intents,
    /// Plain `ft_transfer` to the recipient's NEAR account (fallback).
    Direct,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Order {
    pub id: U64,
    pub seller: AccountId,
    pub buyer_pk: PublicKey,
    pub buyer_refund: AccountId,
    pub price: U128,
    pub paid: U128,
    pub deadline_ms: U64,
    pub courier_ref: Option<String>,
    pub status: Status,
    pub proof: Option<Proof>,
    pub created_ms: U64,
    pub funded_ms: Option<U64>,
    pub delivered_ms: Option<U64>,
    pub closed_ms: Option<U64>,
}

/// A payment we kept but could not match to an order (or the extra above the
/// price). Never sent back automatically; the owner refunds it.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Unmatched {
    pub id: U64,
    pub from: AccountId,
    pub amount: U128,
    pub msg: String,
    pub order_id: Option<U64>,
    pub refund_to: Option<AccountId>,
    pub reason: String,
    pub at_ms: U64,
}

/// What a payout callback should repair if the transfer did not go through.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub enum PayoutTarget {
    Order {
        order_id: U64,
        to_seller: bool,
        revert_to: Status,
    },
    Unmatched {
        entry: Unmatched,
    },
}

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub relayer: AccountId,
    pub usdc: AccountId,
    pub intents: AccountId,
    pub checker_pk: PublicKey,
    pub complaint_window_ms: U64,
    pub payout_mode: PayoutMode,
    pub next_order_id: U64,
    pub unmatched_count: u32,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Escrow {
    owner: AccountId,
    relayer: AccountId,
    usdc: AccountId,
    intents: AccountId,
    checker_pk: PublicKey,
    complaint_window_ms: u64,
    payout_mode: PayoutMode,
    next_order_id: u64,
    next_unmatched_id: u64,
    orders: LookupMap<u64, Order>,
    seller_orders: LookupMap<AccountId, Vec<u64>>,
    unmatched: IterableMap<u64, Unmatched>,
}

#[near]
impl Escrow {
    #[init]
    pub fn new(
        owner: AccountId,
        relayer: AccountId,
        usdc: AccountId,
        checker_pk: PublicKey,
        complaint_window_ms: U64,
        intents: Option<AccountId>,
    ) -> Self {
        ed25519_bytes(&checker_pk);
        Self {
            owner,
            relayer,
            usdc,
            intents: intents.unwrap_or_else(|| DEFAULT_INTENTS.parse().unwrap()),
            checker_pk,
            complaint_window_ms: complaint_window_ms.0,
            payout_mode: PayoutMode::Intents,
            next_order_id: 1,
            next_unmatched_id: 1,
            orders: LookupMap::new(StorageKey::Orders),
            seller_orders: LookupMap::new(StorageKey::SellerOrders),
            unmatched: IterableMap::new(StorageKey::Unmatched),
        }
    }

    // ---------------------------------------------------------------- orders

    /// Relayer (or owner) creates an order. `buyer_pk` is the public half of
    /// the key pair the buyer's browser made; only it can sign "delivered" and
    /// "complaint" for this order.
    pub fn create_order(
        &mut self,
        seller: AccountId,
        price: U128,
        deadline_ms: U64,
        buyer_pk: PublicKey,
        buyer_refund: AccountId,
    ) -> U64 {
        self.assert_relayer_or_owner();
        require!(price.0 > 0, "Price must be above zero");
        let now = env::block_timestamp_ms();
        require!(deadline_ms.0 > now, "Deadline must be in the future");
        ed25519_bytes(&buyer_pk);

        let id = self.next_order_id;
        self.next_order_id += 1;
        let order = Order {
            id: U64(id),
            seller: seller.clone(),
            buyer_pk,
            buyer_refund,
            price,
            paid: U128(0),
            deadline_ms,
            courier_ref: None,
            status: Status::Created,
            proof: None,
            created_ms: U64(now),
            funded_ms: None,
            delivered_ms: None,
            closed_ms: None,
        };
        self.orders.insert(id, order);
        self.seller_orders
            .entry(seller.clone())
            .or_default()
            .push(id);
        emit(
            "order_created",
            json!({ "order_id": U64(id), "seller": seller, "price": price, "deadline_ms": deadline_ms }),
        );
        U64(id)
    }

    /// NEP-141 receiver. `msg` is the order id.
    ///
    /// After checking the token, this never hands money back (always returns
    /// 0): a returned transfer goes to whoever sent it, which for a 1Click
    /// payment is NEAR Intents, not the buyer. Anything that doesn't fit an
    /// order is parked in `unmatched` for the owner to refund.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            env::predecessor_account_id() == self.usdc,
            "Only USDC is accepted"
        );
        let now = env::block_timestamp_ms();
        let order_id = msg.trim().parse::<u64>().ok();

        // Decide first, then write, so no borrow of `orders` is held while parking.
        enum Outcome {
            Funded {
                extra: u128,
                refund_to: AccountId,
            },
            Park {
                reason: &'static str,
                refund_to: Option<AccountId>,
            },
        }
        let outcome = match order_id.and_then(|id| self.orders.get_mut(&id)) {
            None if order_id.is_none() => Outcome::Park {
                reason: "msg is not an order id",
                refund_to: None,
            },
            None => Outcome::Park {
                reason: "unknown order",
                refund_to: None,
            },
            Some(order) => {
                let refund_to = Some(order.buyer_refund.clone());
                if order.status != Status::Created {
                    Outcome::Park {
                        reason: "order already paid or closed",
                        refund_to,
                    }
                } else if now > order.deadline_ms.0 {
                    Outcome::Park {
                        reason: "order expired",
                        refund_to,
                    }
                } else if amount.0 < order.price.0 {
                    Outcome::Park {
                        reason: "less than the price",
                        refund_to,
                    }
                } else {
                    order.status = Status::Funded;
                    order.paid = order.price;
                    order.funded_ms = Some(U64(now));
                    Outcome::Funded {
                        extra: amount.0 - order.price.0,
                        refund_to: order.buyer_refund.clone(),
                    }
                }
            }
        };

        match outcome {
            Outcome::Funded { extra, refund_to } => {
                let id = order_id.unwrap();
                emit(
                    "order_funded",
                    json!({ "order_id": U64(id), "amount": amount, "sender_id": sender_id }),
                );
                if extra > 0 {
                    self.park(
                        sender_id,
                        extra,
                        &msg,
                        Some(id),
                        Some(refund_to),
                        "paid more than the price",
                    );
                }
            }
            Outcome::Park { reason, refund_to } => {
                self.park(sender_id, amount.0, &msg, order_id, refund_to, reason);
            }
        }
        PromiseOrValue::Value(U128(0))
    }

    /// Seller (or relayer/owner) records the courier reference, e.g. a Borzo
    /// order id or a tracking number. Can be called again to correct it.
    pub fn mark_shipped(&mut self, order_id: U64, courier_ref: String) {
        require!(
            !courier_ref.is_empty() && courier_ref.len() <= MAX_REF_LEN,
            "Courier reference must be 1-128 characters"
        );
        require!(
            !courier_ref.contains('|'),
            "Courier reference cannot contain |"
        );
        let caller = env::predecessor_account_id();
        let is_staff = caller == self.relayer || caller == self.owner;
        let order = self.order_mut(order_id.0);
        require!(
            is_staff || caller == order.seller,
            "Only the seller can mark this shipped"
        );
        require!(
            matches!(order.status, Status::Funded | Status::Shipped),
            "Order is not paid or already delivered"
        );
        order.status = Status::Shipped;
        order.courier_ref = Some(courier_ref.clone());
        emit(
            "order_shipped",
            json!({ "order_id": order_id, "courier_ref": courier_ref }),
        );
    }

    // ---------------------------------------------------------------- proofs

    /// Proof 1: the buyer's own signature over `delivered|<id>|<contract>`.
    /// Anyone may submit it (usually our relayer, so the buyer pays no gas).
    pub fn confirm_by_buyer(&mut self, order_id: U64, signature: Base64VecU8) {
        let message = self.delivered_message(order_id);
        let now = env::block_timestamp_ms();
        let order = self.order_mut(order_id.0);
        require!(
            matches!(order.status, Status::Funded | Status::Shipped),
            "Order is not awaiting delivery"
        );
        let pk = ed25519_bytes(&order.buyer_pk);
        require!(verify(&signature, &message, &pk), "Invalid buyer signature");
        order.status = Status::Delivered;
        order.proof = Some(Proof::Buyer);
        order.delivered_ms = Some(U64(now));
        emit(
            "order_delivered",
            json!({ "order_id": order_id, "proof": "buyer" }),
        );
    }

    /// Proof 2: our checker's signature over
    /// `checker|delivered|<id>|<courier_ref>|<signed_at>|<contract>`.
    /// If a courier reference was stored at shipping, it must match.
    pub fn confirm_by_checker(
        &mut self,
        order_id: U64,
        courier_ref: String,
        signed_at: U64,
        signature: Base64VecU8,
    ) {
        let message = self.checker_message(order_id, courier_ref.clone(), signed_at);
        let pk = ed25519_bytes(&self.checker_pk);
        let now = env::block_timestamp_ms();
        let order = self.order_mut(order_id.0);
        require!(
            matches!(order.status, Status::Funded | Status::Shipped),
            "Order is not awaiting delivery"
        );
        if let Some(stored) = &order.courier_ref {
            require!(*stored == courier_ref, "Courier reference does not match");
        }
        require!(
            verify(&signature, &message, &pk),
            "Invalid checker signature"
        );
        order.status = Status::Delivered;
        order.proof = Some(Proof::Checker {
            courier_ref: courier_ref.clone(),
        });
        order.delivered_ms = Some(U64(now));
        emit(
            "order_delivered",
            json!({ "order_id": order_id, "proof": "checker", "courier_ref": courier_ref }),
        );
    }

    /// The buyer complains inside the window, with their signature over
    /// `complaint|<id>|<contract>`. The owner then decides with `resolve`.
    pub fn raise_complaint(&mut self, order_id: U64, signature: Base64VecU8) {
        let message = self.complaint_message(order_id);
        let window = self.complaint_window_ms;
        let now = env::block_timestamp_ms();
        let order = self.order_mut(order_id.0);
        require!(
            order.status == Status::Delivered,
            "Order is not in its complaint window"
        );
        let delivered = order.delivered_ms.map(|t| t.0).unwrap_or(0);
        require!(now < delivered + window, "The complaint window has closed");
        let pk = ed25519_bytes(&order.buyer_pk);
        require!(verify(&signature, &message, &pk), "Invalid buyer signature");
        order.status = Status::Disputed;
        emit("complaint_raised", json!({ "order_id": order_id }));
    }

    // --------------------------------------------------------------- payouts

    /// Anyone, after the complaint window: pay the seller.
    pub fn release(&mut self, order_id: U64) -> Promise {
        let window = self.complaint_window_ms;
        let now = env::block_timestamp_ms();
        let order = self.order_ref(order_id.0);
        require!(order.status == Status::Delivered, "Order is not delivered");
        let delivered = order.delivered_ms.map(|t| t.0).unwrap_or(u64::MAX);
        require!(
            now >= delivered.saturating_add(window),
            "The complaint window is still open"
        );
        self.payout_order(order_id.0, true, Status::Delivered)
    }

    /// Anyone, after the deadline, if delivery was never proven: refund the
    /// buyer. An order that was never paid just expires.
    pub fn refund(&mut self, order_id: U64) -> PromiseOrValue<U128> {
        let now = env::block_timestamp_ms();
        let order = self.order_mut(order_id.0);
        require!(now > order.deadline_ms.0, "The deadline has not passed");
        match order.status {
            Status::Created => {
                order.status = Status::Expired;
                order.closed_ms = Some(U64(now));
                emit("order_expired", json!({ "order_id": order_id }));
                PromiseOrValue::Value(U128(0))
            }
            Status::Funded | Status::Shipped => {
                let revert_to = order.status;
                PromiseOrValue::Promise(self.payout_order(order_id.0, false, revert_to))
            }
            _ => env::panic_str("Order cannot be refunded"),
        }
    }

    /// Owner decides a dispute: `to_seller` pays the seller, otherwise the buyer.
    pub fn resolve(&mut self, order_id: U64, to_seller: bool) -> Promise {
        self.assert_owner();
        require!(
            self.order_ref(order_id.0).status == Status::Disputed,
            "Order is not disputed"
        );
        emit(
            "dispute_resolved",
            json!({ "order_id": order_id, "to_seller": to_seller }),
        );
        self.payout_order(order_id.0, to_seller, Status::Disputed)
    }

    /// Owner refunds a parked payment. `to` is required when we don't know
    /// the buyer (the sender of a 1Click payment is not the buyer).
    pub fn refund_unmatched(&mut self, id: U64, to: Option<AccountId>) -> Promise {
        self.assert_owner();
        let entry = self
            .unmatched
            .remove(&id.0)
            .unwrap_or_else(|| env::panic_str("No such unmatched payment"));
        let recipient = to
            .or_else(|| entry.refund_to.clone())
            .unwrap_or_else(|| env::panic_str("Say who to refund"));
        emit(
            "unmatched_refunded",
            json!({ "id": id, "to": recipient, "amount": entry.amount }),
        );
        let amount = entry.amount.0;
        self.send(&recipient, amount, PayoutTarget::Unmatched { entry })
    }

    /// Callback for every payout. If the tokens came back (failed transfer or
    /// NEAR Intents refused the deposit), undo the status change so the payout
    /// can be retried. Returns the amount that actually left.
    #[private]
    pub fn on_payout(
        &mut self,
        target: PayoutTarget,
        recipient: AccountId,
        amount: U128,
        mode: PayoutMode,
    ) -> U128 {
        let sent = sent_amount(amount.0, mode);
        let returned = amount.0 - sent;
        if returned == 0 {
            emit("payout_done", json!({ "to": recipient, "amount": amount }));
            return U128(sent);
        }
        match target {
            PayoutTarget::Order {
                order_id,
                to_seller,
                revert_to,
            } => {
                if sent == 0 {
                    let order = self.order_mut(order_id.0);
                    order.status = revert_to;
                    order.closed_ms = None;
                    emit(
                        "payout_failed",
                        json!({ "order_id": order_id, "to_seller": to_seller, "status": revert_to }),
                    );
                } else {
                    let me = env::current_account_id();
                    self.park(
                        me,
                        returned,
                        "",
                        Some(order_id.0),
                        Some(recipient),
                        "payout partly returned",
                    );
                }
            }
            PayoutTarget::Unmatched { mut entry } => {
                entry.amount = U128(returned);
                self.unmatched.insert(entry.id.0, entry);
                emit(
                    "payout_failed",
                    json!({ "to": recipient, "amount": U128(returned) }),
                );
            }
        }
        U128(sent)
    }

    // ----------------------------------------------------------------- admin

    pub fn set_checker_pk(&mut self, checker_pk: PublicKey) {
        self.assert_owner();
        ed25519_bytes(&checker_pk);
        self.checker_pk = checker_pk;
    }

    pub fn set_relayer(&mut self, relayer: AccountId) {
        self.assert_owner();
        self.relayer = relayer;
    }

    pub fn set_complaint_window(&mut self, complaint_window_ms: U64) {
        self.assert_owner();
        self.complaint_window_ms = complaint_window_ms.0;
    }

    pub fn set_payout_mode(&mut self, mode: PayoutMode) {
        self.assert_owner();
        self.payout_mode = mode;
    }

    // ----------------------------------------------------------------- views

    pub fn get_order(&self, order_id: U64) -> Option<Order> {
        self.orders.get(&order_id.0).cloned()
    }

    pub fn orders_for_seller(
        &self,
        seller: AccountId,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> Vec<Order> {
        let ids = match self.seller_orders.get(&seller) {
            Some(ids) => ids,
            None => return vec![],
        };
        ids.iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .filter_map(|id| self.orders.get(id).cloned())
            .collect()
    }

    pub fn get_unmatched(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Unmatched> {
        self.unmatched
            .values()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .cloned()
            .collect()
    }

    pub fn get_config(&self) -> Config {
        Config {
            owner: self.owner.clone(),
            relayer: self.relayer.clone(),
            usdc: self.usdc.clone(),
            intents: self.intents.clone(),
            checker_pk: self.checker_pk.clone(),
            complaint_window_ms: U64(self.complaint_window_ms),
            payout_mode: self.payout_mode,
            next_order_id: U64(self.next_order_id),
            unmatched_count: self.unmatched.len(),
        }
    }

    /// The exact text the buyer signs to confirm delivery.
    pub fn delivered_message(&self, order_id: U64) -> String {
        format!("delivered|{}|{}", order_id.0, env::current_account_id())
    }

    /// The exact text the buyer signs to complain.
    pub fn complaint_message(&self, order_id: U64) -> String {
        format!("complaint|{}|{}", order_id.0, env::current_account_id())
    }

    /// The exact text the checker signs.
    pub fn checker_message(&self, order_id: U64, courier_ref: String, signed_at: U64) -> String {
        require!(
            !courier_ref.contains('|'),
            "Courier reference cannot contain |"
        );
        format!(
            "checker|delivered|{}|{}|{}|{}",
            order_id.0,
            courier_ref,
            signed_at.0,
            env::current_account_id()
        )
    }
}

// ------------------------------------------------------------------ internal

impl Escrow {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Owner only");
    }

    fn assert_relayer_or_owner(&self) {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.relayer || caller == self.owner,
            "Relayer or owner only"
        );
    }

    fn order_ref(&self, id: u64) -> &Order {
        self.orders
            .get(&id)
            .unwrap_or_else(|| env::panic_str("No such order"))
    }

    fn order_mut(&mut self, id: u64) -> &mut Order {
        self.orders
            .get_mut(&id)
            .unwrap_or_else(|| env::panic_str("No such order"))
    }

    /// Set the final status first, then send; `on_payout` undoes it if the
    /// tokens come back. Each order can only reach a final status once.
    fn payout_order(&mut self, id: u64, to_seller: bool, revert_to: Status) -> Promise {
        let now = env::block_timestamp_ms();
        let order = self.order_mut(id);
        order.status = if to_seller {
            Status::Released
        } else {
            Status::Refunded
        };
        order.closed_ms = Some(U64(now));
        let recipient = if to_seller {
            order.seller.clone()
        } else {
            order.buyer_refund.clone()
        };
        let amount = order.paid.0;
        emit(
            if to_seller {
                "order_released"
            } else {
                "order_refunded"
            },
            json!({ "order_id": U64(id), "to": recipient, "amount": U128(amount) }),
        );
        self.send(
            &recipient,
            amount,
            PayoutTarget::Order {
                order_id: U64(id),
                to_seller,
                revert_to,
            },
        )
    }

    fn send(&self, recipient: &AccountId, amount: u128, target: PayoutTarget) -> Promise {
        let mode = self.payout_mode;
        let transfer = match mode {
            PayoutMode::Intents => ext_ft::ext(self.usdc.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(GAS_FT_TRANSFER_CALL)
                .ft_transfer_call(
                    self.intents.clone(),
                    U128(amount),
                    None,
                    recipient.to_string(),
                ),
            PayoutMode::Direct => ext_ft::ext(self.usdc.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(GAS_FT_TRANSFER)
                .ft_transfer(recipient.clone(), U128(amount), None),
        };
        transfer.then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_ON_PAYOUT)
                .on_payout(target, recipient.clone(), U128(amount), mode),
        )
    }

    fn park(
        &mut self,
        from: AccountId,
        amount: u128,
        msg: &str,
        order_id: Option<u64>,
        refund_to: Option<AccountId>,
        reason: &str,
    ) {
        let id = self.next_unmatched_id;
        self.next_unmatched_id += 1;
        let entry = Unmatched {
            id: U64(id),
            from,
            amount: U128(amount),
            msg: msg.chars().take(MAX_STORED_MSG_LEN).collect(),
            order_id: order_id.map(U64),
            refund_to,
            reason: reason.to_string(),
            at_ms: U64(env::block_timestamp_ms()),
        };
        emit(
            "payment_unmatched",
            json!({ "id": U64(id), "amount": U128(amount), "order_id": order_id.map(U64), "reason": reason }),
        );
        self.unmatched.insert(id, entry);
    }
}

/// How much of a payout actually left the contract, read from the transfer's
/// result. `ft_transfer_call` resolves to the amount the receiver kept.
fn sent_amount(amount: u128, mode: PayoutMode) -> u128 {
    require!(
        env::promise_results_count() == 1,
        "Expected one promise result"
    );
    // If the result can't be read, assume the tokens left: never risk paying twice.
    match env::promise_result_checked(0, 64) {
        Ok(bytes) => match mode {
            PayoutMode::Intents => serde_json::from_slice::<U128>(&bytes)
                .map(|used| used.0.min(amount))
                .unwrap_or(amount),
            PayoutMode::Direct => amount,
        },
        Err(PromiseError::Failed) => 0,
        Err(_) => amount,
    }
}

fn ed25519_bytes(pk: &PublicKey) -> [u8; 32] {
    require!(
        matches!(pk.curve_type(), CurveType::ED25519),
        "Key must be ed25519"
    );
    pk.as_bytes()[1..]
        .try_into()
        .unwrap_or_else(|_| env::panic_str("Bad ed25519 key"))
}

fn verify(signature: &Base64VecU8, message: &str, pk: &[u8; 32]) -> bool {
    match <[u8; 64]>::try_from(signature.0.as_slice()) {
        Ok(sig) => env::ed25519_verify(&sig, message.as_bytes(), pk),
        Err(_) => false,
    }
}

fn emit(event: &str, data: serde_json::Value) {
    log!(
        "EVENT_JSON:{}",
        json!({ "standard": "doorstep", "version": "1.0.0", "event": event, "data": [data] })
    );
}
