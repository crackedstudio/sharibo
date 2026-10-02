import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MemberRing, { type Member } from "./MemberRing";

const members: Member[] = [
  { id: "1", name: "Ada", initials: "AD", amount: 120 },
  { id: "2", name: "Grace", initials: "GR", amount: 80 },
  { id: "3", name: "Linus", initials: "LI", amount: 40, ineligible: true },
];

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

  it("does not mark eligible members as ineligible", () => {
    render(<MemberRing members={members} />);
    expect(screen.queryByLabelText(/Ada.*already claimed/i)).toBeNull();
  });
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
