import { Networks } from "@stellar/stellar-sdk";

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
