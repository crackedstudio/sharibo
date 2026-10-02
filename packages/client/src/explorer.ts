/**
 * stellar.expert URL construction.
 *
 * Explorer links are how a user verifies a claim actually happened, so the
 * URL scheme lives in exactly one place. Network-name mapping is delegated to
 * `networks.ts` (`networkOf`/`isTestnet`) so there is a single source of truth.
 */
import { networkOf, isTestnet } from "./networks.js";

/**
 * Maps a network passphrase to the stellar.expert path segment.
 * Only networks that stellar.expert actually hosts appear here; anything else
 * must yield `null` rather than a silently-wrong URL.
 */
export const EXPLORER_NETWORKS: ReadonlyMap<string, string> = new Map([
  ["Public Global Stellar Network ; September 2015", "public"],
  ["Test SDF Network ; September 2015", "testnet"],
]);

const EXPLORER_BASE = "https://stellar.expert/explorer";

function explorerUrl(
  kind: "tx" | "account" | "contract",
  id: string,
  networkPassphrase: string,
): string | null {
  const network = EXPLORER_NETWORKS.get(networkPassphrase);
  if (network === undefined) return null;
  return `${EXPLORER_BASE}/${network}/${kind}/${id}`;
}

/**
 * Builds a stellar.expert transaction URL, or `null` when the network is not
 * hosted by stellar.expert.
 */
export function explorerTxUrl(hash: string, networkPassphrase: string): string | null {
  return explorerUrl("tx", hash, networkPassphrase);
}

/**
 * Builds a stellar.expert account URL, or `null` when the network is not
 * hosted by stellar.expert.
 */
export function explorerAccountUrl(address: string, networkPassphrase: string): string | null {
  return explorerUrl("account", address, networkPassphrase);
}

/**
 * Builds a stellar.expert contract URL, or `null` when the network is not
 * hosted by stellar.expert.
 */
export function explorerContractUrl(contractId: string, networkPassphrase: string): string | null {
  return explorerUrl("contract", contractId, networkPassphrase);
}

// Re-exported so callers can branch on network without importing networks.js.
export { networkOf, isTestnet };
