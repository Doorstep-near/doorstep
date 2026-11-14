// Seller sign-in with an EVM wallet (MetaMask, Coinbase Wallet, Rabby, ...): personal_sign
// (EIP-191) over our challenge text. We recover the signing address and compare.
// Smart-contract wallets (EIP-1271) aren't supported.
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";

/** keccak256("\x19Ethereum Signed Message:\n" + byteLength + message) */
export function personalMessageHash(message: string): Uint8Array {
  const msg = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${msg.length}`);
  return keccak_256(new Uint8Array([...prefix, ...msg]));
}

/** The lowercase 0x address that signed `message`, or null if the signature is malformed. */
export function recoverPersonalSigner(message: string, signatureHex: string): string | null {
  try {
    const bytes = Buffer.from(signatureHex.replace(/^0x/, ""), "hex");
    if (bytes.length !== 65) return null;
    const v = bytes[64]!;
    const recovery = v >= 27 ? v - 27 : v;
    if (recovery !== 0 && recovery !== 1) return null;
    const sig = secp256k1.Signature.fromCompact(bytes.subarray(0, 64)).addRecoveryBit(recovery);
    const pub = sig.recoverPublicKey(personalMessageHash(message)).toRawBytes(false);
    return "0x" + Buffer.from(keccak_256(pub.subarray(1)).subarray(-20)).toString("hex");
  } catch {
    return null;
  }
}
