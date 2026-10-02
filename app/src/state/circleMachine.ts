import { ContractError, RpcError, ProvingError, InvalidInputError } from "@sharibo/client";
import { FriendbotRetryableError } from "../lib/friendbot.js";
import { config } from "../config.js";
import { checkContractDeployed } from "../lib/testnetHealth.js";

export interface UiError {
  key: string;
  vars?: Record<string, string | number>;
}

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
function isRetryableError(e: unknown): boolean {
  if (e instanceof RpcError) return true;
  if (e instanceof FriendbotRetryableError) return true;
  if (isTerminalError(e)) return false;
  if (isNetworkError(e)) return true;
  return true;
}

// Decodes an error into a user-facing message, distinguishing the situations
// that previously collapsed into one generic string: RPC being unreachable,
// a transaction being rejected by the contract, and proof/input problems.
export function toUiError(e: unknown): UiError {
  if (e instanceof FriendbotRetryableError) {
    return { key: "error.friendbotRateLimit" };
  }
  if (e instanceof RpcError) {
    return { key: "error.rpc" };
  }
  if (e instanceof InvalidInputError) {
    return { key: "error.invalidInput", vars: { message: e.message } };
  }
  if (e instanceof ProvingError) {
    return { key: "error.proving", vars: { message: e.message } };
  }
  if (e instanceof ContractError) {
    const keys: Record<number, string> = {
      1: "error.circleNotFound",
      2: "error.roundNotFunded",
      3: "error.wrongRoundTag",
      4: "error.alreadyClaimed",
      5: "error.invalidProof",
      6: "error.roundFull",
      7: "error.overflow",
      8: "error.circleCancelled",
      9: "error.invalidFeeParams",
      10: "error.invalidCircleParams",
      11: "error.invalidRecipient",
      12: "error.roundNotExpired",
    };
    return e.code && keys[e.code]
      ? { key: keys[e.code] }
      : { key: "error.contract", vars: { message: e.message } };
  }
  if (e instanceof TypeError) {
    return { key: "error.offline" };
  }
  if (e instanceof Error) {
    return { key: "error.raw", vars: { message: e.message } };
  }
  return { key: "error.generic" };
}

// Full diagnosis used by step handlers. It first checks the two situations
// that aren't visible from the thrown error alone:
//   1. the browser is offline (navigator.onLine), and
//   2. the testnet was reset (the contract id no longer resolves, while the
//      RPC itself is healthy).
// Only then falls back to decoding the error itself. Returns the message to
// show plus whether a retry makes sense.
export async function diagnose(e: unknown): Promise<{ message: UiError; retryable: boolean }> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      message: { key: "error.offline" },
      retryable: true,
    };
  }

  try {
    const health = await checkContractDeployed(config.rpcUrl, config.contractId);
    if (!health.ok) {
      return {
        message: {
          key: "error.testnetReset",
          vars: {
            message:
              health.message ??
              "The testnet appears to have been reset and your circle no longer exists.",
          },
        },
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
