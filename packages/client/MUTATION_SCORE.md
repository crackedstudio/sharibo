# Mutation Score — `packages/client` crypto modules

Scope: `src/identity.ts` and `src/tree.ts`  
Runner: `@stryker-mutator/vitest-runner` 8.7.1  
Config: `stryker.conf.json`

## How to run

```bash
just mutation
# or directly:
npm run mutate --workspace=packages/client
```

Expected wall-clock time: **3–8 minutes** on a modern laptop (4 workers, vitest
in-process mode).  Do not add this to the default CI pipeline — it is too slow
to run on every commit.  Run it when changing `identity.ts` or `tree.ts`, or
periodically to verify the test suite hasn't drifted.

The HTML report is written to `packages/client/reports/mutation/mutation.html`
(git-ignored).

## Baseline scores

Record the scores here after the first `just mutation` run so future changes
can be measured against them.

| File | Mutation score | Killed | Survived | Timeout | No coverage |
|------|---------------|--------|----------|---------|-------------|
| `src/identity.ts` | _run `just mutation` to populate_ | — | — | — | — |
| `src/tree.ts`     | _run `just mutation` to populate_ | — | — | — | — |
| **Total**         | — | — | — | — | — |

## Surviving mutants addressed in this PR

The following categories of mutant were identified as likely survivors in the
pre-existing tests and are now killed by strengthened assertions:

### `src/tree.ts`

| Mutant class | Location | What survives without the new test | Killing test |
|---|---|---|---|
| Swap sibling index (`index - 1` ↔ `index + 1`) | `proof()` | A test that only checks `pathElements.length` never verifies *which* sibling is returned | "sibling of the left child (index 0) is the right child" etc. |
| Flip `isRightNode` check (`=== 1` → `=== 0`) | `proof()` | A test that only checks `pathIndices.length` never verifies *which* direction bit is set | "leaf at an even index has pathIndices[0] = 0" etc. |
| Swap hash arguments in tree build (`current[i]` ↔ `current[i+1]`) | `create()` | A test that only checks `tree.root` is a bigint accepts any root | "root of a full depth-1 tree equals poseidon(left, right)" etc. |
| Off-by-one in `Math.floor(index / 2)` → `index / 2` | `proof()` | All path ascent tests pass if the floor is applied consistently — but the path index accumulates wrong for odd depths | `recomputeRoot` tests across depth-2 and depth-3 trees |

### `src/identity.ts`

| Mutant class | Location | Killing test |
|---|---|---|
| Swap `poseidon(a, b)` → `poseidon(b, a)` in `generateIdentity` | `commitment = poseidon(nullifier, secret)` | "commitment does NOT equal poseidon(identitySecret, identityNullifier)" |
| Swap args in `computeNullifierHash` | `poseidon(identityNullifier, externalNullifier)` | "does NOT equal poseidon(externalNullifier, identityNullifier)" |
| Remove `% FR_MODULUS` from `randomFieldElement` | Wide-reduction | "always returns a value in [0, FR_MODULUS)" × 200 draws |
| Remove `% FR_MODULUS` from `computeExternalNullifier` | SHA-256 reduction | "result is always in [0, FR_MODULUS)" |
| Remove circleId or round encoding bytes | `setBigUint64` / `setUint32` | "differs when only circleId changes" / "differs when only round changes" |

## Mutation classes Stryker applies (for reference)

Stryker's default TypeScript mutators relevant to this codebase:

- **ArithmeticOperator** — `+` ↔ `-`, `*` ↔ `/`, `%` removed
- **EqualityOperator** — `===` ↔ `!==`, `<` ↔ `<=`, `>=` ↔ `>`
- **LogicalOperator** — `&&` ↔ `||`
- **ConditionalExpression** — truthy/falsy branches flipped
- **BlockStatement** — empty a function body
- **UnaryOperator** — prefix `!` added/removed

`StringLiteral` mutations are excluded in `stryker.conf.json` — they produce
noise (error message text) with no security relevance.

## Thresholds

| Threshold | Value | Meaning |
|---|---|---|
| `high` | 80% | Score at or above this prints green |
| `low` | 60% | Score below this prints red |
| `break` | null | CI is not broken by mutation score (run is on-demand only) |

Adjust `thresholds.break` in `stryker.conf.json` if you want the `just mutation`
recipe to exit non-zero below a floor.
