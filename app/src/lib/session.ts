/**
 * Session persistence for the testnet demo.
 *
 * The payload intentionally includes throwaway demo secret keys so a browser
 * refresh can resume a circle. Never use this storage format for production
 * keys or real funds; sessionStorage is not a secure key store. See
 * docs/threat-model.md.
 */
export const SESSION_STORAGE_KEY = "sharibo_demo_state";
export const SESSION_VERSION = 1;
const BIGINT_MARKER = "BIGINT::";

export type SessionValue = { version: number; [key: string]: unknown };
export type SessionLoadResult =
  | { ok: true; value: SessionValue }
  | { ok: false; reason: "unavailable" | "corrupt" | "version-mismatch" };

function replacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? BIGINT_MARKER + value.toString() : value;
}

function reviver(_key: string, value: unknown): unknown {
  if (typeof value !== "string" || !value.startsWith(BIGINT_MARKER)) return value;
  const digits = value.slice(BIGINT_MARKER.length);
  return /^-?\d+$/.test(digits) ? BigInt(digits) : value;
}

export function saveSession(value: Record<string, unknown>): boolean {
  try {
    sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ ...value, version: SESSION_VERSION }, replacer),
    );
    return true;
  } catch {
    return false;
  }
}

export function loadSession(): SessionLoadResult {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!raw) return { ok: false, reason: "corrupt" };

  let value: SessionValue;
  try {
    value = JSON.parse(raw, reviver) as SessionValue;
  } catch {
    return { ok: false, reason: "corrupt" };
  }
  if (!value || typeof value !== "object") return { ok: false, reason: "corrupt" };
  if (value.version !== SESSION_VERSION) {
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      /* blocked storage */
    }
    return { ok: false, reason: "version-mismatch" };
  }
  return { ok: true, value };
}

export function clearSession(): boolean {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
