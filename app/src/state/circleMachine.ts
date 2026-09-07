import {
  ContractError,
  RpcError,
  ProvingError,
  InvalidInputError,
} from "@sharibo/client";
import { FriendbotRetryableError, FRIEND_BOT_RATE_LIMIT_MESSAGE } from "../lib/friendbot.js";
import { config } from "../config.js";
import { checkContractDeployed } from "../lib/testnetHealth.js";

// Which step failed. The UI uses this to scope the retry action and to
// decide whether retrying is even meaningful (a failed claim, for example,
// can reuse an already-generated proof; a failed create cannot).
export type FailureStep = "start" | "fund" | "claim";

// A modelled failure: enough context for the UI to both explain what went
// wrong and to re-run exactly the action that failed. `retry` carries the
// step's retry closure so the notification (Toaster) never has to know
// which handler to call.
export interface Failure {
  step: FailureStep;
  message: string;
  // Retryable = transient (RPC / network). When false, the failure is
  // terminal and offering a retry would be pointless (e.g. AlreadyClaimed).
  retryable: boolean;
  retry: () => void;
}

// Terminal contract / input rejections that retrying cannot resolve.
function isTerminalError(e: unknown): boolean {
  if (e instanceof InvalidInputError) return true;
  if (e instanceof ProvingError) return true;
  // Any on-chain revert is a logic error, not a transient RPC blip, so it is
  // terminal by default — with AlreadyClaimed / InvalidProof called out
  // explicitly below for message-based detection.
  if (e instanceof ContractError) return true;
  const msg = e instanceof Error ? e.message : "";
  if (/already.?claimed|invalid.?proof/i.test(msg)) return true;
  return false;
}

function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) {
    return /fetch|network|timeout|abort/i.test(e.message);
  }
  const msg = e instanceof Error ? e.message : "";
  return /failed to fetch|network|timeout|econnrefused|etimedout|connection/i.test(msg);
}

// Retryable = transient (RPC, network). Everything else is treated as
// terminal, with AlreadyClaimed / InvalidProof explicitly non-retryable.
// An unrecognized error is optimistically considered retryable so a user
// facing a transient failure still gets a path forward.
export function isRetryableError(e: unknown): boolean {
  if (e instanceof RpcError) return true;
  if (e instanceof FriendbotRetryableError) return true;
  if (isTerminalError(e)) return false;
  if (isNetworkError(e)) return true;
  return true;
}

// Decodes an error into a user-facing message, distinguishing the situations
// that previously collapsed into one generic string: RPC being unreachable,
// a transaction being rejected by the contract, and proof/input problems.
export function toUiError(e: unknown): string {
  if (e instanceof FriendbotRetryableError) {
    return FRIEND_BOT_RATE_LIMIT_MESSAGE;
  }
  if (e instanceof RpcError) {
    return "The Stellar testnet RPC is unreachable or returned an error. This is usually transient — retry in a moment.";
  }
  if (e instanceof InvalidInputError) {
    return `Invalid input: ${(e as Error).message}`;
  }
  if (e instanceof ProvingError) {
    return `Proof generation failed: ${(e as Error).message}`;
  }
  if (e instanceof ContractError) {
    const msg = (e as Error).message;
    if (/already.?claimed/i.test(msg)) {
      return "This nullifier has already claimed in this circle — a replay is rejected on-chain.";
    }
    if (/invalid.?proof/i.test(msg)) {
      return "The proof was rejected by the contract as invalid.";
    }
    return `The transaction was rejected by the contract: ${msg}`;
  }
  if (e instanceof TypeError) {
    return "You appear to be offline or the network request failed. Check your connection and retry.";
  }
  if (e instanceof Error) {
    return e.message;
  }
  return "Something went wrong. Please retry.";
}

// Full diagnosis used by step handlers. It first checks the two situations
// that aren't visible from the thrown error alone:
//   1. the browser is offline (navigator.onLine), and
//   2. the testnet was reset (the contract id no longer resolves, while the
//      RPC itself is healthy).
// Only then falls back to decoding the error itself. Returns the message to
// show plus whether a retry makes sense.
export async function diagnose(e: unknown): Promise<{ message: string; retryable: boolean }> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      message:
        "You're offline — network actions are paused. Reconnect and retry; your circle stays on-chain.",
      retryable: true,
    };
  }

  try {
    const health = await checkContractDeployed(config.rpcUrl, config.contractId);
    if (!health.ok) {
      return {
        message: health.message ?? "The testnet appears to have been reset and your circle no longer exists.",
        retryable: false,
      };
    }
  } catch {
    // The health probe itself failed — don't mask the original error.
  }

  return {
    message: toUiError(e),
    retryable: isRetryableError(e),
  };
}
