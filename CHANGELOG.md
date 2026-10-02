# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

See `docs/deployment.md` for the tag -> contract ID -> schema version -> vk hash
mapping that makes each release reproducible, and CONTRIBUTING.md "Releases"
for what a release must contain.

## [Unreleased]

### Added
- `Circle.schema_version` 2 with `fee_bps` / `fee_recipient` (protocol fees).
- `recipientHash` binding on circle creation.
- `expire_round` and admin transfer flows.
- `packages/core` extraction (shared crypto between app and SDK).

### Changed
- BLS12-381 curve decision for the proof system (see `circuits/`).
- `packages/client/api-surface.json` tracks the public SDK surface.

### Security
- Testnet reset required for the `Circle` v1 -> v2 migration
  (schema bump with no migration function; see Deployments table).

## [0.0.0] - 2026-01-01

### Added
- Initial hackathon release: Circom circuit, Soroban escrow contract
  (`Circle.schema_version` 1), React demo app, TypeScript SDK.
- Committed `circuits/verification_key.json` (provenance pinned in #274).
- Deployed testnet contract referenced in README.
