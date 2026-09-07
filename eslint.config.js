import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// Deep-import patterns into packages/client/src/. app/ and scripts/ must only
// consume @sharibo/client via its published entry point — never internal paths.
// See docs/architecture.md for the full layering diagram and rationale.
const deepClientImportPattern = {
  group: ["*/packages/client/src*", "**/packages/client/src*"],
  message:
    "Import from '@sharibo/client' (the package entry point) instead of a deep packages/client/src/... path. " +
    "See docs/architecture.md.",
};

export default tseslint.config(
  {
    // Build outputs / generated artifacts — never lint these.
    ignores: ["**/dist/", "circuits/build/", "app/public/circuits/"],
    rules: {
      "no-unused-vars": "error",
      "@typescript-eslint/no-unused-vars": "error"
    },
  },

  // packages/client + scripts: plain TypeScript, runs under Node.
  {
    files: ["packages/client/**/*.ts", "scripts/**/*.ts"],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "error",
      // The SDK must not import app/ (browser-only) or scripts/ (node e2e tooling).
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["*/app/*", "**/app/*"],
              message:
                "packages/client must not import from app/. See docs/architecture.md.",
            },
            {
              group: ["*/scripts/*", "**/scripts/*"],
              message:
                "packages/client must not import from scripts/. See docs/architecture.md.",
            },
          ],
        },
      ],
    },
  },

  // app: TypeScript + React, runs in the browser.
  {
    files: ["app/**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommended],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // app/ must only consume the SDK via its package entry point.
      "no-restricted-imports": ["error", { patterns: [deepClientImportPattern] }],
    },
    languageOptions: {
      globals: globals.browser,
    },
  },

  // scripts/: Node e2e/smoke tooling — same deep-import prohibition as app/.
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [deepClientImportPattern] }],
    },
  },

  // app/scripts/sync-circuit.mjs: plain Node ESM, not TypeScript.
  {
    files: ["app/scripts/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
);