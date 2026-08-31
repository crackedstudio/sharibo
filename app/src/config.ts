/**
 * Reads and validates all required VITE_* environment variables at module
 * load time.  Import `config` wherever you need the values; import
 * `configError` to check whether the app should render the setup screen.
 */

interface AppConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  testTokenContractId: string;
}

interface ValidationResult {
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

function validate(): ValidationResult {
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
 * Typed, validated config.  Only access this after confirming
 * `configError.length === 0`; otherwise the values are undefined at runtime.
 */
export const config: AppConfig = result.config ?? ({} as AppConfig);

/** Network connection parameters shared by every SDK call. */
export const NETWORK = {
  contractId: config.contractId,
  rpcUrl: config.rpcUrl,
  networkPassphrase: config.networkPassphrase,
};

/** Token contract that funds each round's pot. */
export const TOKEN = config.testTokenContractId;
