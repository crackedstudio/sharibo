import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

// Deep-import patterns into packages/client/src/. app/ and scripts/ must only
// consume @sharibo/client via its published entry point — never internal paths.
// See docs/architecture.md for the full layering diagram and rationale.
const deepClientImportPattern = {
  group: ["*/packages/client/src*", "**/packages/client/src*"],
  message:
    "Import from '@sharibo/client' (the package entry point) instead of a deep packages/client/src/... path. " +
    "See docs/architecture.md.",
};

const deepCoreImportPattern = {
  group: ["*/packages/core/src*", "**/packages/core/src*"],
  message:
    "Import from '@sharibo/core' (the package entry point) instead of a deep packages/core/src/... path. " +
    "See docs/architecture.md.",
};

export default tseslint.config(
  {
    // Build outputs / generated artifacts — never lint these.
    ignores: ["**/dist/", "circuits/build/", "app/public/circuits/"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommended],
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "no-redeclare": "off",
      "@typescript-eslint/no-redeclare": ["error", { "ignoreDeclarationMerge": false }]
    },
  },

  // packages/client + packages/core + scripts: plain TypeScript, runs under Node.
  {
    files: ["packages/client/**/*.ts", "packages/core/**/*.ts", "scripts/**/*.ts"],
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
            deepCoreImportPattern,
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

  // packages/core: pure crypto, no external dependencies, no I/O.
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["*/app/*", "**/app/*"],
              message: "packages/core must not import from app/. See docs/architecture.md.",
            },
            {
              group: ["*/scripts/*", "**/scripts/*"],
              message: "packages/core must not import from scripts/. See docs/architecture.md.",
            },
            {
              group: ["*/packages/client/*", "**/packages/client/*", "@sharibo/client*"],
              message: "packages/core must not import from packages/client/. See docs/architecture.md.",
            }
          ],
          paths: [
            {
              name: "@stellar/stellar-sdk",
              message: "packages/core is pure crypto and must not import the chain SDK. See docs/architecture.md."
            }
          ]
        },
      ],
    },
  },

  // app: TypeScript + React, runs in the browser.
  {
    files: ["app/**/*.{ts,tsx}", "__mocks__/**/*.ts"],
    extends: [tseslint.configs.recommended],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // app/ must only consume the SDK via its package entry point.
      "no-restricted-imports": ["error", { patterns: [deepClientImportPattern, deepCoreImportPattern] }],
    },
    languageOptions: {
      globals: globals.browser,
    },
  },

  // scripts/: Node e2e/smoke tooling — same deep-import prohibition as app/.
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [deepClientImportPattern, deepCoreImportPattern] }],
    },
  },

  // app/scripts/sync-circuit.mjs: plain Node ESM, not TypeScript.
  {
    files: ["app/scripts/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Maintenance checkers + test-vector generators: plain Node ESM.
  {
    files: ["scripts/maintenance/**/*.mjs", "test-vectors/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Turn off formatting rules that conflict with Prettier
  eslintConfigPrettier,
);