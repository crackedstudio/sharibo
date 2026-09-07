import { rpc as StellarRpc, Address, xdr } from "@stellar/stellar-sdk";

export interface TestnetResetCheckResult {
  ok: boolean;
  message?: string;
}

// Stellar testnet resets periodically wipe every deployed contract. When
// that happens, a stale SHARIBO_CONTRACT_ID in .env dangles and the first
// real contract call fails with whatever raw RPC error it happens to throw.
// This probes cheaply (one getHealth + one getLedgerEntries call, no signing
// or auth) so callers can print actionable guidance before that happens.
// Shared so any script targeting the same contract (e2e, a future smoke
// test) gets the same detection and message.
export async function checkContractDeployed(
  rpcUrl: string,
  contractId: string,
): Promise<TestnetResetCheckResult> {
  const server = new StellarRpc.Server(rpcUrl);

  try {
    await server.getHealth();
  } catch {
    // RPC itself is unreachable/unhealthy — a different problem than a
    // testnet reset; let the caller's own network calls surface that.
    return { ok: true };
  }

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

  return {
    ok: false,
    message:
      `Contract ${contractId} was not found, but RPC (${rpcUrl}) reports healthy.\n` +
      "This usually means the Stellar testnet was reset and every deployed\n" +
      "contract was wiped — not a bug in this script.\n\n" +
      "Full recovery steps: docs/runbook-testnet-reset.md",
  };
}
