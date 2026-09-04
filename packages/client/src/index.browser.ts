/**
 * Browser entry point for @sharibo/client.
 *
 * Identical to the default index, plus two browser-only side effects:
 *  - installIndicator: mounts the "Preparing prover…" DOM toast.
 *  - prefetchMembershipArtifacts: starts downloading wasm + zkey in the
 *    background so they're ready when the user clicks "Claim".
 *
 * Bundlers that honour the "browser" exports condition (Vite, webpack, etc.)
 * will resolve @sharibo/client to this file automatically. Node and test
 * runners get index.ts instead, which has no DOM or network side effects.
 */
export * from "./index.js";
import { installIndicatorAndPrefetch } from "./artifacts.js";
installIndicatorAndPrefetch();
