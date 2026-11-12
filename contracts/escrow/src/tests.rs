#![allow(unused_must_use)]

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult};

const CONTRACT: &str = "escrow.near";
const OWNER: &str = "owner.near";
const RELAYER: &str = "relayer.near";
const USDC: &str = "usdc.near";
const SELLER: &str = "eraya.near";
const BUYER_REFUND: &str = "buyer.near";
const SOLVER: &str = "solver.near";

const T0: u64 = 1_800_000_000_000; // ms
const WINDOW: u64 = 10 * 60 * 1000; // 10 minutes
const DEADLINE: u64 = 3 * 24 * 60 * 60 * 1000; // 3 days after T0
const PRICE: u128 = 2_000_000; // 2 USDC

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn buyer_key() -> SigningKey {
    SigningKey::from_bytes(&[1u8; 32])
}

fn checker_key() -> SigningKey {
    SigningKey::from_bytes(&[9u8; 32])
}

fn near_pk(k: &SigningKey) -> PublicKey {
    PublicKey::from_parts(CurveType::ED25519, k.verifying_key().to_bytes().to_vec()).unwrap()
}

fn sign(k: &SigningKey, msg: &str) -> Base64VecU8 {
    Base64VecU8(k.sign(msg.as_bytes()).to_bytes().to_vec())
}

fn builder(predecessor: &str, now_ms: u64) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc(CONTRACT))
        .predecessor_account_id(acc(predecessor))
        .signer_account_id(acc(predecessor))
        .block_timestamp(now_ms * 1_000_000)
        .prepaid_gas(Gas::from_tgas(300));
    b
}

fn as_(predecessor: &str, now_ms: u64) {
    testing_env!(builder(predecessor, now_ms).build());
}

/// Run a payout callback with the given result of the transfer.
fn as_callback(now_ms: u64, result: PromiseResult) {
    testing_env!(
        builder(CONTRACT, now_ms).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
}

fn setup() -> Escrow {
    as_(OWNER, T0);
    Escrow::new(
        acc(OWNER),
        acc(RELAYER),
        acc(USDC),
        near_pk(&checker_key()),
        U64(WINDOW),
        None,
    )
}

fn create(c: &mut Escrow) -> U64 {
    as_(RELAYER, T0);
    c.create_order(
        acc(SELLER),
        U128(PRICE),
        U64(T0 + DEADLINE),
        near_pk(&buyer_key()),
        acc(BUYER_REFUND),
    )
}

fn pay(c: &mut Escrow, msg: &str, amount: u128) -> PromiseOrValue<U128> {
    as_(USDC, T0 + 1_000);
    c.ft_on_transfer(acc(SOLVER), U128(amount), msg.to_string())
}

fn returned(v: PromiseOrValue<U128>) -> u128 {
    match v {
        PromiseOrValue::Value(u) => u.0,
        PromiseOrValue::Promise(_) => panic!("expected a value"),
    }
}

fn status(c: &Escrow, id: U64) -> Status {
    c.get_order(id).unwrap().status
}

fn funded(c: &mut Escrow) -> U64 {
    let id = create(c);
    pay(c, &id.0.to_string(), PRICE);
    id
}

fn delivered_by_buyer(c: &mut Escrow, at_ms: u64) -> U64 {
    let id = funded(c);
    as_(RELAYER, at_ms);
    let sig = sign(&buyer_key(), &c.delivered_message(id));
    c.confirm_by_buyer(id, sig);
    id
}

fn ok_bytes(amount: u128) -> PromiseResult {
    PromiseResult::Successful(serde_json::to_vec(&U128(amount)).unwrap())
}

// ------------------------------------------------------------------ create

#[test]
fn relayer_creates_order() {
    let mut c = setup();
    let id = create(&mut c);
    assert_eq!(id, U64(1));
    let o = c.get_order(id).unwrap();
    assert_eq!(o.status, Status::Created);
    assert_eq!(o.price, U128(PRICE));
    assert_eq!(o.seller, acc(SELLER));
    assert_eq!(c.orders_for_seller(acc(SELLER), None, None).len(), 1);
}

#[test]
#[should_panic(expected = "Relayer or owner only")]
fn stranger_cannot_create_order() {
    let mut c = setup();
    as_("stranger.near", T0);
    c.create_order(
        acc(SELLER),
        U128(PRICE),
        U64(T0 + DEADLINE),
        near_pk(&buyer_key()),
        acc(BUYER_REFUND),
    );
}

#[test]
#[should_panic(expected = "Deadline must be in the future")]
fn deadline_in_past_rejected() {
    let mut c = setup();
    as_(RELAYER, T0);
    c.create_order(
        acc(SELLER),
        U128(PRICE),
        U64(T0 - 1),
        near_pk(&buyer_key()),
        acc(BUYER_REFUND),
    );
}

// ----------------------------------------------------------------- payment

#[test]
fn exact_payment_funds_order() {
    let mut c = setup();
    let id = create(&mut c);
    assert_eq!(returned(pay(&mut c, "1", PRICE)), 0);
    let o = c.get_order(id).unwrap();
    assert_eq!(o.status, Status::Funded);
    assert_eq!(o.paid, U128(PRICE));
    assert!(get_logs().iter().any(|l| l.contains("order_funded")));
    assert_eq!(c.get_unmatched(None, None).len(), 0);
}

#[test]
fn overpayment_funds_order_and_parks_extra_for_buyer() {
    let mut c = setup();
    let id = create(&mut c);
    assert_eq!(returned(pay(&mut c, " 1 ", PRICE + 500)), 0);
    assert_eq!(status(&c, id), Status::Funded);
    let parked = c.get_unmatched(None, None);
    assert_eq!(parked.len(), 1);
    assert_eq!(parked[0].amount, U128(500));
    assert_eq!(parked[0].refund_to, Some(acc(BUYER_REFUND)));
    assert_eq!(parked[0].order_id, Some(id));
}

#[test]
fn underpayment_is_kept_not_returned() {
    let mut c = setup();
    let id = create(&mut c);
    assert_eq!(returned(pay(&mut c, "1", PRICE - 1)), 0);
    assert_eq!(status(&c, id), Status::Created);
    let parked = c.get_unmatched(None, None);
    assert_eq!(parked[0].reason, "less than the price");
    assert_eq!(parked[0].refund_to, Some(acc(BUYER_REFUND)));
}

#[test]
fn unknown_order_and_bad_msg_are_parked() {
    let mut c = setup();
    create(&mut c);
    assert_eq!(returned(pay(&mut c, "999", PRICE)), 0);
    assert_eq!(returned(pay(&mut c, "hello", PRICE)), 0);
    let parked = c.get_unmatched(None, None);
    assert_eq!(parked.len(), 2);
    assert_eq!(parked[0].reason, "unknown order");
    assert_eq!(parked[1].reason, "msg is not an order id");
    assert_eq!(parked[1].refund_to, None);
}

#[test]
fn second_payment_for_same_order_is_parked() {
    let mut c = setup();
    let id = funded(&mut c);
    pay(&mut c, &id.0.to_string(), PRICE);
    assert_eq!(status(&c, id), Status::Funded);
    assert_eq!(
        c.get_unmatched(None, None)[0].reason,
        "order already paid or closed"
    );
}

#[test]
fn late_payment_is_parked() {
    let mut c = setup();
    let id = create(&mut c);
    as_(USDC, T0 + DEADLINE + 1);
    c.ft_on_transfer(acc(SOLVER), U128(PRICE), id.0.to_string());
    assert_eq!(status(&c, id), Status::Created);
    assert_eq!(c.get_unmatched(None, None)[0].reason, "order expired");
}

#[test]
#[should_panic(expected = "Only USDC is accepted")]
fn wrong_token_rejected() {
    let mut c = setup();
    create(&mut c);
    as_("fake-usdc.near", T0);
    c.ft_on_transfer(acc(SOLVER), U128(PRICE), "1".to_string());
}

// ---------------------------------------------------------------- shipping

#[test]
fn seller_marks_shipped() {
    let mut c = setup();
    let id = funded(&mut c);
    as_(SELLER, T0 + 2_000);
    c.mark_shipped(id, "borzo:12345".to_string());
    let o = c.get_order(id).unwrap();
    assert_eq!(o.status, Status::Shipped);
    assert_eq!(o.courier_ref.as_deref(), Some("borzo:12345"));
}

#[test]
#[should_panic(expected = "Only the seller can mark this shipped")]
fn stranger_cannot_mark_shipped() {
    let mut c = setup();
    let id = funded(&mut c);
    as_("stranger.near", T0);
    c.mark_shipped(id, "x".to_string());
}

#[test]
#[should_panic(expected = "Order is not paid or already delivered")]
fn cannot_ship_unpaid_order() {
    let mut c = setup();
    let id = create(&mut c);
    as_(SELLER, T0);
    c.mark_shipped(id, "x".to_string());
}

// ------------------------------------------------------------ buyer proof

#[test]
fn buyer_signature_marks_delivered() {
    let mut c = setup();
    let id = delivered_by_buyer(&mut c, T0 + 5_000);
    let o = c.get_order(id).unwrap();
    assert_eq!(o.status, Status::Delivered);
    assert_eq!(o.proof, Some(Proof::Buyer));
    assert_eq!(o.delivered_ms, Some(U64(T0 + 5_000)));
}

#[test]
#[should_panic(expected = "Invalid buyer signature")]
fn forged_buyer_signature_rejected() {
    let mut c = setup();
    let id = funded(&mut c);
    as_(RELAYER, T0);
    let impostor = SigningKey::from_bytes(&[5u8; 32]);
    c.confirm_by_buyer(id, sign(&impostor, &c.delivered_message(id)));
}

#[test]
#[should_panic(expected = "Invalid buyer signature")]
fn signature_for_another_order_rejected() {
    let mut c = setup();
    let first = funded(&mut c);
    let second = funded(&mut c);
    as_(RELAYER, T0);
    let sig_for_first = sign(&buyer_key(), &c.delivered_message(first));
    c.confirm_by_buyer(second, sig_for_first);
}

#[test]
#[should_panic(expected = "Order is not awaiting delivery")]
fn buyer_signature_cannot_be_replayed() {
    let mut c = setup();
    let id = delivered_by_buyer(&mut c, T0 + 5_000);
    as_(RELAYER, T0 + 6_000);
    let sig = sign(&buyer_key(), &c.delivered_message(id));
    c.confirm_by_buyer(id, sig);
}

#[test]
#[should_panic(expected = "Invalid buyer signature")]
fn complaint_signature_is_not_a_delivery_signature() {
    let mut c = setup();
    let id = funded(&mut c);
    as_(RELAYER, T0);
    let sig = sign(&buyer_key(), &c.complaint_message(id));
    c.confirm_by_buyer(id, sig);
}

// ---------------------------------------------------------- checker proof

#[test]
fn checker_signature_marks_delivered() {
    let mut c = setup();
    let id = funded(&mut c);
    as_(SELLER, T0 + 2_000);
    c.mark_shipped(id, "borzo:777".to_string());
    as_(RELAYER, T0 + 9_000);
    let msg = c.checker_message(id, "borzo:777".to_string(), U64(1_800_000_009));
    c.confirm_by_checker(
        id,
        "borzo:777".to_string(),
        U64(1_800_000_009),
        sign(&checker_key(), &msg),
    );
    let o = c.get_order(id).unwrap();
    assert_eq!(o.status, Status::Delivered);
    assert_eq!(
        o.proof,
        Some(Proof::Checker {
            courier_ref: "borzo:777".to_string()
        })
    );
}

#[test]
fn checker_can_confirm_hand_delivery_without_courier_ref() {
    let mut c = setup();
    let id = funded(&mut c);
    as_(RELAYER, T0 + 9_000);
    let msg = c.checker_message(id, "code".to_string(), U64(1));
    c.confirm_by_checker(id, "code".to_string(), U64(1), sign(&checker_key(), &msg));
    assert_eq!(status(&c, id), Status::Delivered);
}

#[test]
#[should_panic(expected = "Courier reference does not match")]
fn checker_signature_for_other_courier_ref_rejected() {
    let mut c = setup();
    let id = funded(&mut c);
    as_(SELLER, T0);
    c.mark_shipped(id, "borzo:777".to_string());
    as_(RELAYER, T0);
    let msg = c.checker_message(id, "borzo:888".to_string(), U64(1));
    c.confirm_by_checker(
        id,
        "borzo:888".to_string(),
        U64(1),
        sign(&checker_key(), &msg),
    );
}

#[test]
#[should_panic(expected = "Invalid checker signature")]
fn wrong_checker_key_rejected() {
    let mut c = setup();
    let id = funded(&mut c);
    as_(RELAYER, T0);
    let msg = c.checker_message(id, "code".to_string(), U64(1));
    c.confirm_by_checker(id, "code".to_string(), U64(1), sign(&buyer_key(), &msg));
}

#[test]
#[should_panic(expected = "Invalid checker signature")]
fn checker_signature_with_changed_timestamp_rejected() {
    let mut c = setup();
    let id = funded(&mut c);
    as_(RELAYER, T0);
    let msg = c.checker_message(id, "code".to_string(), U64(1));
    c.confirm_by_checker(id, "code".to_string(), U64(2), sign(&checker_key(), &msg));
}

#[test]
fn owner_can_rotate_checker_key() {
    let mut c = setup();
    let new_key = SigningKey::from_bytes(&[42u8; 32]);
    as_(OWNER, T0);
    c.set_checker_pk(near_pk(&new_key));
    let id = funded(&mut c);
    as_(RELAYER, T0);
    let msg = c.checker_message(id, "code".to_string(), U64(1));
    c.confirm_by_checker(id, "code".to_string(), U64(1), sign(&new_key, &msg));
    assert_eq!(status(&c, id), Status::Delivered);
}

// ----------------------------------------------------------------- release

#[test]
#[should_panic(expected = "The complaint window is still open")]
fn cannot_release_inside_window() {
    let mut c = setup();
    let id = delivered_by_buyer(&mut c, T0 + 5_000);
    as_("anyone.near", T0 + 5_000 + WINDOW - 1);
    c.release(id);
}

#[test]
fn release_after_window_pays_seller() {
    let mut c = setup();
    let id = delivered_by_buyer(&mut c, T0 + 5_000);
    as_("anyone.near", T0 + 5_000 + WINDOW);
    c.release(id);
    assert_eq!(status(&c, id), Status::Released);
    assert!(get_logs().iter().any(|l| l.contains("order_released")));

    // Transfer succeeded in full: stays Released.
    as_callback(T0 + 5_000 + WINDOW + 1, ok_bytes(PRICE));
    let sent = c.on_payout(
        PayoutTarget::Order {
            order_id: id,
            to_seller: true,
            revert_to: Status::Delivered,
        },
        acc(SELLER),
        U128(PRICE),
        PayoutMode::Intents,
    );
    assert_eq!(sent, U128(PRICE));
    assert_eq!(status(&c, id), Status::Released);
}

#[test]
#[should_panic(expected = "Order is not delivered")]
fn cannot_release_twice() {
    let mut c = setup();
    let id = delivered_by_buyer(&mut c, T0 + 5_000);
    as_("anyone.near", T0 + 5_000 + WINDOW);
    c.release(id);
    c.release(id);
}

#[test]
#[should_panic(expected = "Order is not delivered")]
fn cannot_release_undelivered_order() {
    let mut c = setup();
    let id = funded(&mut c);
    as_("anyone.near", T0 + DEADLINE);
    c.release(id);
}

#[test]
fn failed_payout_reverts_and_can_retry() {
    let mut c = setup();
    let id = delivered_by_buyer(&mut c, T0 + 5_000);
    as_("anyone.near", T0 + 5_000 + WINDOW);
    c.release(id);

    as_callback(T0 + 5_000 + WINDOW + 1, PromiseResult::Failed);
    let sent = c.on_payout(
        PayoutTarget::Order {
            order_id: id,
            to_seller: true,
            revert_to: Status::Delivered,
        },
        acc(SELLER),
        U128(PRICE),
        PayoutMode::Intents,
    );
    assert_eq!(sent, U128(0));
    assert_eq!(status(&c, id), Status::Delivered);
    assert_eq!(c.get_order(id).unwrap().closed_ms, None);

    // Owner switches to direct payouts and anyone retries.
    as_(OWNER, T0 + 5_000 + WINDOW + 2);
    c.set_payout_mode(PayoutMode::Direct);
    as_("anyone.near", T0 + 5_000 + WINDOW + 3);
    c.release(id);
    assert_eq!(status(&c, id), Status::Released);
}

#[test]
fn intents_refusing_deposit_reverts() {
    // ft_transfer_call "succeeds" but the receiver used 0: the tokens came back.
    let mut c = setup();
    let id = delivered_by_buyer(&mut c, T0 + 5_000);
    as_("anyone.near", T0 + 5_000 + WINDOW);
    c.release(id);
    as_callback(T0 + 5_000 + WINDOW + 1, ok_bytes(0));
    c.on_payout(
        PayoutTarget::Order {
            order_id: id,
            to_seller: true,
            revert_to: Status::Delivered,
        },
        acc(SELLER),
        U128(PRICE),
        PayoutMode::Intents,
    );
    assert_eq!(status(&c, id), Status::Delivered);
}

#[test]
fn partly_returned_payout_parks_remainder() {
    let mut c = setup();
    let id = delivered_by_buyer(&mut c, T0 + 5_000);
    as_("anyone.near", T0 + 5_000 + WINDOW);
    c.release(id);
    as_callback(T0 + 5_000 + WINDOW + 1, ok_bytes(PRICE - 100));
    c.on_payout(
        PayoutTarget::Order {
            order_id: id,
            to_seller: true,
            revert_to: Status::Delivered,
        },
        acc(SELLER),
        U128(PRICE),
        PayoutMode::Intents,
    );
    assert_eq!(status(&c, id), Status::Released);
    let parked = c.get_unmatched(None, None);
    assert_eq!(parked[0].amount, U128(100));
    assert_eq!(parked[0].refund_to, Some(acc(SELLER)));
}

// --------------------------------------------------------------- complaints

#[test]
fn complaint_inside_window_then_owner_refunds_buyer() {
    let mut c = setup();
    let id = delivered_by_buyer(&mut c, T0 + 5_000);
    as_(RELAYER, T0 + 6_000);
    let sig = sign(&buyer_key(), &c.complaint_message(id));
    c.raise_complaint(id, sig);
    assert_eq!(status(&c, id), Status::Disputed);

    as_(OWNER, T0 + 7_000);
    c.resolve(id, false);
    assert_eq!(status(&c, id), Status::Refunded);
}

#[test]
fn owner_can_resolve_dispute_for_seller() {
    let mut c = setup();
    let id = delivered_by_buyer(&mut c, T0 + 5_000);
    as_(RELAYER, T0 + 6_000);
    let sig = sign(&buyer_key(), &c.complaint_message(id));
    c.raise_complaint(id, sig);
    as_(OWNER, T0 + 7_000);
    c.resolve(id, true);
    assert_eq!(status(&c, id), Status::Released);
}

#[test]
#[should_panic(expected = "The complaint window has closed")]
fn complaint_after_window_rejected() {
    let mut c = setup();
    let id = delivered_by_buyer(&mut c, T0 + 5_000);
    as_(RELAYER, T0 + 5_000 + WINDOW);
    let sig = sign(&buyer_key(), &c.complaint_message(id));
    c.raise_complaint(id, sig);
}

#[test]
#[should_panic(expected = "Invalid buyer signature")]
fn seller_cannot_fake_a_complaint() {
    let mut c = setup();
    let id = delivered_by_buyer(&mut c, T0 + 5_000);
    as_(RELAYER, T0 + 6_000);
    let not_buyer = SigningKey::from_bytes(&[3u8; 32]);
    c.raise_complaint(id, sign(&not_buyer, &c.complaint_message(id)));
}

#[test]
#[should_panic(expected = "Owner only")]
fn only_owner_resolves() {
    let mut c = setup();
    let id = delivered_by_buyer(&mut c, T0 + 5_000);
    as_(RELAYER, T0 + 6_000);
    let sig = sign(&buyer_key(), &c.complaint_message(id));
    c.raise_complaint(id, sig);
    as_(RELAYER, T0 + 7_000);
    c.resolve(id, true);
}

#[test]
#[should_panic(expected = "Order is not delivered")]
fn disputed_order_cannot_be_released() {
    let mut c = setup();
    let id = delivered_by_buyer(&mut c, T0 + 5_000);
    as_(RELAYER, T0 + 6_000);
    let sig = sign(&buyer_key(), &c.complaint_message(id));
    c.raise_complaint(id, sig);
    as_("anyone.near", T0 + 5_000 + WINDOW + 1);
    c.release(id);
}

// ------------------------------------------------------------------ refunds

#[test]
#[should_panic(expected = "The deadline has not passed")]
fn cannot_refund_before_deadline() {
    let mut c = setup();
    let id = funded(&mut c);
    as_("anyone.near", T0 + DEADLINE);
    c.refund(id);
}

#[test]
fn refund_after_deadline_pays_buyer() {
    let mut c = setup();
    let id = funded(&mut c);
    as_(SELLER, T0 + 1_000);
    c.mark_shipped(id, "borzo:1".to_string());
    as_("anyone.near", T0 + DEADLINE + 1);
    c.refund(id);
    assert_eq!(status(&c, id), Status::Refunded);

    // If the refund transfer fails, the order goes back to Shipped.
    as_callback(T0 + DEADLINE + 2, PromiseResult::Failed);
    c.on_payout(
        PayoutTarget::Order {
            order_id: id,
            to_seller: false,
            revert_to: Status::Shipped,
        },
        acc(BUYER_REFUND),
        U128(PRICE),
        PayoutMode::Intents,
    );
    assert_eq!(status(&c, id), Status::Shipped);
}

#[test]
fn unpaid_order_expires() {
    let mut c = setup();
    let id = create(&mut c);
    as_("anyone.near", T0 + DEADLINE + 1);
    assert_eq!(returned(c.refund(id)), 0);
    assert_eq!(status(&c, id), Status::Expired);
}

#[test]
#[should_panic(expected = "Order cannot be refunded")]
fn delivered_order_cannot_be_refunded() {
    let mut c = setup();
    let id = delivered_by_buyer(&mut c, T0 + 5_000);
    as_("anyone.near", T0 + DEADLINE + 1);
    c.refund(id);
}

#[test]
fn late_delivery_proof_still_counts_before_refund() {
    let mut c = setup();
    let id = funded(&mut c);
    as_(RELAYER, T0 + DEADLINE + 10);
    let sig = sign(&buyer_key(), &c.delivered_message(id));
    c.confirm_by_buyer(id, sig);
    assert_eq!(status(&c, id), Status::Delivered);
}

// ---------------------------------------------------------------- unmatched

#[test]
fn owner_refunds_parked_payment() {
    let mut c = setup();
    create(&mut c);
    pay(&mut c, "1", PRICE - 1);
    as_(OWNER, T0 + 2_000);
    c.refund_unmatched(U64(1), None);
    assert_eq!(c.get_unmatched(None, None).len(), 0);
}

#[test]
fn failed_unmatched_refund_is_restored() {
    let mut c = setup();
    create(&mut c);
    pay(&mut c, "1", PRICE - 1);
    let entry = c.get_unmatched(None, None).remove(0);
    as_(OWNER, T0 + 2_000);
    c.refund_unmatched(U64(1), None);
    as_callback(T0 + 3_000, PromiseResult::Failed);
    c.on_payout(
        PayoutTarget::Unmatched { entry },
        acc(BUYER_REFUND),
        U128(PRICE - 1),
        PayoutMode::Intents,
    );
    assert_eq!(c.get_unmatched(None, None)[0].amount, U128(PRICE - 1));
}

#[test]
#[should_panic(expected = "Say who to refund")]
fn unmatched_without_known_buyer_needs_recipient() {
    let mut c = setup();
    pay(&mut c, "hello", PRICE);
    as_(OWNER, T0 + 2_000);
    c.refund_unmatched(U64(1), None);
}

#[test]
#[should_panic(expected = "Owner only")]
fn only_owner_refunds_unmatched() {
    let mut c = setup();
    pay(&mut c, "hello", PRICE);
    as_(RELAYER, T0 + 2_000);
    c.refund_unmatched(U64(1), Some(acc("me.near")));
}

// -------------------------------------------------------------------- views

#[test]
fn messages_name_the_contract_and_order() {
    let c = setup();
    assert_eq!(c.delivered_message(U64(7)), "delivered|7|escrow.near");
    assert_eq!(c.complaint_message(U64(7)), "complaint|7|escrow.near");
    assert_eq!(
        c.checker_message(U64(7), "borzo:1".to_string(), U64(99)),
        "checker|delivered|7|borzo:1|99|escrow.near"
    );
}

#[test]
fn config_view() {
    let c = setup();
    let cfg = c.get_config();
    assert_eq!(cfg.intents, acc("intents.near"));
    assert_eq!(cfg.payout_mode, PayoutMode::Intents);
    assert_eq!(cfg.complaint_window_ms, U64(WINDOW));
}

// A key and signature made by scripts/keys.mjs (Node's built-in ed25519, the
// same format the buyer's browser uses), passed in as JSON args.
#[test]
fn accepts_signature_made_by_node_script() {
    let mut c = setup();
    as_(RELAYER, T0);
    let buyer_pk: PublicKey = "ed25519:ACtxKBrdYJEZ1TgJ7TPswVfYQzgZoHn1YkFb4GpoAcgs".parse().unwrap();
    let id = c.create_order(acc(SELLER), U128(PRICE), U64(T0 + DEADLINE), buyer_pk, acc(BUYER_REFUND));
    assert_eq!(c.delivered_message(id), "delivered|1|escrow.near");
    pay(&mut c, "1", PRICE);
    let sig: Base64VecU8 = serde_json::from_str(
        "\"OeUr4ezFU4QhpdJ8bMz3bExypK59th91BEpnqI+Uqd8SL2wv/IvvQ/fwWh3R9Z3wIT1/WlPdBro4bPesSe80Dw==\"",
    )
    .unwrap();
    as_(RELAYER, T0 + 5_000);
    c.confirm_by_buyer(id, sig);
    assert_eq!(status(&c, id), Status::Delivered);
}
