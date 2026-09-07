import { NETWORKS } from "@sharibo/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { NETWORKS } from "@sharibo/client";

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

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function loadEnv(): Record<string, string | undefined> {
  const envPath = path.join(repoRoot, ".env");
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
      if (v && !isValidUrl(v)) return `"${v}" is not a valid HTTP(S) URL`;
      return null;
    },
  },
  {
    key: "STELLAR_NETWORK_PASSPHRASE",
    label: "STELLAR_NETWORK_PASSPHRASE",
    validate: (v) => null,
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

function loadConfig(): ScriptConfig {
  loadEnv();

  const errors: string[] = [];

  for (const rule of rules) {
    const value = process.env[rule.key];
    const err = rule.validate(value);
    if (err !== null) {
      errors.push(`  - ${rule.label}: ${err}`);
    }
  }

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

  return {
    stellarRpcUrl: process.env.STELLAR_RPC_URL || NETWORKS.testnet.rpcUrl,
    stellarNetworkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE || NETWORKS.testnet.passphrase,
    testTokenContractId: process.env.TEST_TOKEN_CONTRACT_ID!,
    shariboContractId: process.env.SHARIBO_CONTRACT_ID!,
    adminSecretKey: process.env.ADMIN_SECRET_KEY!,
  };
}

// Singleton — loaded once on first import, validated eagerly.
export const config: ScriptConfig = loadConfig();
