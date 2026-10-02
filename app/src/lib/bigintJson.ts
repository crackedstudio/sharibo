const BIGINT_MARKER = "BIGINT::";

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return BIGINT_MARKER + value.toString();
  }
  if (typeof value === "string" && value.startsWith(BIGINT_MARKER)) {
    return BIGINT_MARKER + value;
  }
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (typeof value === "string" && value.startsWith(BIGINT_MARKER)) {
    const rest = value.slice(BIGINT_MARKER.length);
    if (rest.startsWith(BIGINT_MARKER)) {
      return rest;
    }
    return BigInt(rest);
  }
  return value;
}

export function stringify(value: unknown): string {
  return JSON.stringify(value, replacer);
}

export function parse(text: string): unknown {
  return JSON.parse(text, reviver);
}
