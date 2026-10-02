/**
 * Explicit allowlist of archived documentation that doc-accuracy /
 * structure-test suites (#537) must skip.
 *
 * An archive is allowed to contain stale claims (old contract IDs, old
 * public-input shapes, historical evidence). Skipping these paths is
 * deliberate — not an oversight.
 *
 * Rule: any file under `docs/hackathon/` is archived. Matchers may also
 * look for the in-file `Point-in-time archive` notice.
 */
export const ARCHIVED_DOC_GLOBS = ["docs/hackathon/**"];

export const ARCHIVED_DOC_NOTICE = "Point-in-time archive";

/** Returns true when `relativePath` (posix, repo-root-relative) is archived. */
export function isArchivedDoc(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  return (
    normalized.startsWith("docs/hackathon/") ||
    ARCHIVED_DOC_GLOBS.some((g) => {
      const prefix = g.replace(/\/\*\*$/, "/");
      return normalized.startsWith(prefix);
    })
  );
}
