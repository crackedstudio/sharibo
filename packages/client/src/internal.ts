/**
 * @internal
 *
 * Internal-only, low-level helpers that are deliberately **not** part of the
 * public `@sharibo/client` API. They live behind the package's `./internal`
 * subpath (see `package.json` `exports`) so they remain importable for deep
 * integration work without leaking through the main barrel — importing them is
 * an explicit opt-in, never something the main entrypoint pulls in.
 *
 * Keep public API surface decisions in `index.ts`; anything listed here must
 * not be re-exported from the main entrypoint.
 */

export { FR_MODULUS } from "./identity.js";

// Artifact prefetch machinery. Note: `./artifacts.js` has import-time side
// effects (it installs a status indicator and starts prefetching on module
// load). By confining it to the `./internal` subpath, plain `@sharibo/client`
// consumers never trigger those side effects. See `prove.ts` for the
// side-effect-free `generateProof` API.
export {
  MEMBERSHIP_WASM_URL,
  MEMBERSHIP_ZKEY_URL,
  prefetchMembershipArtifacts,
  getArtifactPrefetchProgress,
  subscribeToArtifactPrefetch,
  type ArtifactPrefetchStatus,
  type ArtifactPrefetchProgress,
  type ProverArtifacts,
} from "./artifacts.js";