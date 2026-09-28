import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { MemberRing } from "./MemberRing";

function renderRing(revealed: boolean) {
  return render(
    <I18nProvider>
      <MemberRing
        revealed={revealed}
        members={[{ funded: true }, { funded: true }, { funded: false }, { funded: false }, { funded: false }]}
      />
    </I18nProvider>,
  );
}

describe("MemberRing", () => {
  beforeEach(() => localStorage.clear());

  it("describes funding progress and hides the unlinkability caption until payout", () => {
    renderRing(false);
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "5-member circle, 2 of 5 funded, pot not yet claimed.",
    );
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("shows the unlinkability caption after a claim", () => {
    renderRing(true);
    expect(screen.getByRole("note")).toHaveTextContent(/any/i);
    expect(screen.getByRole("note")).toHaveTextContent(/5 members/);
  });
});
