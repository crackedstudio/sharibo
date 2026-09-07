// No `node:*` imports in this package — all modules run unmodified in both
// Node (18+) and the browser app. If a future addition needs Node-only APIs,
// add a comment guard here and gate it behind a platform check.
export * from "./amount.js";
export * from "./identity.js";
export * from "./tree.js";
export * from "./prove.js";
export * from "./validate.js";
export * from "./contract.js";
export * from "./identity.js";
export * from "./prove.js";
export * from "./tree.js";
export * from "./events.js";
export * from "./networks.js";
export * from "./config.js";
export * from "./errors.js";
export * from "./artifacts.js";
export { decodeContractError } from "./decodeError.js";
export * from "./retry.js";
export * from "./events.js";
export * from "./sdk.js";

// SDK-specific error classes (base types come from @sharibo/core).
export {
  ProvingError,
  RpcError,
  ContractError,
} from "./errors.js";
export * from "./brand.js";

// Re-exported for convenience so consumers can import from "@sharibo/client"
// rather than digging into the contract module.
export { explorerTxUrl } from "./contract.js";
export * from "./networks.js";
