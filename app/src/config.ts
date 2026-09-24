/**
 * Reads and validates all required VITE_* environment variables at module
 * load time.  Import `config` wherever you need the values; import
 * `configError` to check whether the app should render the setup screen.
 *
 * Failure is honest: `config` is `null` when validation fails, so the type
 * system forces callers to check `configError` (or `config !== null`) before
 * dereferencing it — there is no fake empty object that silently surfaces
 * `undefined` fields at runtime.
 *
 * This module deliberately imports nothing from `@sharibo/client`. It is part
 * of the landing bundle, and the SDK brings snarkjs, Poseidon and the Stellar
 * SDK with it — importing the SDK here would put all of that back on the
 * critical path for a screen that never proves anything (issue #300).
 * `scripts/check-bundle-budget.mjs` fails the build if that ever regresses.
 */

export interface AppConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  testTokenContractId: string;
}

export interface ValidationResult {
  config: AppConfig | null;
  /** Human-readable lines describing every problem found. */
  errors: string[];
}

function isContractId(value: string): boolean {
  // Stellar contract IDs start with 'C' and are 56 characters long.
  return /^C[A-Z2-7]{55}$/.test(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function validate(): ValidationResult {
  const errors: string[] = [];

  const contractId = import.meta.env.VITE_SHARIBO_CONTRACT_ID as string | undefined;
  const rpcUrl = import.meta.env.VITE_STELLAR_RPC_URL as string | undefined;
  const networkPassphrase = import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE as string | undefined;
  const testTokenContractId = import.meta.env.VITE_TEST_TOKEN_CONTRACT_ID as string | undefined;

  if (!contractId) {
    errors.push("VITE_SHARIBO_CONTRACT_ID — missing or empty");
  } else if (!isContractId(contractId)) {
    errors.push(
      `VITE_SHARIBO_CONTRACT_ID — invalid shape (got "${contractId}"; expected a 56-character Stellar contract ID starting with 'C')`,
    );
  }

  if (!rpcUrl) {
    errors.push("VITE_STELLAR_RPC_URL — missing or empty");
  } else if (!isHttpUrl(rpcUrl)) {
    errors.push(`VITE_STELLAR_RPC_URL — invalid URL (got "${rpcUrl}"; expected an http/https URL)`);
  }

  if (!networkPassphrase) {
    errors.push("VITE_STELLAR_NETWORK_PASSPHRASE — missing or empty");
  }

  if (!testTokenContractId) {
    errors.push("VITE_TEST_TOKEN_CONTRACT_ID — missing or empty");
  } else if (!isContractId(testTokenContractId)) {
    errors.push(
      `VITE_TEST_TOKEN_CONTRACT_ID — invalid shape (got "${testTokenContractId}"; expected a 56-character Stellar contract ID starting with 'C')`,
    );
  }

  if (errors.length > 0) {
    return { config: null, errors };
  }

  return {
    config: {
      contractId: contractId!,
      rpcUrl: rpcUrl!,
      networkPassphrase: networkPassphrase!,
      testTokenContractId: testTokenContractId!,
    },
    errors: [],
  };
}

const result = validate();

export const configError: string[] = result.errors;

/**
 * Validated config, or `null` when validation failed.
 *
 * When validation fails (`configError` is non-empty) this is `null`, so it is
 * an actual runtime error to use it before checking the gate — the type
 * system enforces the setup-screen check instead of pretending.
 */
export const config: AppConfig | null = result.config;

/** Network connection parameters shared by every SDK call. */
export const NETWORK = {
  contractId: config?.contractId ?? "",
  rpcUrl: config?.rpcUrl ?? "",
  networkPassphrase: config?.networkPassphrase ?? "",
};

/** Token contract that funds each round's pot. */
export const TOKEN = config?.testTokenContractId ?? "";
