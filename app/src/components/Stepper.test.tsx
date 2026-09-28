import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { Stepper } from "./Stepper";

function renderStepper(step: 0 | 1 | 2 | 3) {
  return render(
    <I18nProvider>
      <Stepper step={step} />
    </I18nProvider>,
  );
}

describe("Stepper", () => {
  beforeEach(() => localStorage.clear());

  it("marks the current step and labels the rest", () => {
    renderStepper(1);
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Fund");
    expect(screen.getByText("Create")).toBeInTheDocument();
    expect(screen.getByText("Prove & Claim")).toBeInTheDocument();
    expect(screen.getByText("Unlinked ✓")).toBeInTheDocument();
  });
});
