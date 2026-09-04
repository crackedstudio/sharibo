import type { Keypair } from "@stellar/stellar-sdk";
import type { Identity, FeeEstimate } from "@sharibo/client";

export interface Member {
  keypair: Keypair;
  identity: Identity;
  funded: boolean;
  fundHash?: string;
}

export interface ClaimResult {
  recipient: string;
  hash: string;
  /** Actual fee charged for the claim transaction, in stroops. */
  feeCharged?: string;
  /** Pre-flight fee estimate shown before signing. */
  feeEstimate?: FeeEstimate;
}
