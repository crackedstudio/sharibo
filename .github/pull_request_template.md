## What changed

<!-- One or two sentences describing the change. -->

## Why

<!-- Link the issue: Closes #... -->

## Testing

<!-- Mark the checks you ran. Docs-only changes need no test checks. -->

- [ ] `just ci` (authoritative gate — same command CI runs)
- [ ] `just verify` only (fast subset; not enough for a merge)
- [ ] Circuits trusted setup / `just circuits` (when circuit artifacts changed)
- [ ] E2E against testnet (`just e2e` / `npm run e2e`)
- [ ] App tested manually (`just app-dev`)
- [ ] Docs-only (no code changed)

## Screenshots

<!-- If the app UI changed, add before/after screenshots here. Otherwise remove this section. -->
