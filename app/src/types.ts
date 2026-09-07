import type { Keypair } from "@stellar/stellar-sdk";
import type { Identity, FeeEstimate } from "@sharibo/client";

export interface Member {
  keypair: Keypair;
  identity: Identity;
  funded: boolean;
  fundHash?: string;
  ineligible?: boolean;
  ineligibleReason?: string;
  /** Optimistic flag while this member's funding transaction is in flight. */
  pending?: boolean;
}

export interface ClaimResult {
  recipient: string;
  hash: string;
  /** Actual fee charged for the claim transaction, in stroops. */
  feeCharged?: string;
  /** Pre-flight fee estimate shown before signing. */
  feeEstimate?: FeeEstimate;
}

/** The visible stages of a claim, in the order they actually occur. */
export type ClaimStage = "artifacts" | "proving" | "verifying" | "funding" | "submitting";
