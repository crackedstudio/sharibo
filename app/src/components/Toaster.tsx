import type { Failure } from "../state/circleMachine.js";

// The notification that surfaces a failed step. The retry action lives here,
// on the Failure object, so the Toaster only has to invoke `failure.retry()`
// — it never needs to know which step handler to re-run.
export function Toaster({
  failure,
  busy,
  online,
  onDismiss,
}: {
  failure: Failure | null;
  busy: boolean;
  online: boolean;
  onDismiss: () => void;
}) {
  if (!failure) return null;

  return (
    <div className="toaster" role="alert" aria-live="assertive">
      <p className="toaster-msg">{failure.message}</p>
      <div className="toaster-actions">
        {failure.retryable && (
          <button
            type="button"
            className="btn btn-primary btn-small"
            disabled={!online || busy}
            onClick={() => failure.retry()}
          >
            Retry
          </button>
        )}
        <button
          type="button"
          className="btn btn-small"
          disabled={busy}
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
