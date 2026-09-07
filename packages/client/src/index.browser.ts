/**
 * Browser entry point for @sharibo/client.
 *
 * Identical to the default index, plus one browser-only side effect:
 *  - prefetchMembershipArtifacts: starts downloading wasm + zkey in the
 *    background so they're ready when the user clicks "Claim".
 *
 * The "Preparing prover…" indicator now lives in the app (ArtifactProgress),
 * driven by subscribeToArtifactPrefetch — the SDK no longer touches the DOM.
 *
 * Bundlers that honour the "browser" exports condition (Vite, webpack, etc.)
 * will resolve @sharibo/client to this file automatically. Node and test
 * runners get index.ts instead, which has no DOM or network side effects.
 */
export * from "./index.js";
import { prefetchMembershipArtifacts } from "./artifacts.js";
prefetchMembershipArtifacts().catch(() => {
  // Errors are surfaced through subscribeToArtifactPrefetch; swallow here so
  // an unhandled rejection doesn't abort the page.
});
