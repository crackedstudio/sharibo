import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { Member } from "../types";
import { FundingList } from "./FundingList";

function member(funded: boolean): Member {
  return {
    keypair: { publicKey: () => "GDEMO0000000000000000000000000000000000000000000000KEY" },
    identity: { commitment: 1n, identityNullifier: 1n, identitySecret: 1n },
    funded,
  } as Member;
}

describe("FundingList", () => {
  beforeEach(() => localStorage.clear());

  it("renders each member and funds the one that is clicked", () => {
    const onFund = vi.fn();
    render(
      <I18nProvider>
        <FundingList
          members={[member(true), member(false)]}
          busy={null}
          round={0}
          contributionXlm={10}
          online
          hasFreighter={false}
          onFund={onFund}
          onFundWithFreighter={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("heading", { name: "Fund" })).toBeInTheDocument();
    expect(screen.getByText(/member 1/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /fund 10 xlm/i }));
    expect(onFund).toHaveBeenCalledWith(1);
  });
});
