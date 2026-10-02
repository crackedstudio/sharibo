/**
 * Teaches TypeScript that `toHaveNoViolations()` exists on Vitest assertions.
 *
 * vitest-axe 0.1.0 ships this augmentation itself, but it targets the
 * pre-vitest-4 layout: it augments a global `Vi.Assertion` interface that no
 * longer exists, and its documented entrypoint (`vitest-axe/extend-expect`)
 * has an empty runtime module, so neither half reaches this program. In vitest
 * 4 the assertion chain is rooted at Chai's `Assertion`, so that is what
 * `Chai.Assertion` is augmented on here.
 *
 * setupTests.ts registers the matcher at runtime; this file is the matching
 * declaration so the a11y guards typecheck.
 */
declare global {
  namespace Chai {
    interface Assertion {
      /**
       * Asserts that an axe-core run produced no violations. Pass the results
       * of `axe()` from vitest-axe.
       */
      toHaveNoViolations(): void;
    }
  }
}

export {};
