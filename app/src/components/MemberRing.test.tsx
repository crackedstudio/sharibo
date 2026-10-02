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
  it("renders an SVG that scales via viewBox", () => {
    const { container } = render(<MemberRing members={members} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("viewBox");
  });

  it("renders a node for every member", () => {
    render(<MemberRing members={members} />);
    expect(screen.getByText("AD")).toBeInTheDocument();
    expect(screen.getByText("GR")).toBeInTheDocument();
    expect(screen.getByText("LI")).toBeInTheDocument();
  });

  it("marks a member who has already claimed as ineligible", () => {
    render(<MemberRing members={members} />);
    expect(screen.getByLabelText(/already claimed/i)).toBeInTheDocument();
  });

  it("describes funding progress and hides the unlinkability caption until payout", () => {
    renderRing(false);
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "5-member circle, 2 of 5 funded, pot not yet claimed.",
    );
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

describe("component stylesheets", () => {
  it("imports every sibling *.module.css from a .tsx component", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = path.dirname(new URL(import.meta.url).pathname);
    const entries = await fs.readdir(dir);
    const modules = entries.filter((f) => f.endsWith(".module.css"));
    const sources = await Promise.all(
      entries.filter((f) => f.endsWith(".tsx")).map((f) => fs.readFile(path.join(dir, f), "utf8")),
    );
    const orphans = modules.filter((m) => !sources.some((src) => src.includes(`./${m}`)));
    expect(orphans).toEqual([]);
  });
});
