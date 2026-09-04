# ADR 003: Circle storage schema versioning and migration

- **Status:** Accepted
- **Date:** 2026-08-30
- **Context:** Several open issues (`fee_bps`, `fee_recipient`, `deadline_ledger`, nullifier
  vector) propose adding fields to `Circle`. The struct is stored directly in Soroban persistent
  storage under `DataKey::Circle(id)`. Any field addition changes the XDR layout, and any circle
  written by the old code becomes undecodable at the host level — the `persistent().get::<Circle>()`
  call will panic before our error-handling code can run, so `get_circle` / `fund` / `claim` all
  fail for every circle that was created before the upgrade, with no clean `CircleNotFound` fallback.

  `docs/adr/001-upgradeability.md` covers why the contract binary is immutable (no upgrade key).
  It does not cover what to do when the *data format* changes.

## Problem

Soroban XDR encodes `#[contracttype]` structs as an `ScMap` sorted by field name. Adding, removing,
or reordering a field produces a different binary layout. A `persistent().get::<Circle>()` on a
value written by an older layout returns an error at the host level — below any Rust `unwrap` —
so affected circles become permanently bricked rather than cleanly returning `CircleNotFound`.

Without a versioning discipline, every field addition proposed in open issues is a silent landmine
for any circles that exist at the time of deployment.

## Decision

### 1. `schema_version` as the first field

`Circle` gains a `schema_version: u32` field, placed **first** in the struct definition.

```rust
pub struct Circle {
    pub schema_version: u32, // must remain first
    pub admin: Address,
    // ...
}
```

`create_circle` initialises it to `1`. The first field is placed first deliberately: a future
migration helper that needs to detect the version without decoding the full struct can attempt a
minimal XDR read of only the first map entry.

### 2. The versioning rule

**Any change to the `Circle` field list (addition, removal, rename, reorder) must:**

1. Bump `schema_version` to the next integer.
2. Either provide a migration function _or_ include an explicit "testnet-reset" note in the
   release commit / PR description explaining why migration is unnecessary (e.g. no circles exist
   on any live network yet).

A migration function reads the old layout as raw `Bytes` / `ScVal`, reconstructs the new struct,
and writes it back under the same key. It should be a one-shot admin entrypoint that is removed in
the next release, not a permanent part of the contract surface.

### 3. Golden-XDR test as a compile-time guard

A test `circle_xdr_layout_golden` in `test.rs` serialises a deterministic `Circle` fixture to XDR
and compares the hex to a committed constant `CIRCLE_XDR_GOLDEN`.

- If a developer adds a field without updating the constant, the test **fails** — making it
  impossible for a layout-breaking change to land unnoticed, even in a PR that only touches `lib.rs`.
- To intentionally change the layout, the developer must:
  1. Bump `schema_version`.
  2. Run `RECORD_GOLDEN=1 cargo test circle_xdr_layout_golden -- --nocapture` from
     `contracts/sharibo/` to regenerate the hex.
  3. Paste the new hex into `CIRCLE_XDR_GOLDEN` in `test.rs`.
  4. Add a migration path or testnet-reset note to the PR.

The test is self-bootstrapping: when `CIRCLE_XDR_GOLDEN` is empty, it prints the hex and passes,
so the first run after a change produces the new golden value to commit.

## Migration playbook for future field additions

When an issue requires a new `Circle` field:

1. **Decide on the default.** What value should existing circles get? (e.g. `fee_bps = 0`,
   `deadline_ledger = u32::MAX` meaning "no deadline").
2. **Write the migration entrypoint.**  A permissioned function (admin-only or one-time-use) that
   iterates over circle ids (using `get_circle_count`), reads each raw entry, converts it, and
   writes the new layout back.
3. **Bump `schema_version`** (e.g. `1` → `2`).
4. **Record and commit the new golden XDR** (step 3 of the guard workflow above).
5. **Deploy in two phases if circles are live on mainnet:**
   a. Deploy the new WASM (immutable contract = new contract address per ADR 001).
   b. Run the migration entrypoint on the new contract for any existing circles, or coordinate
      an off-chain recreation.
6. **Remove the migration entrypoint** in the following release.

## Testnet-reset shortcut

For changes made while the project is still on testnet and no circles hold real value, migration
can be replaced by a clean redeployment. The PR must explicitly state: _"Testnet-reset accepted:
no live circles hold user funds."_ This exception does not apply to mainnet.

## Consequences

- `Circle` layout changes are now caught by CI before they can silently corrupt stored data.
- Future field additions have a clear, documented procedure instead of ad-hoc decisions.
- `schema_version = 1` is committed on-chain for every new circle from this point forward;
  migration helpers can branch on it without ambiguity.
- Existing testnet circles (schema_version not present in the old layout) will be unreadable after
  this change is deployed — this is expected and acceptable for a pre-mainnet testnet reset.
