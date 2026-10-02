import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { Member } from "../types";
import { ClaimSection } from "./ClaimSection";

function member(ineligible = false): Member {
  return {
    keypair: { publicKey: () => "GDEMO0000000000000000000000000000000000000000000000KEY" },
    identity: { commitment: 1n, identityNullifier: 1n, identitySecret: 1n },
    funded: true,
    ineligible,
  } as Member;
}

describe("ClaimSection", () => {
  beforeEach(() => localStorage.clear());

  it("lets the operator pick a member and start the claim", () => {
    const onSelectClaimant = vi.fn();
    const onClaim = vi.fn();
    render(
      <I18nProvider>
        <ClaimSection
          members={[member(), member(true)]}
          claimantIndex={0}
          onSelectClaimant={onSelectClaimant}
          busy={null}
          claimStage={null}
          proveElapsedSeconds={0}
          isProving={false}
          online
          onClaim={onClaim}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("heading", { name: "Claim" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /member 2/i }));
    expect(onSelectClaimant).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: /generate proof & claim/i }));
    expect(onClaim).toHaveBeenCalledOnce();
  });
});
