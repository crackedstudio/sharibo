import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArtifactProgress } from "./ArtifactProgress";

interface ArtifactPrefetchProgress {
  status: "idle" | "loading" | "ready" | "error";
  loaded: number;
  total: number | null;
  fraction: number | null;
  error?: Error;
}

type Listener = (progress: ArtifactPrefetchProgress) => void;

let lastListener: Listener | null = null;

vi.mock("@sharibo/client", () => ({
  subscribeToArtifactPrefetch: (listener: Listener) => {
    lastListener = listener;
    return () => {
      lastListener = null;
    };
  },
  prefetchMembershipArtifacts: () => Promise.resolve({ wasm: null, zkey: null }),
  getArtifactPrefetchProgress: () => ({ status: "idle" }),
}));

function publish(progress: ArtifactPrefetchProgress) {
  act(() => {
    lastListener?.(progress);
  });
}

describe("ArtifactProgress", () => {
  it("shows progress while loading and hides itself once ready", () => {
    const announce = vi.fn();
    render(<ArtifactProgress announce={announce} />);

    publish({ status: "loading", loaded: 0, total: null, fraction: null });
    expect(document.querySelector(".artifact-progress")).not.toBeNull();
    expect(screen.getByText("Preparing prover…")).toBeTruthy();

    publish({ status: "loading", loaded: 50, total: 100, fraction: 0.5 });
    expect(screen.getByText("Preparing prover… 50%")).toBeTruthy();
    expect(
      document.querySelector(".artifact-progress-fill")?.getAttribute("style"),
    ).toContain("width: 50%");

    publish({ status: "ready", loaded: 100, total: 100, fraction: 1 });
    expect(document.querySelector(".artifact-progress")).toBeNull();
  });

  it("announces through the provided callback and renders no aria-live region", () => {
    const announce = vi.fn();
    render(<ArtifactProgress announce={announce} />);

    publish({ status: "loading", loaded: 50, total: 100, fraction: 0.5 });

    expect(announce).toHaveBeenCalledWith("Preparing prover… 50%");
    expect(document.querySelector("[aria-live]")).toBeNull();
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it("shows the error state and marks the fill with the error styling", () => {
    const announce = vi.fn();
    render(<ArtifactProgress announce={announce} />);

    publish({
      status: "error",
      loaded: 10,
      total: 100,
      fraction: 0.1,
      error: new Error("boom"),
    });

    expect(screen.getByText("Prover preparation failed.")).toBeTruthy();
    expect(announce).toHaveBeenCalledWith("Prover preparation failed.");
    expect(
      document
        .querySelector(".artifact-progress-fill")
        ?.classList.contains("artifact-progress-fill-error"),
    ).toBe(true);
  });
});
