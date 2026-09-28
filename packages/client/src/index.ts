// No `node:*` imports in this package — all modules run unmodified in both
// Node (18+) and the browser app. If a future addition needs Node-only APIs,
// add a comment guard here and gate it behind a platform check.
//
// NOTE: every export below is named explicitly (no star re-exports). The
// barrel is the public API contract: `src/index.test.ts` asserts that, and
// that its value exports exactly match the "Values" list in README.md;
// `api-surface.json` snapshots the full surface. Add new exports here
// deliberately, with README + snapshot updated alongside.
// Artifact *prefetch machinery* is intentionally absent: it lives behind the
// `./internal` subpath (see internal.ts) so importing the barrel never
// triggers downloads. Only the side-effect-free configuration API is here.
export {
  STROOPS_PER_XLM,
  xlmToStroops,
  stroopsToXlm,
  formatXlm,
} from "./amount.js";
export {
  FR_MODULUS,
  randomFieldElement,
  poseidon,
  generateIdentity,
  computeExternalNullifier,
  computeRecipientHash,
  computeNullifierHash,
  type Identity,
} from "./identity.js";
export { ZERO_VALUE, MerkleTree, type MerkleProof } from "./tree.js";
export {
  getArtifacts,
  verificationKeyToContractFormat,
  validateCircuitInput,
  encodeG1,
  encodeG2,
  generateProof,
  verifyProofLocally,
  fullProve,
  prove,
  FP_BYTES,
  feToBytes,
  g1ToBytes,
  g2ToBytes,
  type ProveOptions,
  type CircuitInput,
  type ContractProof,
  type ContractVerificationKey,
  type GenerateProofResult,
  type ProofResult,
} from "./prove.js";
export {
  validateContractProof,
  validateContractVerificationKey,
} from "./validate.js";
export {
  resolveSigner,
  clearContractClientCache,
  connect,
  connectReadOnly,
  EXPLORER_NETWORKS,
  explorerTxUrl,
  estimateClaimFee,
  createCircle,
  fund,
  claim,
  getCircle,
  getCircleStatus,
  getCircleCount,
  getRound,
  getPot,
  getStatus,
  getContributors,
  hasClaimed,
  cancelCircle,
  type ShariboNetworkConfig,
  type ShariboClient,
  type ShariboSigner,
  type ResolvedSigner,
  type FeeEstimate,
  type TxResult,
  type CircleView,
  type CircleStatus,
} from "./contract.js";
export { SdkEventEmitter, type SdkEvent, type OnEventFn } from "./events.js";
export {
  NETWORKS,
  networkOf,
  isTestnet,
  type NetworkPreset,
} from "./networks.js";
export { TREE_LEVELS, MAX_CIRCLE_SIZE } from "./config.js";
export {
  ShariboError,
  InvalidInputError,
  ProvingError,
  RpcError,
  ContractError,
  CircleNotFoundError,
  RoundNotFundedError,
  WrongRoundTagError,
  AlreadyClaimedError,
  InvalidProofError,
  RoundFullError,
  OverflowError,
  CircleCancelledError,
  describeContractError,
  parseContractErrorCode,
  describeError,
  type ContractErrorDescription,
} from "./errors.js";
export { decodeContractError } from "./decodeError.js";
export { DEFAULT_RETRY_POLICY, withRetry, type RetryPolicy } from "./retry.js";
export {
  ShariboSDK,
  type ShariboSDKOptions,
  type CreateCircleArgs,
  type FundArgs,
  type ClaimArgs,
} from "./sdk.js";
export { makeCircleId, type Brand, type CircleId } from "./brand.js";
export {
  configureArtifacts,
  getArtifactsConfig,
  resetArtifactsConfig,
  type ArtifactsConfig,
  type ProverArtifacts,
  type ArtifactPrefetchStatus,
  type ArtifactPrefetchProgress,
} from "./artifacts.js";
