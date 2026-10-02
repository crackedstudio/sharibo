// Extend Vitest's expect with @testing-library/jest-dom matchers
// (toBeInTheDocument, toHaveTextContent, toBeDisabled, etc.).
// Imported here via vitest.config.ts → test.setupFiles so every test file
// gets these matchers automatically without a per-file import.
import "@testing-library/jest-dom";
import { expect } from "vitest";
import { createRequire } from "node:module";

// Registers `toHaveNoViolations()` for the a11y guards in a11y.test.tsx.
//
// Two packaging problems in vitest-axe 0.1.0 are worked around here, both of
// which otherwise make the matcher unusable:
//
//   1. The documented auto-import entrypoint (`vitest-axe/extend-expect`)
//      compiles to an *empty* module at runtime, so it registers nothing.
//      The matcher has to be extended by hand.
//   2. `vitest-axe/matchers` re-declares the runtime function with
//      `export type *`, so a static `import` of it is a type error
//      ("cannot be used as a value because it was exported using
//      'export type'"). It is loaded through createRequire instead.
//
// The Assertion type augmentation that makes the matcher visible to
// TypeScript is declared separately in src/vitest-axe.d.ts, because the
// package's own copy of it does not reach this program.
const nodeRequire = createRequire(import.meta.url);
const { toHaveNoViolations } = nodeRequire("vitest-axe/matchers") as {
  toHaveNoViolations: (results: unknown) => { pass: boolean; message: () => string };
};

// The matcher is exported as a bare function, so it has to be wrapped in the
// { name: fn } shape expect.extend() actually accepts — passing the function
// directly registers nothing and every call site then fails with
// "Invalid Chai property: toHaveNoViolations".
expect.extend({ toHaveNoViolations });

// ── localStorage shim ────────────────────────────────────────────────────────
//
// Node >= 22 ships an experimental global `localStorage` that is backed by a
// file the runtime must be told about (`--localstorage-file`). Under vitest's
// jsdom environment `window === globalThis`, and Node's getter wins the name,
// so `localStorage` reads back as `undefined` — the browser-global jsdom
// installs is shadowed. Tests that call `localStorage.clear()` in a
// beforeEach then throw "Cannot read properties of undefined", and any code
// under test that reads the persisted locale (#298) silently sees nothing.
//
// `sessionStorage` is unaffected, which is what makes the shadowing easy to
// miss. Installing a Web Storage–shaped object here fixes it centrally, so no
// individual test file has to be rewritten to use `window.localStorage`.
class MemoryStorage implements Storage {
  #entries = new Map<string, string>();

  get length(): number {
    return this.#entries.size;
  }

  key(index: number): string | null {
    return [...this.#entries.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.#entries.has(String(key)) ? this.#entries.get(String(key))! : null;
  }

  setItem(key: string, value: string): void {
    this.#entries.set(String(key), String(value));
  }

  removeItem(key: string): void {
    this.#entries.delete(String(key));
  }

  clear(): void {
    this.#entries.clear();
  }
}

const localStorageShim = new MemoryStorage();

// The property is an accessor on globalThis, so it has to be redefined rather
// than assigned. `configurable: true` keeps it replaceable if a future runtime
// makes the native implementation available again.
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageShim,
  configurable: true,
  writable: true,
});

// Tests that need a pristine store between cases call `localStorage.clear()`
// themselves; this makes the default deterministic within a file.
if (!("__shariboLocalStorageShim" in globalThis)) {
  (globalThis as unknown as { __shariboLocalStorageShim: boolean }).__shariboLocalStorageShim =
    true;
  localStorageShim.clear();
}
