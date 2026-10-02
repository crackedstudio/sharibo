import { Networks } from "@stellar/stellar-sdk";
import type { Signer } from "./wallet";

/**
 * Maps a Freighter network string (e.g., "TESTNET", "PUBLIC") to the corresponding
 * Stellar SDK network passphrase.
 */
function freighterNetworkToPassphrase(network: string): string | null {
  switch (network) {
    case "PUBLIC":
      return Networks.PUBLIC;
    case "TESTNET":
      return Networks.TESTNET;
    case "FUTURENET":
      return Networks.FUTURENET;
    default:
      return null;
  }
}

/**
 * Maps a network passphrase to a human-readable network name.
 */
function passphraseToNetworkName(passphrase: string): string | null {
  switch (passphrase) {
    case Networks.PUBLIC:
      return "Mainnet";
    case Networks.TESTNET:
      return "Testnet";
    case Networks.FUTURENET:
      return "Futurenet";
    default:
      return null;
  }
}

export interface NetworkMismatchError {
  walletNetwork: string;
  appNetwork: string;
  walletPassphrase: string;
  appPassphrase: string;
}

/**
 * Validates that the wallet's network matches the app's configured network.
 * Returns null if networks match, or a NetworkMismatchError describing the mismatch.
 *
 * @param freighterNetworkString - The network string from Freighter (e.g., "TESTNET", "PUBLIC")
 * @param appNetworkPassphrase - The app's configured network passphrase from config.ts
 * @returns null if networks match, NetworkMismatchError if they don't
 */
export function checkNetworkMatch(
  freighterNetworkString: string,
  appNetworkPassphrase: string,
): NetworkMismatchError | null {
  const walletPassphrase = freighterNetworkToPassphrase(freighterNetworkString);

  // If we can't map the Freighter network, we can't validate it robustly
  if (!walletPassphrase) {
    return null;
  }

  // Networks match
  if (walletPassphrase === appNetworkPassphrase) {
    return null;
  }

  // Mismatch detected
  const walletName = passphraseToNetworkName(walletPassphrase) || freighterNetworkString;
  const appName = passphraseToNetworkName(appNetworkPassphrase) || "Unknown";

  return {
    walletNetwork: walletName,
    appNetwork: appName,
    walletPassphrase,
    appPassphrase: appNetworkPassphrase,
  };
}

export function buildNetworkMismatchMessage(
  mismatchError: NetworkMismatchError,
  switchInstructions: string,
): string {
  return (
    `Your Freighter wallet is connected to ${mismatchError.walletNetwork}, ` +
    `but this app is configured for ${mismatchError.appNetwork}. ` +
    `${switchInstructions}`
  );
}

const DEFAULT_ADDRESS_ERROR = "Could not get address from Freighter.";

function mismatchError(freighterNetwork: string, appNetworkPassphrase: string): Error | null {
  const mismatch = checkNetworkMatch(freighterNetwork, appNetworkPassphrase);
  if (!mismatch) return null;
  return new Error(
    buildNetworkMismatchMessage(
      mismatch,
      `Please open Freighter, click the network selector in the upper right, and switch to ${mismatch.appNetwork}.`,
    ),
  );
}

/** True when the Freighter extension responds. False when it is missing or errors. */
export async function isFreighterAvailable(): Promise<boolean> {
  try {
    const { isConnected } = await import("@stellar/freighter-api");
    const res = await isConnected();
    return Boolean(res.isConnected);
  } catch {
    return false;
  }
}

/**
 * Freighter-backed {@link Signer}. Requests permission, checks the wallet
 * network against the app, and re-checks that network on every signature.
 */
export async function createFreighterSigner(
  appNetworkPassphrase: string,
  addressError: string = DEFAULT_ADDRESS_ERROR,
): Promise<Signer> {
  const { getAddress, getNetworkDetails, isAllowed, requestAccess, signTransaction } =
    await import("@stellar/freighter-api");

  const allowed = await isAllowed();
  if (!allowed.isAllowed) {
    await requestAccess();
  }

  async function requireNetwork() {
    const networkRes = await getNetworkDetails();
    const mismatch = mismatchError(networkRes.network, appNetworkPassphrase);
    if (mismatch) throw mismatch;
    return networkRes;
  }

  const networkRes = await requireNetwork();
  const addressRes = await getAddress();
  const pubKey = addressRes.address;
  if (!pubKey) {
    throw new Error(addressError);
  }

  return {
    async publicKey() {
      return pubKey;
    },
    async networkPassphrase() {
      return networkRes.networkPassphrase;
    },
    async signTransaction(xdr: string) {
      const current = await requireNetwork();
      const signedRes = await signTransaction(xdr, {
        networkPassphrase: current.networkPassphrase,
      });
      if (signedRes.error) {
        throw new Error(signedRes.error.toString());
      }
      return signedRes.signedTxXdr;
    },
  };
}
