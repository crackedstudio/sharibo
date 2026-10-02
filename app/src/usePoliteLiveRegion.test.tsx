import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveRegion, usePoliteLiveRegion } from "./usePoliteLiveRegion";

function Harness() {
  const { announce, message } = usePoliteLiveRegion(50);

  return (
    <div>
      <button onClick={() => announce("Success: price update complete.")}>announce success</button>
      <button onClick={() => announce("Error: price update failed.")}>announce failure</button>
      <button onClick={() => announce("Help: Generating a fresh admin…")}>announce help</button>
      <button onClick={() => announce("")}>announce empty</button>
      <button onClick={() => announce("Help: Creating the circle on testnet…")}>
        announce creating
      </button>
      <LiveRegion message={message} />
    </div>
  );
}

describe("usePoliteLiveRegion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("announces a success message after the debounce window", () => {
    render(<Harness />);

    act(() => {
      screen.getByRole("button", { name: /announce success/i }).click();
    });

    const liveRegion = screen.getByRole("status");
    expect(liveRegion.textContent).toBe("");

    act(() => {
      vi.advanceTimersByTime(49);
    });
    expect(liveRegion.textContent).toBe("");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(liveRegion.textContent).toBe("Success: price update complete.");
  });

  it("debounces rapid updates and announces the latest message", () => {
    render(<Harness />);

    act(() => {
      screen.getByRole("button", { name: /announce success/i }).click();
      screen.getByRole("button", { name: /announce failure/i }).click();
    });

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(screen.getByRole("status").textContent).toBe("Error: price update failed.");
  });

  it("announces a failure message", () => {
    render(<Harness />);

    act(() => {
      screen.getByRole("button", { name: /announce failure/i }).click();
    });

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(screen.getByRole("status").textContent).toBe("Error: price update failed.");
  });

  describe("help / busy announcements", () => {
    it("announces a help message with the Help: prefix", () => {
      render(<Harness />);

      act(() => {
        screen.getByRole("button", { name: /announce help/i }).click();
      });

      act(() => {
        vi.advanceTimersByTime(50);
      });

      expect(screen.getByRole("status").textContent).toBe("Help: Generating a fresh admin…");
    });

    it("announces a different help/busy message", () => {
      render(<Harness />);

      act(() => {
        screen.getByRole("button", { name: /announce creating/i }).click();
      });

      act(() => {
        vi.advanceTimersByTime(50);
      });

      expect(screen.getByRole("status").textContent).toBe("Help: Creating the circle on testnet…");
    });

    it("clears the live region when an empty message is announced", () => {
      render(<Harness />);

      // First announce a help message
      act(() => {
        screen.getByRole("button", { name: /announce help/i }).click();
      });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(screen.getByRole("status").textContent).toBe("Help: Generating a fresh admin…");

      // Then clear it
      act(() => {
        screen.getByRole("button", { name: /announce empty/i }).click();
      });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(screen.getByRole("status").textContent).toBe("");
    });

    it("replaces a help message with a success message after busy completes", () => {
      render(<Harness />);

      // Simulate: busy → announce help, then busy clears → announce success
      act(() => {
        screen.getByRole("button", { name: /announce help/i }).click();
      });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(screen.getByRole("status").textContent).toBe("Help: Generating a fresh admin…");

      // Busy cleared, success arrives
      act(() => {
        screen.getByRole("button", { name: /announce success/i }).click();
      });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(screen.getByRole("status").textContent).toBe("Success: price update complete.");
    });

    it("replaces a help message with an error message on failure", () => {
      render(<Harness />);

      // Busy state
      act(() => {
        screen.getByRole("button", { name: /announce help/i }).click();
      });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(screen.getByRole("status").textContent).toBe("Help: Generating a fresh admin…");

      // Error state
      act(() => {
        screen.getByRole("button", { name: /announce failure/i }).click();
      });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(screen.getByRole("status").textContent).toBe("Error: price update failed.");
    });

    it("debounces rapid help updates and announces the latest help message", () => {
      render(<Harness />);

      act(() => {
        screen.getByRole("button", { name: /announce help/i }).click();
        screen.getByRole("button", { name: /announce creating/i }).click();
      });

      act(() => {
        vi.advanceTimersByTime(50);
      });

      // Only the last message should be announced
      expect(screen.getByRole("status").textContent).toBe("Help: Creating the circle on testnet…");
    });
  });
});
