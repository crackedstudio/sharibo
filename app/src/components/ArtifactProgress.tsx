import { useEffect, useState } from "react";
import {
  subscribeToArtifactPrefetch,
  prefetchMembershipArtifacts,
  type ArtifactPrefetchProgress,
} from "@sharibo/client";

const IDLE = "idle";
const READY = "ready";
const LOADING = "loading";
const ERROR = "error";

function describe(progress: ArtifactPrefetchProgress): string {
  if (progress.status === ERROR) {
    return "Prover preparation failed.";
  }
  if (progress.status === LOADING) {
    return progress.fraction === null
      ? "Preparing prover…"
      : `Preparing prover… ${Math.round(progress.fraction * 100)}%`;
  }
  return "";
}

function filledPercent(progress: ArtifactPrefetchProgress): number {
  if (progress.status === ERROR) {
    return 100;
  }
  if (progress.fraction === null) {
    return 0;
  }
  return Math.round(progress.fraction * 100);
}

export function ArtifactProgress({
  announce,
}: {
  announce: (message: string) => void;
}) {
  const [progress, setProgress] = useState<ArtifactPrefetchProgress>({
    status: IDLE,
    loaded: 0,
    total: null,
    fraction: null,
  });

  useEffect(() => {
    // The SDK is headless: it no longer starts the download by itself, so
    // kick it off here and rely on the subscription below for updates.
    // Failures are delivered via a publish() of status "error"; swallowing
    // the rejection here avoids an unhandled promise rejection.
    prefetchMembershipArtifacts().catch(() => {});
    return subscribeToArtifactPrefetch(setProgress);
  }, []);

  const label = describe(progress);
  const percent = filledPercent(progress);

  useEffect(() => {
    // Announce through the app's single shared live region, not a second
    // separate aria-live region (two competing regions talk over each other).
    announce(label);
  }, [announce, label]);

  if (progress.status === IDLE || progress.status === READY) {
    return null;
  }

  return (
    <div className="artifact-progress">
      <p className="artifact-progress-label">{label}</p>
      <div className="artifact-progress-track" aria-hidden="true">
        <div
          className={
            progress.status === ERROR
              ? "artifact-progress-fill artifact-progress-fill-error"
              : "artifact-progress-fill"
          }
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
