import { rpc as StellarRpc, Address, xdr } from "@stellar/stellar-sdk";

export interface TestnetResetCheckResult {
  ok: boolean;
  message?: string;
}

// Recovery instructions shown when the testnet has been reset. Mirrors the
// logic in scripts/testnet-health.ts (and the e2e script that consumes it) so
// the app names the same cause and points at the same fix.
export const TESTNET_RESET_MESSAGE = (contractId: string): string =>
  `The Stellar testnet contract (${contractId}) was not found, but the RPC reports healthy.\n` +
  "This usually means the testnet was reset and every deployed contract was wiped — not a bug in the app.\n\n" +
  "To recover:\n" +
  "  1. Redeploy the Sharibo contract (see README, “Run it” → “3. Contract”).\n" +
  "  2. Paste the new contract id into your .env as SHARIBO_CONTRACT_ID and refresh.\n" +
  "  3. Start a new circle.";

// Probes cheaply whether the SHARIBO contract still exists on the RPC. One
// getHealth + one getLedgerEntries call — no signing or auth. Returns ok:false
// only when the RPC is healthy but the contract instance no longer resolves,
// which is the signature of a testnet reset.
export async function checkContractDeployed(
  rpcUrl: string,
  contractId: string,
): Promise<TestnetResetCheckResult> {
  const server = new StellarRpc.Server(rpcUrl);

  try {
    await server.getHealth();
  } catch {
    // RPC itself is unreachable/unhealthy — a different problem than a reset;
    // let the caller's own network calls surface that.
    return { ok: true };
  }

  try {
    const key = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: new Address(contractId).toScAddress(),
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    );
    const { entries } = await server.getLedgerEntries(key);
    if (entries && entries.length > 0) {
      return { ok: true };
    }
    return { ok: false, message: TESTNET_RESET_MESSAGE(contractId) };
  } catch {
    // If the probe itself errors, don't mask the original failure.
    return { ok: true };
  }
}
