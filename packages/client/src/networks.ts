/**
 * Stellar network presets.
 *
 * Centralizes the per-network passphrases and endpoint URLs so callers stop
 * hand-assembling (and substring-checking) magic strings like
 * "Test SDF Network ; September 2015".
 */

export interface NetworkPreset {
  /** Stellar network passphrase. */
  passphrase: string;
  /** Soroban RPC URL. */
  rpcUrl: string;
  /** Horizon URL. */
  horizonUrl: string;
  /** Friendbot URL (testnet only; undefined elsewhere). */
  friendbotUrl?: string;
  /** Block explorer base URL. */
  explorerBase: string;
}

export const NETWORKS: Record<"testnet" | "mainnet" | "futurenet", NetworkPreset> = {
  testnet: {
    passphrase: "Test SDF Network ; September 2015",
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    friendbotUrl: "https://friendbot.stellar.org",
    explorerBase: "https://stellar.expert/explorer/testnet",
  },
  mainnet: {
    passphrase: "Public Global Stellar Network ; September 2015",
    rpcUrl: "https://soroban-rpc.mainnet.stellar.org",
    horizonUrl: "https://horizon.stellar.org",
    explorerBase: "https://stellar.expert/explorer/public",
  },
  futurenet: {
    passphrase: "Test SDF Future Network ; October 2022",
    rpcUrl: "https://rpc-futurenet.stellar.org",
    horizonUrl: "https://horizon-futurenet.stellar.org",
    friendbotUrl: "https://friendbot-futurenet.stellar.org",
    explorerBase: "https://stellar.expert/explorer/futurenet",
  },
};

/**
 * Returns the matching preset name for a passphrase, or "custom" if it
 * doesn't correspond to a known network. Replaces every substring check on
 * magic passphrases.
 */
export function networkOf(passphrase: string): keyof typeof NETWORKS | "custom" {
  for (const name of Object.keys(NETWORKS) as Array<keyof typeof NETWORKS>) {
    if (NETWORKS[name].passphrase === passphrase) return name;
  }
  return "custom";
}

/** Convenience helper for callers that only need "is testnet". */
export function isTestnet(passphrase: string): boolean {
  return networkOf(passphrase) === "testnet";
}
