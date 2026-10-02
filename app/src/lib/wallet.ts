import type { ShariboSigner } from "@sharibo/client";

/**
 * App-facing wallet. Address and network are promises because a browser
 * extension resolves them on demand.
 *
 * This is not a second contract-signer type. {@link toShariboSigner} adapts it
 * to the SDK's {@link ShariboSigner} before `connect`.
 */
export interface Signer {
  publicKey(): Promise<string>;
  signTransaction(xdr: string): Promise<string>;
  networkPassphrase(): Promise<string>;
}

type AuthCapableSigner = Signer & {
  signAuthEntry: (entryXdr: string, opts?: unknown) => Promise<unknown>;
};

function hasSignAuthEntry(signer: Signer): signer is AuthCapableSigner {
  return typeof (signer as AuthCapableSigner).signAuthEntry === "function";
}

/**
 * Adapt an app {@link Signer} to the SDK's {@link ShariboSigner}.
 *
 * The app signer returns the signed transaction XDR as a string. The contract
 * client reads `{ signedTxXdr }` from the callback (the shape Freighter and
 * `basicNodeSigner` both produce), so the callback below returns that object.
 * `ShariboSigner.signTransaction` is still typed as `Promise<string>`.
 */
export async function toShariboSigner(signer: Signer): Promise<ShariboSigner> {
  const publicKey = await signer.publicKey();
  const sharibo: ShariboSigner = {
    publicKey,
    signTransaction: (async (xdr: string) => {
      const signedTxXdr = await signer.signTransaction(xdr);
      return { signedTxXdr, signerAddress: publicKey };
    }) as unknown as ShariboSigner["signTransaction"],
  };
  if (hasSignAuthEntry(signer)) {
    sharibo.signAuthEntry = signer.signAuthEntry as ShariboSigner["signAuthEntry"];
  }
  return sharibo;
}

/** True when the Freighter extension is installed and reachable. */
export async function isFreighterAvailable(): Promise<boolean> {
  const { isFreighterAvailable: available } = await import("./wallet.freighter");
  return available();
}

export interface SelectSignerOptions {
  /** True when the user chose "Fund with Freighter" rather than the demo key. */
  optedIn: boolean;
  /** Generated keypair used when Freighter is missing or the user did not opt in. */
  demo: Signer;
  appNetworkPassphrase: string;
  /** Shown when Freighter does not return an address. Defaults to the English copy. */
  addressError?: string;
}

/**
 * Freighter when the extension is available and the user opted in; otherwise
 * the demo keypair.
 */
export async function selectSigner(options: SelectSignerOptions): Promise<Signer> {
  if (!options.optedIn) return options.demo;
  const freighter = await import("./wallet.freighter");
  if (!(await freighter.isFreighterAvailable())) return options.demo;
  return freighter.createFreighterSigner(options.appNetworkPassphrase, options.addressError);
}

/** Fresh generated keypair, the demo's stand-in for a wallet. */
export async function createDemoSigner(networkPassphrase: string): Promise<Signer> {
  const { createRandomDemoSigner } = await import("./wallet.demoKeypair");
  return createRandomDemoSigner(networkPassphrase);
}

/** Restore a demo signer from a secret stored with the circle. */
export async function demoSignerFromSecret(
  secret: string,
  networkPassphrase: string,
): Promise<Signer> {
  const { demoSignerFromSecret: fromSecret } = await import("./wallet.demoKeypair");
  return fromSecret(secret, networkPassphrase);
}

/** Throwaway account address (claim recipient). Not a signer the app keeps. */
export async function randomDemoAddress(): Promise<string> {
  const { randomDemoAddress: randomAddress } = await import("./wallet.demoKeypair");
  return randomAddress();
}
