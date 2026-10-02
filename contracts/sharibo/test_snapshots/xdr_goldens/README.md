# XDR Golden Files — issues #326 / #566

This directory contains committed base64 snapshots of the Soroban XDR
wire format for `Circle`, `CircleMeta`, `VerificationKey`, and `Proof`.

## Files

| File                       | Source struct      | Rust test                              |
|----------------------------|--------------------|----------------------------------------|
| `circle.v2.b64`            | `Circle`           | `xdr_golden::xdr_golden_circle`        |
| `verification_key.v2.b64`  | `VerificationKey`  | `xdr_golden::xdr_golden_verification_key` |
| `proof.v2.b64`             | `Proof`            | `xdr_golden::xdr_golden_proof`         |

The `.vN` suffix tracks `SCHEMA_VERSION` in `contracts/sharibo/src/test.rs`
(`mod xdr_golden`), which must stay equal to `Circle.schema_version` written
by `create_circle` (currently **2**). Copies are also mirrored under
`test-vectors/xdr/` for the TypeScript encoder suite.

## Why these exist

`Circle` is stored in persistent ledger storage. `VerificationKey` and
`Proof` cross the language boundary on every claim — the SDK encodes them
in `packages/client/src/prove.ts` (`encodeG1` / `encodeG2`) and the contract
decodes them. A layout change there surfaces as a silent `InvalidProof`,
the hardest failure in this system to diagnose. Committed goldens make that
failure loud on both the Rust and TypeScript sides.

## Regenerating

See also `just xdr-goldens` (thin wrapper around the command below).

```bash
cd contracts && UPDATE_GOLDEN=1 cargo test -p sharibo xdr_golden
```

Then:

1. Review the diff (`git diff --stat contracts/sharibo/test_snapshots/xdr_goldens/ test-vectors/xdr/`).
2. Update `packages/client/src/contract.test.ts` if expected field values or
   struct shapes changed.
3. Bump `SCHEMA_VERSION` in `mod xdr_golden` **and** `Circle.schema_version`
   in `lib.rs` if the wire format changed — a golden diff with an unchanged
   version must fail.
4. Commit the updated `.b64` files alongside the struct change.

## Schema version linkage

A layout change without a version bump fails in two places:

- The golden byte comparison (`assert_golden`) — message tells you to bump.
- `schema_version_matches_create_circle` — asserts `SCHEMA_VERSION == 2`
  and that the golden Circle fixture embeds that same value.
