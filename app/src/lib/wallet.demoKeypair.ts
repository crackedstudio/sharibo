import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import type { Signer } from "./wallet";

/**
 * Generated-keypair signer. Replaces the `Keypair.random()` / `Keypair.fromSecret()`
 * calls that used to live in App.tsx. Signing goes through the SDK's
 * `basicNodeSigner`, which is what `connect` used when it was handed a raw keypair.
 */
export function createRandomDemoSigner(networkPassphrase: string): Signer {
  return demoSignerFromKeypair(Keypair.random(), networkPassphrase);
}

export function demoSignerFromSecret(secret: string, networkPassphrase: string): Signer {
  return demoSignerFromKeypair(Keypair.fromSecret(secret), networkPassphrase);
}

export function randomDemoAddress(): string {
  return Keypair.random().publicKey();
}

function demoSignerFromKeypair(keypair: Keypair, networkPassphrase: string): Signer {
  const node = basicNodeSigner(keypair, networkPassphrase);
  const signer: Signer = {
    async publicKey() {
      return keypair.publicKey();
    },
    async signTransaction(xdr: string) {
      const signed = await node.signTransaction(xdr, { networkPassphrase });
      return signed.signedTxXdr;
    },
    async networkPassphrase() {
      return networkPassphrase;
    },
  };
  // Not part of Signer. toShariboSigner forwards it so non-invoker auth still
  // signs the way a raw Keypair did.
  return Object.assign(signer, {
    signAuthEntry(entryXdr: string, opts?: unknown) {
      return node.signAuthEntry(
        entryXdr,
        opts as { networkPassphrase?: string; address?: string } | undefined,
      );
    },
  });
}
