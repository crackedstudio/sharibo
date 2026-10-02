# Troubleshooting Sharibo setup

A quick reference for the failures that bite newcomers first. The stack needs four
toolchains (Node, Rust/wasm, Stellar CLI, circom), and each has a characteristic,
time-sinking failure mode. Each entry below lists the **symptom** (exact error text
where possible), the **cause**, and the **fix**.

If you hit a problem while setting up and it isn't covered here, please open an issue
and share the exact error text — you're the most qualified person to document it.

Start with `just doctor` for an automated checklist that prints the exact install command
for anything missing or out of date.

---

## `circom: command not found`, or an ancient `1.x` circom

**Symptom**

```text
circom: command not found
```

or, after installing circom via npm by mistake:

```text
circom 1.0.*
```

**Cause**

`circom` is **not** an npm package you should install. The `circom` that shows up after
`npm install -g circom` (or after following an old snippet) is the abandoned `1.x`
snapshots tool, not the compiler. Sharibo needs the **Rust** compiler, `circom 2.x`,
invoked as `circom --version` → `2.x.x`. It also needs the `--prime bls12381` support
that only the Rust build provides.

**Fix**

Quick check: `just doctor` will flag a missing or outdated `circom` and print the exact install command.

Install the Rust circom 2.x and put it on your `PATH`, then confirm the version:

```bash
git clone https://github.com/iden3/circom.git
cd circom && cargo build --release && cargo install --path circom
circom --version   # -> 2.2.3 (or any 2.x)
```

Then confirm the required prime is available (custom prime `bls12381` — built from
source, not an apt/npm binary):

```bash
circom --cite 2>/dev/null || true
```

If `npm run compile` reports `Unknown prime: bls12381`, your `circom 2.x` binary is a
prebuilt package that only ships `bn128`. Build `circom` from source as above so the
industry-standard `bls12381` prime exists. See [circuits/README.md](../circuits/README.md).

---

## Missing `wasm32v1-none` Rust target

**Symptom**

```text
error[E0463]: can't find crate for `core`
  |
  = note: the `wasm32v1-none-unknown` target may not be installed
```

or at build time:

```text
target.wasm32v1-none is not an installed target
```

**Cause**

Rust supports many targets; the `wasm32v1-none` target used by Stellar contracts
(no std, no host) must be added explicitly. Bare `rustup` installs don't include it.

**Fix**

Quick check: `just doctor` verifies the target is installed and prints the install command if it is missing.

```bash
rustup target add wasm32v1-none
rustc +stable target list --installed | grep wasm32v1-none   # verify
```

Re-run `npm run build` (or `stellar contract build`) afterwards; the wasm target is now
available.

---

## `soroban` vs `stellar` CLI confusion

**Symptom**

```text
zsh: command not found: soroban
```

or, if an old `soroban` binary is still installed:

```text
Error: unknown command "contract" for "soroban"
```

**Cause**

`soroban` was the older Stellar contract CLI. It has been **superseded** and folded
into the `stellar` CLI, and its ordering/flags differ. The repo targets the current
`stellar` CLI (v21.0+; protocol 22+ required for the BLS12-381 host functions the
Groth16 verifier uses, see [README §0](../README.md#0-prerequisites)).

**Fix**

Quick check: `just doctor` verifies the `stellar` CLI version and prints the install URL if it is missing.

Use the `stellar` CLI exclusively. Walk with the docs:

```bash
stellar keys generate admin --network testnet --fund
stellar contract build
stellar contract deploy --wasm target/wasm32v1-none/release/sharibo.wasm --source admin --network testnet
```

If a stale `soroban` is installed and shadowing the real CLI, remove it:

```bash
cargo uninstall soroban-cli 2>/dev/null || true
which stellar   # ensure it resolves to the current CLI
```

---

## Friendbot rate limited / `already funded` 400s

**Symptom**

```text
friendbot funding failed: 429
```

or during the e2e script / a fresh `stellar keys generate --fund`:

```text
--network testnet --fund: 400 ... already funded
```

**Cause**

Friendbot caps how often it will sponsor the same address, and **drops free lumens on
a given keypair only once**. Re-running funding on an already-funded key returns a 400.
The repo deliberately **tolerates 400** — `friendbotFund` in `app/src/lib/friendbot.ts`
treats `status === 400` as "already funded" and carries on; a `429` (rate limit) or other
status is a real error. See `scripts/e2e.ts`.

**Fix**

- Treat a `400 already funded` as non-fatal: the account already exists, proceed.
- For a repeated `429`, wait a bit and retry, or use a different source of testnet
  lumens (e.g. the [Stellar testnet faucet](https://laboratory.stellar.org/#account-creator)).
- Don't hand-recreate `stellar keys` that already exist; prefer the `--fund` flag only
  on genuinely new keys.

---

## Stellar testnet resets (quarterly)

**Symptom**

After some weeks (testnet resets ~quarterly), the app stops working despite unchanged
config:

```text
Error: (ContractInvocationError) ... contract not found ... id: does not exist
```

or invoke/claim calls fail with `Contract `....` does not exist` — yet you didn't change
anything.

**Cause**

Stellar **testnet is wiped on a quarterly schedule**. When testnet resets, every
deployed contract ID dies with it: the `SHARIBO_CONTRACT_ID`, `TEST_TOKEN_CONTRACT_ID`,
and the identities in your `.env` (which were funded by the now-reset friendbot / prior
ledger) are stale.

**Fix**

Full ordered recovery — redeploy contract + token, re-fund identities, update both `.env` files,
re-run `e2e`, rebuild/redeploy the (non-git-connected) Vercel app, and refresh the README's
on-chain evidence — is [`docs/runbook-testnet-reset.md`](runbook-testnet-reset.md). Start there
rather than improvising; it also covers what does _not_ need redoing (the circuit/trusted-setup
artifacts survive a reset untouched).

---

## Browser app shows a blank / broken proving step (`circuits/build/` never generated)

**Symptom**

The `/prove` (proving) step in the browser `app` is blank, hangs, or errors around
loading circuit artifacts. The dev console shows a failed `fetch` of a `.zkey`, `.wasm`,
or `verification_key.json` from `app/public/circuits/`.

**Cause**

The browser app needs the compiled circuit + trusted-setup outputs copied into
`app/public/circuits/`. `npm run dev` runs `sync-circuit` automatically, but that copies
from `circuits/build/` — which only exists **after** you run the circuit compile and
setup, i.e.:

```bash
cd circuits
npm run compile   # circom build/membership.{r1cs,sym} memberships_js/membership.wasm
npm run setup     # zkey + verification_key.json
```

If you never ran `compile`/`setup`, `circuits/build/` is missing, `sync-circuit` has
only empty, and the app can't load the artifacts.

**Fix**

```bash
cd circuits
npm run compile
npm run setup
cd ..
cd app
npm run sync-circuit   # copies circuits/build/* into app/public/circuits/
npm run dev
```

Then hard-refresh the browser tab. If it still misbehaves, delete
`app/public/circuits/*` and re-run `sync-circuit` to force a clean copy.

---

## Browser app build fails because circuit artifacts or hashes are missing

**Symptom**

`npm run build --workspace=app` fails with `No committed SHA-256 hash found for verification_key.json`, or reports a missing `.wasm` / `.zkey` file.

**Cause**

The app build verifies the compiled wasm, trusted-setup zkey, committed verification key, and their SHA-256 manifests. A fresh clone has the committed verification key but not the generated files and manifests.

**Fix**

```bash
cd circuits
npm run compile
ALLOW_KEY_ROTATION=1 npm run setup
```

The setup command can generate a verification key that differs from the committed key; only use `ALLOW_KEY_ROTATION=1` when deliberately bootstrapping local artifacts. Then rerun `just doctor`.

---

## Client SDK dist is not built

**Symptom**

App tests or scripts fail to resolve `@sharibo/client`, often after a fresh `npm install`.

**Cause**

The workspace package points its runtime exports at `packages/client/dist/`, which is generated by TypeScript and is not committed.

**Fix**

```bash
npm run build --workspace=packages/client
```

---

## Circuit tests fail because JavaScript dependencies are missing

**Symptom**

`just circuits` reports that `mocha`, `circom_tester`, or `snarkjs` cannot be found.

**Cause**

Those packages are circuit workspace dependencies and are installed by npm at the repository root or in the circuits workspace.

**Fix**

```bash
npm install
```

---

## Scripts fail because .env is missing or invalid

**Symptom**

Scripts that load `scripts/config.ts` stop with `Environment validation failed` or identify missing/malformed `TEST_TOKEN_CONTRACT_ID`, `SHARIBO_CONTRACT_ID`, `ADMIN_SECRET_KEY`, or `STELLAR_RPC_URL`.

**Cause**

The root `.env` is absent or has invalid values. The config loader requires both contract IDs and the admin secret key to use valid Stellar StrKey prefixes and lengths; a supplied RPC URL must be HTTP(S).

**Fix**

```bash
cp .env.example .env
```

Fill in the required values. Generate testnet keys with `stellar keys generate admin --network testnet --fund` and use the documented contract IDs after deployment; see [README §1](../README.md#1-install-and-configure).

---

## Missing curl for end-to-end tests

**Symptom**

The end-to-end script cannot start its `curl` subprocess or reports that `curl` is not recognized.

**Cause**

`scripts/e2e.ts` shells out to `curl` for HTTP requests, so it must be installed and available on `PATH`.

**Fix**

Install curl with your operating system's package manager, then verify with `curl --version`.

---

## Node version does not match the repository pin

**Symptom**

`just doctor` reports that the installed Node major version differs from `.nvmrc`.

**Cause**

The repository pins Node 20 in `.nvmrc`; the doctor reports a mismatch as an advisory because supported Node versions may still run the project.

**Fix**

```bash
nvm install 20
nvm use 20
```

---

## cargo-llvm-cov is optional

**Symptom**

The Rust coverage section of `just coverage` cannot run `cargo llvm-cov`.

**Cause**

`cargo-llvm-cov` is only needed to generate Rust coverage reports; it is not required for builds or tests.

**Fix**

```bash
cargo install cargo-llvm-cov
```

---

## just is optional

**Symptom**

The shell reports `just: command not found`.

**Cause**

`just` provides shorthand recipes only. The underlying npm, cargo, and shell commands can be run directly.

**Fix**

```bash
cargo install just
```

---

## Local circuit artifacts are stale and fail verification before the app copies them

**Symptom**

The browser throws `InvalidProof`, but the real problem is that the local `circuits/build/`
artifacts no longer match the committed circuit setup. This often happens after deleting and
rebuilding the circuit without re-running the trusted setup.

**Cause**

`app/scripts/sync-circuit.mjs` used to copy whatever existed in `circuits/build/` without checking
whether the `.wasm` and `.zkey` still match the committed `verification_key.json`.

**Fix**

```bash
cd circuits
npm run verify-artifacts
```

If the hashes differ, the script aborts with:

```bash
run `npm run compile && npm run setup` in `circuits/`
```

This is the safe recovery path: rebuild the circuit and re-run setup, then re-sync the app.

---

**Still stuck?** Re-read [`CONTRIBUTING.md`](../CONTRIBUTING.md) for the dev loop and
the [README "Run it" section](../README.md#run-it) for the step order; open an issue if
your symptom isn't here.

---

## Proof passes local verification but fails on-chain (`InvalidProof`)

**Symptom**

The claim flow completes the "Verifying proof locally…" stage and shows
`local verify Xms ✓` in the result card — but the on-chain `claim` call is still
rejected with an `InvalidProof` error.

**What this means**

Local verification (snarkjs `groth16.verify`) checks the mathematical proof
against the public signals. On-chain verification checks the same proof but
expects it in a specific **binary wire format** (BLS12-381 compressed G1/G2
points, big-endian, in the exact byte layout Soroban's `bls12_381_g1_msm` /
`g2_msm` host functions consume).

If local passes and on-chain fails, **the proof itself is valid** — the mismatch is
almost certainly in the encoding, not the cryptography. Common causes:

- **Wrong point encoding** — G1 should be 96 bytes (x‖y uncompressed, big-endian);
  G2 should be 192 bytes (x₁‖x₀‖y₁‖y₀, each 48 bytes big-endian). Swapping
  coordinate order or using the compressed (48/96 byte) form causes a silent
  mismatch.
- **Wrong public signal order** — the contract expects `[nullifierHash, root,
externalNullifier, recipientHash]` in that order. If `publicSignals` is passed in a different
  order the encoded `pi_a`/`pi_b`/`pi_c` will be correct but the IC combination
  will mismatch on-chain.
- **Mismatched verification key** — the VK stored in the contract at
  `create_circle` time must match the one used during `groth16.verify`. If you
  re-ran `npm run setup` after deploying, the on-chain VK is stale.
- **Wrong curve** — the circuit uses BLS12-381, not BN128. A snarkjs build or VK
  from a BN128 ceremony will verify locally (snarkjs is curve-aware) but produce
  byte offsets the Soroban BLS12-381 host rejects.

**How to diagnose**

1. Check `packages/client/src/prove.ts` — the `encodeG1` / `encodeG2` helpers are
   the single point-of-truth for the wire encoding. Log the raw `snarkjsProof` from
   `generateProof` and compare `pi_a`, `pi_b`, `pi_c` lengths against what the
   contract receives.
2. Confirm the VK on-chain matches `circuits/verification_key.json` — re-deploy with
   a fresh `verificationKeyToContractFormat(vkJson)` call if in doubt.
3. Add a temporary log of `publicSignals` just before `claim()` and verify the order
   is `[nullifierHash, root, externalNullifier, recipientHash]` ([wire-format.md](wire-format.md)).

**Fix**

Correct the encoding in `encodeG1` / `encodeG2` or the `vk` passed to
`createCircle`. Once the encoding is right, both local verify and on-chain verify
will agree.

---

**Still stuck?** Re-read [`CONTRIBUTING.md`](../CONTRIBUTING.md) for the dev loop and
the [README "Run it" section](../README.md#run-it) for the step order; open an issue if
your symptom isn't here.
