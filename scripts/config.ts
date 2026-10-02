import { NETWORKS } from "@sharibo/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Exported typed configuration loaded from the repo-root .env file.
 *
 * Every required variable is validated **before** any network call so that
 * a missing or malformed value surfaces as a single aggregated error with
 * _all_ problems listed at once, pointing at `.env.example`.
 */
export interface ScriptConfig {
  stellarRpcUrl: string;
  stellarNetworkPassphrase: string;
  testTokenContractId: string;
  shariboContractId: string;
  adminSecretKey: string;
}

// ---- Helpers ----

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Which env file to read. Defaults to the repo-root `.env`.
 *
 * `SHARIBO_ENV_FILE` exists so the test suite can point at a throwaway fixture
 * instead of mutating (and racing on) the developer's real `.env` — two test
 * files writing the same path concurrently is exactly the kind of shared
 * mutable state that makes a suite non-hermetic and unrunnable in parallel.
 * Unset in normal use, so behaviour is unchanged.
 */
function envFilePath(): string {
  return process.env.SHARIBO_ENV_FILE || path.join(repoRoot, ".env");
}

function loadEnv(): Record<string, string | undefined> {
  const envPath = envFilePath();
  // process.loadEnvFile is available in Node 21.7+ / 22+.
  // For broader compat we load the file manually.
  try {
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      // Only set if not already present (environment variables take precedence).
      if (key && !(key in process.env)) {
        let value = trimmed.slice(eq + 1).trim();
        // Strip optional surrounding quotes.
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    }
  } catch {
    // .env file missing — process.env fallback below handles it.
  }
  return process.env as Record<string, string | undefined>;
}

function isNonEmpty(s: string | undefined): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

function isValidUrl(s: string): boolean {
  try {
    const url = new URL(s);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Stellar StrKey validation — checks the expected prefix character and length.
 * For contract IDs the prefix is 'C', for secret keys it's 'S'.
 */
function isValidStrKey(s: string, expectedPrefix: "C" | "S"): boolean {
  return s.length === 56 && s.startsWith(expectedPrefix);
}

interface ValidationRule {
  key: string;
  label: string;
  validate: (value: string | undefined) => string | null; // null = ok, string = error msg
}

const rules: ValidationRule[] = [
  {
    key: "STELLAR_RPC_URL",
    label: "STELLAR_RPC_URL",
    validate: (v) => {
      // A missing/blank RPC URL must fail loudly rather than silently
      // falling through to the `NETWORKS.testnet.rpcUrl` default below —
      // running a whole e2e round against the wrong network because someone
      // left the variable blank is exactly the class of bug this validator
      // exists to prevent.
      if (!isNonEmpty(v)) return "is missing or empty";
      if (!isValidUrl(v)) return `"${v}" is not a valid HTTP(S) URL`;
      return null;
    },
  },
  {
    key: "STELLAR_NETWORK_PASSPHRASE",
    label: "STELLAR_NETWORK_PASSPHRASE",
    // Any non-empty value is accepted (no shape check): the passphrase is
    // network-specific and can legitimately change, so only presence is
    // validated. As with STELLAR_RPC_URL, blank must not silently fall back
    // to the testnet default.
    validate: (v) => (isNonEmpty(v) ? null : "is missing or empty"),
  },
  {
    key: "TEST_TOKEN_CONTRACT_ID",
    label: "TEST_TOKEN_CONTRACT_ID",
    validate: (v) => {
      if (!isNonEmpty(v)) return "is missing or empty";
      if (!isValidStrKey(v, "C"))
        return `"${v}" is not a valid Stellar contract ID (should start with 'C' and be 56 characters)`;
      return null;
    },
  },
  {
    key: "SHARIBO_CONTRACT_ID",
    label: "SHARIBO_CONTRACT_ID",
    validate: (v) => {
      if (!isNonEmpty(v)) return "is missing or empty";
      if (!isValidStrKey(v, "C"))
        return `"${v}" is not a valid Stellar contract ID (should start with 'C' and be 56 characters)`;
      return null;
    },
  },
  {
    key: "ADMIN_SECRET_KEY",
    label: "ADMIN_SECRET_KEY",
    validate: (v) => {
      if (!isNonEmpty(v)) return "is missing or empty";
      if (!isValidStrKey(v, "S"))
        return "is not a valid Stellar secret key (should start with 'S' and be 56 characters)";
      return null;
    },
  },
];

// ---- Load & validate ----

export function validate(env: Record<string, string | undefined>) {
  const errors: string[] = [];

  for (const rule of rules) {
    const value = env[rule.key];
    const err = rule.validate(value);
    if (err !== null) {
      errors.push(`  - ${rule.label}: ${err}`);
    }
  }

  if (errors.length > 0) {
    return { config: null, errors };
  }

  return {
    config: {
      stellarRpcUrl: env.STELLAR_RPC_URL || NETWORKS.testnet.rpcUrl,
      stellarNetworkPassphrase: env.STELLAR_NETWORK_PASSPHRASE || NETWORKS.testnet.passphrase,
      testTokenContractId: env.TEST_TOKEN_CONTRACT_ID!,
      shariboContractId: env.SHARIBO_CONTRACT_ID!,
      adminSecretKey: env.ADMIN_SECRET_KEY!,
    } as ScriptConfig,
    errors: [],
  };
}

function loadConfig(): ScriptConfig {
  loadEnv();

  const { config, errors } = validate(process.env);

  if (errors.length > 0) {
    const aggregated = [
      `Environment validation failed for ${errors.length} variable(s):`,
      ...errors,
      "",
      "Fill in the missing values in .env (copy from .env.example) and try again.",
      "See scripts/config.ts for the full list of required variables and their expected formats.",
    ].join("\n");
    throw new Error(aggregated);
  }

  return config!;
}

// Singleton — loaded once on first import, validated eagerly.
export const config: ScriptConfig = loadConfig();
