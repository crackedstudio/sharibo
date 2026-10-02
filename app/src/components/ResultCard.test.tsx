import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { ResultCard } from "./ResultCard";

const claimResult = {
  recipient: "GRECIPIENTADDRESS00000000000000000000000000000000000000",
  hash: "txhashdemo000000000000000000000000000000000000000000000000",
  proofDurationMs: 1500,
  verifyTimeMs: 42,
};

describe("ResultCard", () => {
  beforeEach(() => localStorage.clear());

  it("shows the payout and replays the proof when asked", () => {
    const onClaimAgain = vi.fn();
    render(
      <I18nProvider>
        <ResultCard
          claimResult={claimResult}
          rejection={null}
          busy={null}
          nullifierClaimed={false}
          circleId={7n}
          online
          onClaimAgain={onClaimAgain}
          onReset={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("heading", { name: /payout landed/i })).toBeInTheDocument();
    expect(screen.getByText(/proof generated in 1.5s/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try to claim again/i }));
    expect(onClaimAgain).toHaveBeenCalledOnce();
  });

  it("offers a new circle after an on-chain rejection", () => {
    const onReset = vi.fn();
    render(
      <I18nProvider>
        <ResultCard
          claimResult={claimResult}
          rejection="Already claimed"
          busy={null}
          nullifierClaimed
          circleId={7n}
          online
          onClaimAgain={vi.fn()}
          onReset={onReset}
        />
      </I18nProvider>,
    );

    expect(screen.getByText(/already claimed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start a new circle" }));
    expect(onReset).toHaveBeenCalledOnce();
  });
});
