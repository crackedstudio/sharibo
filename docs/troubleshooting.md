# Troubleshooting Sharibo setup

A quick reference for the failures that bite newcomers first. The stack needs four
toolchains (Node, Rust/wasm, Stellar CLI, circom), and each has a characteristic,
time-sinking failure mode. Each entry below lists the **symptom** (exact error text
where possible), the **cause**, and the **fix**.

If you hit a problem while setting up and it isn't covered here, please open an issue
and share the exact error text — you're the most qualified person to document it.

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

1. Rebuild/redeploy the contract and token, then paste the **new** IDs:

   ```bash
   cd contracts && stellar contract build && stellar contract deploy \
     --wasm target/wasm32v1-none/release/sharibo.wasm --source admin --network testnet
   cd ../packages/contracts/contracts && stellar contract id asset --asset native --network testnet
   ```

2. Update `.env` (and `app/.env`) with the fresh IDs and regenerate keys if needed:

   ```bash
   stellar keys generate admin --network testnet --fund
   stellar keys generate member --network testnet --fund
   stellar keys show admin ; stellar keys show member
   ```

3. Re-run the browser/further steps as usual — new circle state now lives on the new
   ledger.

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
  externalNullifier]` in that order. If `publicSignals` is passed in a different
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
   is `[nullifierHash, root, externalNullifier]`.

**Fix**

Correct the encoding in `encodeG1` / `encodeG2` or the `vk` passed to
`createCircle`. Once the encoding is right, both local verify and on-chain verify
will agree.

---

**Still stuck?** Re-read [`CONTRIBUTING.md`](../CONTRIBUTING.md) for the dev loop and
the [README "Run it" section](../README.md#run-it) for the step order; open an issue if
your symptom isn't here.
