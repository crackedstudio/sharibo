import { describe, it } from "vitest";
import assert from "node:assert";
import { withRetry, computeDelay } from "./retry.js";
import { RpcError, ContractError } from "./errors.js";

// ==============================================================