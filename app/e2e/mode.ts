/**
 * Mode selection and safety rules for the browser e2e suite.
 *
 * Pure on purpose (no Node, Playwright or Vite imports) so the Playwright
 * config, the fixtures and a plain vitest unit test can all share it.
 *
 * Two modes:
 *   - "mock" (default): the SDK's network calls are replaced by an in-memory
 *     chain and Friendbot is stubbed. Proving is still real (real wasm + zkey
 *     in a real browser). Spends nothing.
 *   - "live": talks to real testnet + Friendbot. Only ever selected by the
 *     exact opt-in `E2E_LIVE=1`.
 */

export type E2EMode = "mock" | "live";

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

/** Dedicated ports so a stray dev server can never be mistaken for ours. */
export const PORTS: Record<E2EMode, number> = { mock: 5199, live: 5198 };

const DUMMY_CONTRACT_ID = `C${"A".repeat(55)}`;

/**
 * App env for mock mode. The RPC host uses the reserved `.invalid` TLD, which
 * can never resolve — so even if the mock layer failed to load, the app could
 * not reach a real network by accident.
 */
export const MOCK_APP_ENV = {
  VITE_SHARIBO_CONTRACT_ID: DUMMY_CONTRACT_ID,
  VITE_TEST_TOKEN_CONTRACT_ID: DUMMY_CONTRACT_ID,
  VITE_STELLAR_RPC_URL: "https://rpc.mock.invalid",
  VITE_STELLAR_NETWORK_PASSPHRASE: TESTNET_PASSPHRASE,
} as const;

/**
 * Live mode is opt-in, and only the exact string "1" counts. "true", "yes",
 * "0", "" and unset all resolve to mock.
 */
export function resolveMode(env: Record<string, string | undefined>): E2EMode {
  return env.E2E_LIVE === "1" ? "live" : "mock";
}

const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;

/**
 * Everything that must be true before a live run is allowed to start.
 * Returns human-readable problems; an empty array means "safe to proceed".
 */
export function liveConfigProblems(appEnv: Record<string, string | undefined>): string[] {
  const problems: string[] = [];

  for (const key of ["VITE_SHARIBO_CONTRACT_ID", "VITE_TEST_TOKEN_CONTRACT_ID"] as const) {
    const value = appEnv[key];
    if (!value) {
      problems.push(`${key} is not set (put it in app/.env or export it).`);
    } else if (!CONTRACT_ID_RE.test(value)) {
      problems.push(`${key} is not a valid 56-character contract ID.`);
    } else if (value === DUMMY_CONTRACT_ID) {
      problems.push(`${key} is the all-A placeholder used by the mock — deploy a real one.`);
    }
  }

  // The app's own default is testnet when this is unset. Anything else is
  // refused: Friendbot only exists on testnet, and a live run must never be
  // pointed at a network where the funds are real.
  const passphrase = appEnv.VITE_STELLAR_NETWORK_PASSPHRASE ?? TESTNET_PASSPHRASE;
  if (passphrase !== TESTNET_PASSPHRASE) {
    problems.push(
      `VITE_STELLAR_NETWORK_PASSPHRASE is "${passphrase}". Live e2e runs against testnet only.`,
    );
  }

  return problems;
}
