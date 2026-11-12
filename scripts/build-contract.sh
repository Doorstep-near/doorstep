#!/usr/bin/env bash
# Build the escrow wasm into contracts/escrow/res/doorstep_escrow.wasm.
#
# Recent Rust versions turn on wasm features NEAR may reject, so we rebuild the
# standard library for the plain "MVP" wasm feature set. Needs rust-src:
#   rustup component add rust-src
# Optional: Node (for wasm-opt via npx binaryen) to shrink and validate it.
set -euo pipefail
cd "$(dirname "$0")/../contracts/escrow"

RUSTC_BOOTSTRAP=1 RUSTFLAGS="-C target-cpu=mvp -C link-arg=-s" \
  cargo build --target wasm32-unknown-unknown --release -Z build-std=std,panic_abort

mkdir -p res
RAW=target/wasm32-unknown-unknown/release/doorstep_escrow.wasm
if command -v npx >/dev/null; then
  # --mvp-features fails loudly if any newer wasm instruction slipped in.
  npx --yes -p binaryen wasm-opt --mvp-features -Oz "$RAW" -o res/doorstep_escrow.wasm
else
  cp "$RAW" res/doorstep_escrow.wasm
fi
sha256sum res/doorstep_escrow.wasm | tee res/SHA256SUMS
ls -la res/doorstep_escrow.wasm
