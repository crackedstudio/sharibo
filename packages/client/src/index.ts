// No `node:*` imports in this package — all modules run unmodified in both
// Node (18+) and the browser app. If a future addition needs Node-only APIs,
// add a comment guard here and gate it behind a platform check.
export * from "./identity.js";
export * from "./tree.js";
export * from "./prove.js";
export * from "./contract.js";
export * from "./config.js";
export * from "./errors.js";
export { decodeContractError } from "./decodeError.js";

// Re-exported for convenience so consumers can import from "@sharibo/client"
// rather than digging into the contract module.
export { explorerTxUrl } from "./contract.js";

