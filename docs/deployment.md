# Deploying the Sharibo browser app

The live demo linked from the root README
([https://dist-flax-three-43.vercel.app](https://dist-flax-three-43.vercel.app))
is a **manual** Vercel deployment of `app/`.

## Why it is manual

Both [`vercel.json`](../vercel.json) and [`app/vercel.json`](../app/vercel.json)
set `"git.deploymentEnabled": false`. Pushes to GitHub do **not** trigger a
deploy. Environment variables are baked into the static build from `app/.env`
at build time (Vite `VITE_*`), not configured as Vercel project env vars.

## Prerequisites

1. Root `npm install`
2. `npm run build --workspace=packages/client` (app resolves `@sharibo/client` from `dist/`)
3. Circuit artifacts built (`cd circuits && npm run compile && npm run setup`)
4. `app/.env` filled with the current testnet contract + token IDs

## Deploy

```bash
cd app
npm run build     # sync-circuit + vite build → app/dist
vercel --prod     # deploys dist/ to the existing project
cd ..
```

If the CLI is not linked yet: `vercel link` and select the **existing** project
so the public URL stays the same.

After a contract redeploy, also follow
[docs/runbook-testnet-reset.md](runbook-testnet-reset.md) §7–8 so README
on-chain evidence stays accurate.

## Releases and on-chain deployments (issue #540)

A release is a git tag plus a `CHANGELOG.md` entry plus the deployment record.
That set is what makes a claim reproducible - an auditor or judge needs all of
it to tie a contract ID to a source revision.

### Deployments

| Tag                 | Contract ID                                                | Circle schema | vk SHA-256 (`sha256sum circuits/verification_key.json`) | Circom | Notes                                                            |
| ------------------- | ---------------------------------------------------------- | ------------- | ------------------------------------------------------- | ------ | ---------------------------------------------------------------- |
| Unreleased (`main`) | `CB64IZIBBSPUY63UMIVACKWDKRFNH6WJ2EPAOLM7QR4ZI6IJOT4N2LCF` | 2             | record with `sha256sum` at release time                 | 0.0.24 | Current testnet deployment; see README on-chain evidence         |
| v1 / testnet reset  | previous testnet ID (wiped)                                | 1             | previous vk                                             | 0.0.24 | v1 -> v2 added `fee_bps`/`fee_recipient`, required testnet reset |

> Testnet resets wipe the deployed contract ID. Every reset produces a new row
> here (see `runbook-testnet-reset.md`): never overwrite the previous row,
> append.

### Cutting a release

1. Bump versions deliberately: the contract (`contracts/sharibo/Cargo.toml`)
   and the circuit are the load-bearing artifacts - version those first, then
   let the TS packages (`package.json` files) follow.
2. Add a `CHANGELOG.md` entry under a new version heading.
3. Record `sha256sum circuits/verification_key.json` in the table above.
4. Tag (`git tag vX.Y.Z`), push the tag, fill the Deployments row.

Kept manual until there is a reason not to - release automation on a repo
with no CI would be premature.
