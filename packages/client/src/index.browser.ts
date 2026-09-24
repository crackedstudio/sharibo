/**
 * Browser entry point for @sharibo/client.
 *
 * This is now identical to the default entry: the SDK is headless, and the
 * import-time artifact prefetch that used to live here is gone. Starting the
 * download from inside the barrel meant every consumer that merely *imported*
 * the SDK — including a landing screen that proves nothing — began pulling
 * ~1.5 MB of wasm + zkey. The app now drives it explicitly instead
 * (app/src/components/ArtifactProgress.tsx calls
 * `prefetchMembershipArtifacts()`), which keeps circuit artifacts off the
 * critical path until a user actually starts a circle (issue #300).
 *
 * The `browser` condition in package.json is kept so bundlers that resolve it
 * (Vite, webpack, etc.) still get a browser-safe entry — this file just no
 * longer has browser-only side effects.
 */
export * from "./index.js";
