# Doorstep

Pay a real shop with any crypto, from any chain. The money waits in a NEAR
contract and reaches the seller only when delivery is proven; if it isn't
proven by the deadline, the buyer gets it back.

Built for the NEAR Hackathon on NEAR Intents: 1Click turns whatever the buyer
holds into USDC in our escrow, and payouts land in NEAR Intents so the seller
can withdraw to any chain.

## Repo

| Folder | What |
| --- | --- |
| `contracts/escrow` | The escrow contract (Rust). [Contract README](contracts/escrow/README.md) |
| `scripts` | Deploy, test orders, 1Click payment test, key tools. [Runbook](scripts/README.md) |
| `services/api` | Backend: 1Click client, relayer, checker, webhooks (in progress) |
| `apps/web` | Buyer and seller pages (in progress) |

## Try it

```bash
cd contracts/escrow && cargo test     # every order path, 49 tests
```

Mainnet test run: follow [scripts/README.md](scripts/README.md).

## License

MIT
