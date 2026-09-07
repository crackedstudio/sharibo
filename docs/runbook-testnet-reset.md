# Runbook: recovering from a Stellar testnet reset

**Symptom:** the app, `npm run e2e`, or `npm run smoke` start failing with something like
`Contract ... does not exist` or `... not found`, despite nothing in this repo having changed.

**Cause:** Stellar testnet is wiped periodically (roughly quarterly). Every deployed contract,
every SAC (including the native-XLM test token this repo uses), and every account's funded
state disappears with it. The keypairs themselves (`admin`, `member`, ...) are still valid —
they're just generated locally by `stellar keys` — but the *accounts* they name no longer exist
on the new ledger, and `SHARIBO_CONTRACT_ID` / `TEST_TOKEN_CONTRACT_ID` in `.env` now point at
nothing.

This is a known, expected failure mode — see `scripts/testnet-health.ts` (`checkContractDeployed`,
used by `scripts/e2e.ts`) and `docs/troubleshooting.md`'s "Stellar testnet resets" entry. This
document is the ordered checklist for actually fixing it, end to end.

**Estimated time:** 15–30 minutes if you've done this before (mostly `stellar` CLI calls and
friendbot round-trips); budget up to an hour the first time. The circuit/trusted-setup artifacts
(`circuits/build/`, the zkey, `verification_key.json`) are **not** affected by a testnet reset —
they're deterministic build outputs, not chain state — so none of this requires re-running
`npm run compile` / `npm run setup`.

---

## 1. Confirm it's actually a reset

Don't assume — a stale `.env`, an unrelated RPC outage, and a genuine reset all look similar at
first. Run the read-only smoke test:

```bash
npm run smoke
```

- If `getCircle(0)` reports `Contract or circle not found. Testnet may have been reset...` while
  RPC health and Horizon both come back healthy, that's the reset signature — proceed below.
- If RPC health or Horizon themselves fail, that's a different problem (network outage, wrong
  URL in `.env`) — see `docs/troubleshooting.md` instead.

`npm run e2e` performs the same check up front (via `checkContractDeployed`) and will print the
same guidance before doing any work.

## 2. Redeploy the contract

```bash
cd contracts
cargo test                 # optional but recommended — re-confirm the suite is green first
stellar contract build
stellar contract deploy \
  --wasm target/wasm32v1-none/release/sharibo.wasm \
  --source admin \
  --network testnet
cd ..
```

Note the returned contract id — this is the **new** `SHARIBO_CONTRACT_ID`.

## 3. Redeploy / repoint the test token

The native-XLM SAC id is deterministic per network but changes when the network itself resets:

```bash
stellar contract id asset --asset native --network testnet
```

Note the returned id — this is the **new** `TEST_TOKEN_CONTRACT_ID`.

## 4. Re-fund your identities

The `admin`/`member` **keypairs** in `~/.config/stellar/identity/` survive a testnet reset (they're
local, not on-chain); only their on-chain account state was wiped. Re-fund the existing identities
rather than generating new ones, so `ADMIN_PUBLIC_KEY`/`MEMBER_PUBLIC_KEY` in `.env` don't need to
change:

```bash
stellar keys fund admin --network testnet
stellar keys fund member --network testnet
```

If an identity was lost entirely (fresh machine, deleted config), generate a new one instead —
see README "Run it" §1 — and update both the secret and public key in `.env`.

## 5. Update `.env` and `app/.env`

Both files need the new contract/token ids; nothing else in them changes unless you regenerated
keys in step 4.

```text
# .env
SHARIBO_CONTRACT_ID=<new id from step 2>
TEST_TOKEN_CONTRACT_ID=<new id from step 3>
```

```text
# app/.env
VITE_SHARIBO_CONTRACT_ID=<new id from step 2>
VITE_TEST_TOKEN_CONTRACT_ID=<new id from step 3>
```

## 6. Re-run the end-to-end script

```bash
npm run e2e
```

This is the real confirmation: a full round (create → 5× fund → prove → claim → replay rejection)
against the freshly deployed contract. Note the printed `create_circle` transaction hash and the
successful-claim transaction hash + ledger — you'll need both for step 8.

## 7. Rebuild and redeploy the browser app

The Vercel project is **not git-connected** (`vercel.json`: `"deploymentEnabled": false`) — a push
to this repo does not trigger a deploy. Env vars are baked into the static build at build time from
`app/.env`, not configured remotely in the Vercel project, so this is a manual, local step every
time:

```bash
cd app
npm run build     # bakes VITE_SHARIBO_CONTRACT_ID / VITE_TEST_TOKEN_CONTRACT_ID from app/.env into dist/
vercel --prod      # deploys dist/ to the existing project (https://dist-flax-three-43.vercel.app)
cd ..
```

If the `vercel` CLI isn't linked to the project yet on this machine, run `vercel link` first and
select the existing project rather than creating a new one — the live demo URL must stay the same.

## 8. Update the README's on-chain evidence

The following claims in `README.md`'s "On-chain evidence" table are now stale and must be
re-verified against the new deployment, using the ids/hashes from steps 2, 3, and 6:

- `Sharibo contract` — new contract id.
- `Test token (native XLM SAC)` — new token id.
- `create_circle (circle 0)` tx hash — from the `npm run e2e` output in step 6.
- `Real Groth16 proof accepted on-chain` tx hash + ledger — from the same `npm run e2e` run.
- The "Tampered proof rejected" / "Nullifier replay rejected" rows don't need new hashes (they cite
  error codes, not specific transactions), but re-confirm they still reproduce — `npm run e2e`
  exercising the replay-rejection path in step 6 is that confirmation.

The live app link itself (`https://dist-flax-three-43.vercel.app`) does not change, but it points
at nothing useful until step 7 is done.

## 9. Final check

```bash
npm run smoke
```

All three checks (RPC health, Horizon, `getCircle(0)`) should now report healthy against the new
deployment. Open the live app link and confirm the browser demo loads and can create a circle.

---

**See also:** [`docs/troubleshooting.md`](troubleshooting.md) for the short version and other
setup failures; [`scripts/testnet-health.ts`](../scripts/testnet-health.ts) for the reset-detection
logic this runbook exists to explain.
