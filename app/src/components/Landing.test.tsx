import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { Landing } from "./Landing";

function renderLanding(onLaunch = vi.fn()) {
  render(
    <I18nProvider>
      <Landing
        busy={null}
        error={null}
        online
        previousCircleId={null}
        prevCircle={null}
        failure={null}
        onDismissFailure={vi.fn()}
        onLaunch={onLaunch}
      />
    </I18nProvider>,
  );
  return onLaunch;
}

describe("Landing", () => {
  beforeEach(() => localStorage.clear());

  it("renders the launch screen and starts a circle from the button", () => {
    const onLaunch = renderLanding();
    expect(screen.getByRole("heading", { name: /sharibo/i })).toBeInTheDocument();
    expect(screen.getByText(/private rotating savings circle/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /launch a 5-member circle on testnet/i }));
    expect(onLaunch).toHaveBeenCalledOnce();
  });
});
