export type CapabilityIssue =
  | "webassembly"
  | "bigint"
  | "crypto.subtle"
  | "secure-context";

export interface CapabilityReport {
  ok: boolean;
  missing: CapabilityIssue[];
  details: string[];
}

const ISSUE_MESSAGES: Record<CapabilityIssue, string> = {
  webassembly: "WebAssembly is required to load the proving circuit in the browser.",
  bigint: "BigInt support is required for the cryptographic arithmetic used during proof generation.",
  "crypto.subtle": "Web Crypto (crypto.subtle) is required to compute the claim nullifier securely.",
  "secure-context":
    "This app must be opened over HTTPS or localhost. Plain HTTP on a LAN IP is not supported because the browser crypto APIs require a secure context.",
};

export function getCapabilityReport(): CapabilityReport {
  const missing: CapabilityIssue[] = [];

  if (typeof WebAssembly === "undefined") {
    missing.push("webassembly");
  }

  if (typeof BigInt === "undefined") {
    missing.push("bigint");
  }

  if (typeof crypto === "undefined" || !crypto.subtle) {
    missing.push("crypto.subtle");
  }

  if (typeof window !== "undefined" && window.isSecureContext === false) {
    missing.push("secure-context");
  }

  return {
    ok: missing.length === 0,
    missing,
    details: missing.map((issue) => ISSUE_MESSAGES[issue]),
  };
}
