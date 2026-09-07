import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "./ErrorBoundary";

function ThrowingChild(): never {
  throw new Error("render exploded");
}

describe("ErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a useful fallback and reports the component stack", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("heading", { name: "Something broke" })).toBeInTheDocument();
    expect(screen.getByText("render exploded")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /file a GitHub issue/i })).toHaveAttribute(
      "href",
      "https://github.com/crackedstudio/sharibo/issues/new",
    );
    expect(consoleError).toHaveBeenCalledWith(
      "Uncaught render error:",
      expect.objectContaining({ message: "render exploded" }),
      expect.stringContaining("ThrowingChild"),
    );
  });

  it("reloads the app when the recovery control is activated", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onReset = vi.fn();

    render(
      <ErrorBoundary onReset={onReset}>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start over" }));

    expect(onReset).toHaveBeenCalledOnce();
  });
});
