# Multi-party trusted setup runbook (#546)

**Status:** Planned — **not executed.** The verification key committed in this repository and used on testnet was produced by a **single-contributor demo** setup (`circuits/scripts/setup.sh`, entropy from `/dev/urandom`). See [`circuits/SETUP_TRANSCRIPT.md`](../circuits/SETUP_TRANSCRIPT.md).

This document is an **executable runbook** for when the project runs a genuine multi-party Groth16 phase-2 ceremony over the **current** `membership` circuit (including `recipientHash`). It does **not** claim any contributor attestations or ceremony completion until those steps are performed and recorded in the transcript.

## Goals

- At least **three** mutually distrusting contributors each add phase-2 randomness to the circuit zkey.
- Each contribution is **independently attested** (public gist, signed message, or social post linking a contribution hash).
- Final artifacts pass **`npm run verify-setup`** and match a new committed `verification_key.json` entry in `SETUP_TRANSCRIPT.md`.
- Operators **redeploy** testnet/mainnet circles with the new vk — old circles remain pinned to the previous vk forever.

## Prerequisites

| Item          | Expected                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------- |
| Circuit       | `circuits/membership.circom` generated from template + `config.json` (with `recipientHash`) |
| Tooling       | `circom` 2.1.6+ (repo tested with 2.2.3), `snarkjs` 0.7.6 (`circuits/package.json`)         |
| Curve         | `bls12381`                                                                                  |
| Powers-of-Tau | `circuits/build/pot12_bls12381_final.ptau` (phase 1 complete; see `setup.sh`)               |
| R1CS          | `circuits/build/membership.r1cs` from `npm run compile`                                     |

Recruit contributors who will **destroy** their toxic waste after contributing and who do **not** collude (different orgs, different jurisdictions, different hardware).

## Phase 1 (Powers-of-Tau) — if not already finalized

The repo ships a path that builds `pot12_bls12381_final.ptau` locally (`setup.sh`). For production:

1. Prefer a public, audited BLS12-381 Powers-of-Tau file at the required power (≥ circuit constraint log₂; Sharibo uses power **12**).
2. Record its SHA-256 in `SETUP_TRANSCRIPT.md` alongside circuit entries.
3. Do **not** reuse bn128 ptau files.

## Phase 2 (circuit-specific) — multi-party

### 0. Coordinator: initial zkey

```bash
cd circuits
npm run compile
npx snarkjs groth16 setup build/membership.r1cs build/pot12_bls12381_final.ptau build/membership_0000.zkey
```

Publish `membership_0000.zkey` (or its hash) for contributors. **Do not** commit intermediate zkeys to git if policy forbids large binaries — use secure file transfer + hash pins.

### 1. Each contributor: one contribution

Use the helper (prints the contribution hash for attestation):

```bash
cd circuits
./scripts/ceremony-contribute.sh \
  build/membership_0000.zkey \
  build/membership_0001.zkey \
  "Contributor Name / org — YYYY-MM-DD"
```

Pass the **output** zkey of contributor _n_ as the **input** to contributor _n+1_. Rename paths per round (`membership_0001.zkey` → `membership_0002.zkey`, …).

Manual equivalent:

```bash
npx snarkjs zkey contribute IN.zkey OUT.zkey \
  --name="Contributor attestable name" -v \
  -e="$(head -c 64 /dev/urandom | base64)"
```

Snarkjs prints a **contribution hash** at the end — contributors should copy it into their attestation.

### 2. Independent attestation (each contributor)

Each contributor should publish **at least one** of:

- A signed git commit or tag containing the contribution hash and input/output zkey SHA-256
- A tweet / nostr post / company blog with the hash and ceremony date
- A GPG-signed message mailed to the coordinator list

The coordinator collects links in `SETUP_TRANSCRIPT.md` under the new entry.

### 3. Optional: random beacon

After the last human contribution, mix in a public random beacon (e.g. drand round, Bitcoin block hash at agreed height) so the final contributor cannot alone know the full toxic waste:

```bash
npx snarkjs zkey beacon IN.zkey OUT_final.zkey 01020304... 10 -n="Final beacon"
```

Document beacon source, round, and hash in the transcript.

### 4. Verify before export

```bash
cd circuits
npx snarkjs zkey verify build/membership.r1cs build/pot12_bls12381_final.ptau build/membership_final.zkey
npm run verify-setup   # after copying final zkey to build/membership_final.zkey and exporting vk
```

Expected: `[INFO] snarkJS: ZKey Valid!` and verify-setup passes against committed `verification_key.json` **after** you intentionally rotate the key.

### 5. Export verification key and rotate

```bash
npx snarkjs zkey export verificationkey build/membership_final.zkey verification_key.json
ALLOW_KEY_ROTATION=1 npm run setup   # or follow setup.sh transcript append path
```

Append a full row to [`circuits/SETUP_TRANSCRIPT.md`](../circuits/SETUP_TRANSCRIPT.md) including:

- UTC timestamp, snarkjs version, curve, ptau power
- SHA-256 of `verification_key.json`, `membership_final.zkey`, ptau
- Links to contributor attestations
- Beacon details (if used)

### 6. Redeploy checklist

- [ ] Commit new `verification_key.json` + transcript + wasm hash sidecars if used
- [ ] Run `just all` / circuit + contract tests
- [ ] Regenerate any committed proof fixtures (`contracts/sharibo/src/test.rs` notes)
- [ ] Redeploy Soroban contract or create **new** circles — existing circles store the old vk
- [ ] Update `.env` / app `VITE_*` contract ids as needed
- [ ] `npm run sync-circuit` in `app/` if the demo is deployed
- [ ] Run `npm run e2e` on testnet against a circle created with the new vk
- [ ] Update README on-chain evidence section if contract id changes

## What this runbook does not do

- It does **not** replace legal review or auditor engagement ([docs/audit/](audit/README.md)).
- It does **not** prove circuit **soundness** — only that the zkey is consistent with the r1cs and ptau (`zkey verify`).
- Running `setup.sh` alone on one machine remains **single-party** until the steps above are executed and attested.

## References

- [`circuits/scripts/setup.sh`](../circuits/scripts/setup.sh) — current demo automation (single contributor)
- [`circuits/scripts/ceremony-contribute.sh`](../circuits/scripts/ceremony-contribute.sh) — one contribution step + hash print
- [`circuits/scripts/verify-setup.sh`](../circuits/scripts/verify-setup.sh) — non-mutating artifact check
- Issue **#546** — tracking the real ceremony execution
