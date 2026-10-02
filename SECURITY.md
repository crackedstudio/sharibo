# Security Policy

## Supported Versions

Currently, Sharibo is in development and deployed to testnet only. All components in the `main` branch are subject to this security policy.

## Scope

See [docs/threat-model.md](docs/threat-model.md) for the structured breakdown of assets, adversaries, and which security properties each part of the code is actually responsible for.

The following components qualify as in-scope for security vulnerabilities:

- **Smart contract logic:** `contracts/sharibo/src/lib.rs` (e.g., bypassing auth, double-claiming, unauthorized access to funds).
- **Circuit soundness:** `circuits/membership.template.circom` (e.g., forged proofs, soundness errors, missing constraints allowing unintended witness generation). `circuits/membership.circom` is generated from this template by `circuits/scripts/gen-circuit.cjs`; reproduce it with `npm run compile` from `circuits/`.
- **Proof/nullifier handling:** `packages/client/` (e.g., improper nullifier generation, replay vulnerabilities, weak randomness).
- **Cryptographic primitives:** `packages/core/` (e.g., inconsistencies in the duplicated crypto primitives).
- **Debug-data secret handling:** `app/src/lib/debugBundle.ts` (e.g., secrets or sensitive material escaping the redaction guard).

## Reporting a Vulnerability

**Do not report security vulnerabilities through public GitHub issues.**

Please report vulnerabilities using [GitHub Security Advisories / private vulnerability reporting](https://github.com/crackedstudio/sharibo/security/advisories/new) on this repository. This channel is available only when private vulnerability reporting is enabled in the repository's GitHub settings; its enabled status cannot be verified from this public policy. Repository maintainers must enable it for this reporting instruction to work. If the private report option is unavailable, do not disclose the vulnerability in a public issue; use GitHub's [private contact options for the repository owner](https://github.com/crackedstudio) instead.

### Response Expectations

- **Acknowledgement and investigation:** A maintainer will make a best effort to acknowledge and assess reports. No response-time guarantee or maintainer rotation is currently published; repository ownership is listed in [`.github/CODEOWNERS`](.github/CODEOWNERS).
- **Responsible Disclosure:** We ask that you maintain strict confidentiality until we have had time to investigate, patch, and release a fix. We will coordinate a public disclosure timeline with you.

## Limitations and Exclusions

Please note the following known limitations which are **not** considered qualifying vulnerabilities for the purposes of this policy:

- **Deployment is testnet-only:** The current deployment operates on the Stellar testnet. No real funds are at risk.
- **Trusted setup is currently single-party:** The trusted setup for the Groth16 circuit was run by a single party. This is a known limitation for the current development phase. A multi-party ceremony is **planned but not executed** — runbook: [docs/ceremony.md](docs/ceremony.md) (#546).
- **Not audited:** No third-party security audit of the circuit or contract has been completed. Audit-readiness index: [docs/audit/](docs/audit/README.md) (#547).
- For additional context, please refer to the "Honest limitations" section in the [README](README.md) and the [mainnet readiness checklist](docs/roadmap.md).
