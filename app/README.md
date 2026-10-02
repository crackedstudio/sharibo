# Sharibo app

React + Vite browser demo for Sharibo: real Groth16 proofs in the browser, real Soroban testnet transactions.

Live deployment: see [docs/deployment.md](../docs/deployment.md).

## Setup (fresh clone)

From the **repository root**:

```bash
npm install

# The app imports @sharibo/client from its built dist/ (main: ./dist/index.js).
# dist/ is gitignored — build the SDK before the app can resolve it.
npm run build --workspace=packages/client

cp app/.env.example app/.env
# Fill VITE_SHARIBO_CONTRACT_ID and VITE_TEST_TOKEN_CONTRACT_ID (56-char C… IDs).
# RPC URL and network passphrase have safe testnet defaults if left as in .env.example.
```

### Circuit artifacts

The app serves these from `app/public/circuits/`:

- `membership.wasm`
- `membership_final.zkey`
- `verification_key.json`

Build them once from the repo root:

```bash
cd circuits
npm run compile
npm run setup
cd ..
```

`scripts/sync-circuit.mjs` copies those files into `app/public/circuits/`. If sources are missing, it exits with an error telling you to compile/setup first.

### Environment validation

`app/src/config.ts` validates all four `VITE_*` variables (contract IDs must be 56-char base-32 `C…` addresses; RPC must be `http(s)`). On failure the app does **not** crash — it shows a blocking **“setup required”** screen (`EnvSetupScreen`) listing what to fix.

## Running the app

| Script                 | What it does                     | When to use                                             |
| ---------------------- | -------------------------------- | ------------------------------------------------------- |
| `npm run dev:full`     | `sync-circuit` then Vite         | **First run / default.** Ensures artifacts are present. |
| `npm run dev`          | Vite only                        | Artifacts already synced; faster HMR loop.              |
| `npm run dev:circuits` | Watch-mode sync of circuit files | Editing circuits while the app is open.                 |
| `npm run preview`      | Serve the production `dist/`     | After `npm run build`.                                  |

From the app directory:

```bash
cd app
npm run dev:full
```

Open the URL Vite prints.

## What the demo does on-chain

Not a mock: each run creates/funds/claims against live Stellar testnet using the configured contract and test-token SAC, with a real browser-generated Groth16 proof.

## Build, analyze, typecheck, test

```bash
cd app
npm run build           # sync-circuit + vite build
npm run typecheck       # tsc --noEmit
npm test                # Vitest (jsdom) — unit/component suite

# Optional bundle analysis (requires a one-time install):
npm install -D rollup-plugin-visualizer
npm run build:analyze   # ANALYZE=1 vite build → dist/stats.html
```

Default `vite` / `vite build` do **not** import the visualizer (that was breaking fresh clones when the plugin was a hard import without a declared dependency). Analysis is opt-in via `ANALYZE=1`.

## Deployment

Manual Vercel deploy of `app/dist` (git auto-deploy is disabled). Step-by-step: [docs/deployment.md](../docs/deployment.md).

## Notes

- Only `VITE_*` keys from `app/.env` are exposed to the browser.
- Missing `app/public/circuits/` files fail `dev:full` / `build` at sync time — compile the circuit first.
- SDK must be rebuilt after changes under `packages/client/` (`npm run build --workspace=packages/client`).
