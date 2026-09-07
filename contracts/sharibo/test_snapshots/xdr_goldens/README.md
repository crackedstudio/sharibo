# XDR Golden Files — issue #326

This directory contains committed base64 snapshots of the Soroban XDR
wire format for `Circle`, `VerificationKey`, and `Proof`.

## Files

| File                       | Source struct      | Rust test                     |
|----------------------------|--------------------|-------------------------------|
| `circle.v1.b64`            | `Circle`           | `xdr_golden::xdr_golden_circle` |
| `verification_key.v1.b64`  | `VerificationKey`  | `xdr_golden::xdr_golden_verification_key` |
| `proof.v1.b64`             | `Proof`            | `xdr_golden::xdr_golden_proof` |

## Why these exist

`Circle` is stored in persistent ledger storage and decoded on the TypeScript
side by `@stellar/stellar-sdk`.  Adding a field, reordering fields, or
changing a type silently changes the XDR wire format; the failure appears as
a decode error in the browser rather than a test failure.  Committed goldens
make that silent failure loud.

## Generating (first time or after an intentional wire-format change)

```bash
UPDATE_GOLDEN=1 cargo test -p sharibo xdr_golden
```

Then review the diff (`git diff --stat`), confirm the new bytes look right,
and commit them alongside the struct change.

Also update `packages/client/src/contract.test.ts` if any expected field
values or struct shapes changed, and bump `SCHEMA_VERSION` in
`contracts/sharibo/src/test.rs`.

## Schema version

The current schema version is encoded in the filename suffix (`.v1.b64`).
When a breaking wire-format change is made, the version should be incremented
and the old golden files should be removed.  See `SCHEMA_VERSION` in
`contracts/sharibo/src/test.rs`.
