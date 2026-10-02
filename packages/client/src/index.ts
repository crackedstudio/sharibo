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
export {
  MEMBERSHIP_WASM_URL,
  MEMBERSHIP_ZKEY_URL,
  configureArtifacts,
  getArtifactsConfig,
  resetArtifactsConfig,
  startArtifactPrefetch,
  subscribeToArtifactPrefetch,
  type ArtifactPrefetchStatus,
  type ArtifactPrefetchProgress,
  type ProverArtifacts,
} from "./artifacts.js";
export { decodeContractError } from "./decodeError.js";
export * from "./retry.js";
export * from "./events.js";
export * from "./sdk.js";

// SDK-specific error classes (base types come from @sharibo/core).
export { MAX_CIRCLE_SIZE, TREE_LEVELS } from "./config.js";
export {
  AlreadyClaimedError,
  CircleCancelledError,
  CircleNotFoundError,
  ContractError,
  InvalidInputError,
  InvalidProofError,
  OverflowError,
  ProvingError,
  RoundFullError,
  RoundNotFundedError,
  RpcError,
  ShariboError,
  WrongRoundTagError,
  describeContractError,
  describeError,
  parseContractErrorCode,
} from "./errors.js";
export { configureArtifacts } from "./artifacts.js";
export { decodeContractError } from "./decodeError.js";
export {
  DEFAULT_RETRY_POLICY,
  PATIENT_RETRY_POLICY,
  POLL_RETRY_POLICY,
  computeDelay,
  withRetry,
} from "./retry.js";
export { ShariboSDK } from "./sdk.js";
export { makeCircleId } from "./brand.js";

// Types
export type * from "./amount.js";
export type * from "./identity.js";
export type * from "./tree.js";
export type * from "./prove.js";
export type * from "./validate.js";
export type * from "./contract.js";
export type * from "./events.js";
export type * from "./networks.js";
export type * from "./config.js";
export type * from "./errors.js";
export type * from "./retry.js";
export type * from "./sdk.js";
export type * from "./brand.js";
