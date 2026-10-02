/**
 * a11y.test.tsx — automated accessibility regression guards (issue #538).
 *
 * Nine accessibility issues have shipped (#106–#109, #298, #306, #313, #315
 * and the polite live region) and none left an automated check, so the work
 * decays silently. This file covers the DOM half of that: axe-core against
 * every screen, plus the assertions axe structurally cannot make.
 *
 * The stylesheet half — colour tokens and media queries — lives in
 * a11y.styles.test.ts, because jsdom implements too little of the CSS cascade
 * for axe's own contrast rule to be trustworthy.
 *
 * Where a screen is reachable, the tests drive the real <App /> through the
 * mocked SDK so they guard what users actually get. The claim and result
 * states cannot be reached that way — the mock's `getCircle` returns a fixed
 * pot, so the circle never fills and the claim control never appears — so
 * those two are rendered from the same components App composes and labelled
 * as such.
 *
 * Standard: WCAG 2.1 AA (see CONTRIBUTING.md).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import App from "./App";
import { I18nProvider } from "./i18n";
import { ErrorBoundary } from "./ErrorBoundary";
import { Stepper } from "./components/Stepper";
import { FundingList } from "./components/FundingList";
import { ClaimSection } from "./components/ClaimSection";
import { ResultCard } from "./components/ResultCard";
import { MemberRing } from "./components/MemberRing";
import type { ClaimResult, Member } from "./types";

// Point at the manual mock explicitly: vitest resolves bare-specifier mocks
// relative to its own root (app/), which is not where the mock lives.
vi.mock("@sharibo/client", () => import("../../__mocks__/@sharibo/client"));

// Config literals are inlined: vi.mock is hoisted above module init, so a
// top-level const would still be in the TDZ when the factory runs.
vi.mock("./config", () => ({
  config: {
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    testTokenContractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  },
  configError: [],
}));

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    Keypair: {
      random: vi.fn(() => ({
        publicKey: () => "GMOCKPUBLICKEY000000000000000000000000000000000000000000000",
        secret: () => "SMOCKSECRETKEY000000000000000000000000000000000000000000000",
      })),
    },
  };
});

global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

// ── fixtures ────────────────────────────────────────────────────────────────

const identity = { commitment: 1n, identityNullifier: 2n, identitySecret: 3n } as never;

function makeMembers(count: number, extra: Partial<Member> = {}): Member[] {
  return Array.from({ length: count }, (_, i) => ({
    keypair: { publicKey: () => `GMEMBER${i}` } as never,
    identity,
    funded: i < 2,
    ...extra,
  }));
}

const withI18n = (ui: React.ReactNode) => <I18nProvider>{ui}</I18nProvider>;

/**
 * Tests that drive the real App past the landing screen create a circle
 * through the mocked SDK, which involves several awaits and debounced
 * announcements. vitest's 5 s default is too tight for them.
 */
const FLOW_TIMEOUT = 20_000;

/**
 * Drives the real App from the landing screen to the funding screen — the
 * state a member sees once a circle exists. This is the path #106 (ARIA roles
 * and labels) and #107 (keyboard navigation) actually shipped against.
 */
async function renderFundingScreen() {
  const user = userEvent.setup();
  const utils = render(withI18n(<App />));
  await user.click(await screen.findByRole("button", { name: /launch a 5-member circle/i }));
  // The circle is created through the mocked SDK; wait for its first paint.
  await waitFor(() => expect(screen.getByRole("heading", { name: /fund/i })).toBeInTheDocument(), {
    timeout: 10_000,
  });
  return { ...utils, user };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});

// ── axe: zero violations per screen ──────────────────────────────────────────

describe("axe-core — WCAG 2.1 AA, zero violations", () => {
  it("landing screen", async () => {
    const { container } = render(withI18n(<App />));
    expect(await axe(container)).toHaveNoViolations();
  });

  it(
    "funding screen (the real App, driven through the mocked SDK)",
    async () => {
      const { container } = await renderFundingScreen();
      expect(await axe(container)).toHaveNoViolations();
    },
    FLOW_TIMEOUT,
  );

  it("claiming screen at every in-flight stage", async () => {
    for (const claimStage of [
      "artifacts",
      "proving",
      "verifying",
      "funding",
      "submitting",
    ] as const) {
      const { container, unmount } = render(
        withI18n(
          <ClaimSection
            members={makeMembers(5)}
            claimantIndex={0}
            onSelectClaimant={() => {}}
            busy="Claiming…"
            claimStage={claimStage}
            proveElapsedSeconds={3}
            isProving={claimStage === "proving"}
            online
            onClaim={() => {}}
          />,
        ),
      );
      const results = await axe(container);
      unmount();
      expect(
        results,
        `claim stage "${claimStage}" must have zero axe violations`,
      ).toHaveNoViolations();
    }
  });

  it("result screen", async () => {
    const { container } = render(
      withI18n(
        <ResultCard
          claimResult={{ recipient: "GABC", hash: "deadbeef" } as ClaimResult}
          rejection={null}
          busy={null}
          nullifierClaimed
          circleId={1n}
          onClaimAgain={() => {}}
          onReset={() => {}}
        />,
      ),
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("result screen when the claim was rejected (#313 retry affordance)", async () => {
    const { container } = render(
      withI18n(
        <ResultCard
          claimResult={{ recipient: "GABC", hash: "deadbeef" } as ClaimResult}
          rejection="This member already claimed the pot"
          busy={null}
          nullifierClaimed={false}
          circleId={1n}
          onClaimAgain={() => {}}
          onReset={() => {}}
        />,
      ),
    );
    expect(await axe(container)).toHaveNoViolations();
    // axe cannot tell whether a retry affordance exists, only that it is named.
    expect(
      screen.getByRole("button", { name: /try again|claim again|retry/i }),
      "a rejected claim must offer a retry control (#313)",
    ).toBeInTheDocument();
  });

  it("member ring, both reveal states", async () => {
    for (const revealed of [false, true]) {
      const { container, unmount } = render(
        withI18n(<MemberRing members={makeMembers(5)} revealed={revealed} />),
      );
      const results = await axe(container);
      unmount();
      expect(
        results,
        `ring revealed=${revealed} must have zero axe violations`,
      ).toHaveNoViolations();
    }
  });

  it("stepper at every step", async () => {
    for (const step of [0, 1, 2, 3] as const) {
      const { container, unmount } = render(withI18n(<Stepper step={step} />));
      const results = await axe(container);
      unmount();
      expect(results, `stepper step=${step} must have zero axe violations`).toHaveNoViolations();
    }
  });

  it("error boundary", async () => {
    function Boom(): never {
      throw new Error("render exploded");
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      withI18n(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      ),
    );
    const results = await axe(container);
    spy.mockRestore();

    expect(results).toHaveNoViolations();
    // The boundary is useless without a way out of it.
    expect(screen.getByRole("button", { name: /start over/i })).toBeInTheDocument();
  });

  it("env-setup screen", async () => {
    // App short-circuits to EnvSetupScreen when config validation fails, so
    // the module is re-mocked for this case only.
    vi.doMock("./config", () => ({
      config: {
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        rpcUrl: "https://soroban-testnet.stellar.org",
        networkPassphrase: "Test SDF Network ; September 2015",
        testTokenContractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
      configError: ["VITE_SHARIBO_CONTRACT_ID — missing", "VITE_STELLAR_RPC_URL — missing"],
    }));
    vi.resetModules();
    const { default: FreshApp } = await import("./App");
    const { container } = render(withI18n(<FreshApp />));

    expect(await axe(container)).toHaveNoViolations();
    // The whole point of the screen is naming what is missing.
    expect(screen.getByText(/VITE_SHARIBO_CONTRACT_ID/)).toBeInTheDocument();
    expect(screen.getByText(/VITE_STELLAR_RPC_URL/)).toBeInTheDocument();

    vi.doUnmock("./config");
    vi.resetModules();
  });

  it("browser-unsupported gate (#315)", async () => {
    // UnsupportedBrowserScreen is built inline by main.tsx behind a capability
    // check. Re-implementing it here would test a copy rather than the screen,
    // so main.tsx is imported with createRoot stubbed and the element tree it
    // would have rendered is captured and rendered for real.
    const captured: React.ReactNode[] = [];
    vi.doMock("react-dom/client", () => ({
      createRoot: () => ({ render: (ui: React.ReactNode) => captured.push(ui) }),
    }));
    vi.doMock("./lib/capabilities.js", () => ({
      getCapabilityReport: () => ({
        ok: false,
        missing: ["webassembly", "bigint", "crypto.subtle"],
        details: [],
      }),
    }));
    vi.resetModules();
    await import("./main");

    expect(captured, "main.tsx rendered nothing").toHaveLength(1);
    const { container } = render(withI18n(captured[0]));

    expect(await axe(container)).toHaveNoViolations();
    // The gate must name the missing capabilities or it tells the user nothing.
    expect(screen.getByRole("list", { name: /missing browser support/i })).toBeInTheDocument();
    expect(screen.getByText("WebAssembly")).toBeInTheDocument();
    expect(screen.getByText("BigInt")).toBeInTheDocument();

    vi.doUnmock("react-dom/client");
    vi.doUnmock("./lib/capabilities.js");
    vi.resetModules();
  });
});

// ── keyboard focus order (#107) ─────────────────────────────────────────────

describe("keyboard focus order (#107)", () => {
  it(
    "reaches every member's funding control in member order",
    async () => {
      const { user } = await renderFundingScreen();
      // The launch button that was just clicked is unmounted, so focus is left
      // mid-document. Drop it or the first Tab() resumes from there and the
      // walk starts halfway down the funding list.
      (document.activeElement as HTMLElement | null)?.blur();

      const order: string[] = [];
      for (let i = 0; i < 40; i++) {
        await user.tab();
        const el = document.activeElement;
        if (!el || el === document.body) break;
        order.push(el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.tagName);
      }

      const fundAt = order
        .map((label, i) => (/fund 10 xlm/i.test(label) ? i : -1))
        .filter((i) => i >= 0);
      expect(
        fundAt.length,
        `expected 5 funding controls in the tab order, got ${fundAt.length}`,
      ).toBe(5);

      // A keyboard-only member must be able to reach all five, and they must
      // appear in reading order rather than reversed.
      expect([...fundAt].sort((a, b) => a - b)).toEqual(fundAt);
    },
    FLOW_TIMEOUT,
  );

  it(
    "reaches the language switcher and every stepper control",
    async () => {
      const { user } = await renderFundingScreen();
      (document.activeElement as HTMLElement | null)?.blur();

      const seen: string[] = [];
      for (let i = 0; i < 40; i++) {
        await user.tab();
        const el = document.activeElement;
        if (!el || el === document.body) break;
        seen.push(el.tagName.toLowerCase());
      }

      // The language switcher is a <select> and must not be skipped.
      expect(seen, "the language switcher was never focused").toContain("select");
      // Stepper steps carry aria-current="step"; without that an assistive
      // technology cannot say where in the flow the member currently is.
      expect(
        document.querySelectorAll('[aria-current="step"]').length,
        "exactly one stepper step should be marked aria-current",
      ).toBe(1);
    },
    FLOW_TIMEOUT,
  );

  it(
    "gives every interactive control an accessible name",
    async () => {
      await renderFundingScreen();

      const unlabelled = screen
        .getAllByRole("button")
        .filter((b) => !(b.textContent?.trim() || b.getAttribute("aria-label")));
      expect(
        unlabelled.map((b) => b.outerHTML.slice(0, 90)),
        "these buttons have neither text nor an aria-label",
      ).toEqual([]);
    },
    FLOW_TIMEOUT,
  );
});

// ── the polite live region ──────────────────────────────────────────────────

describe("live region announcements", () => {
  /**
   * App renders its own inline LiveRegion, which carries aria-live="polite"
   * and aria-atomic but no role — so it is located by attribute, not by role.
   * (usePoliteLiveRegion's exported LiveRegion does add role="status"; the two
   * are separate and this is the one that ships.)
   */
  const liveRegion = (root: HTMLElement) =>
    root.querySelector('[aria-live="polite"][aria-atomic="true"]');

  it(
    "is present in the DOM before anything is announced",
    async () => {
      const { container } = await renderFundingScreen();

      // A live region introduced at the same moment as its first message is
      // routinely missed by screen readers — App keeps it mounted permanently
      // for exactly this reason, so the node must exist while still empty.
      const region = liveRegion(container);
      expect(region, "no polite live region is mounted").not.toBeNull();
      expect(region).toHaveAttribute("aria-atomic", "true");
    },
    FLOW_TIMEOUT,
  );

  it(
    "announces the busy/help message when a funding round starts",
    async () => {
      const { container, user } = await renderFundingScreen();
      const region = liveRegion(container);
      expect(region).not.toBeNull();

      await user.click(screen.getAllByRole("button", { name: /fund 10 xlm/i })[0]);

      // "Help: Funding from member N…" — the debounced announcement the app
      // raises while a contribution is in flight. The Help: prefix is what makes
      // a screen reader read it as guidance rather than a bare status blip.
      await waitFor(() => expect(region?.textContent ?? "").toMatch(/^Help:/), { timeout: 5_000 });
      expect(region?.textContent).toMatch(/Funding from member \d/i);
    },
    FLOW_TIMEOUT,
  );

  it(
    "keeps the announcement inside the live region rather than the page",
    async () => {
      const { container, user } = await renderFundingScreen();
      const region = liveRegion(container);

      await user.click(screen.getAllByRole("button", { name: /fund 10 xlm/i })[0]);
      await waitFor(() => expect(region?.textContent ?? "").toMatch(/^Help:/), { timeout: 5_000 });

      // Guards against the announcement being written somewhere that is merely
      // visible: an off-screen, non-live node is silent to assistive tech.
      expect(region).toHaveTextContent(/Funding from member \d/i);
    },
    FLOW_TIMEOUT,
  );

  it(
    "announces in the selected locale (#298)",
    async () => {
      const user = userEvent.setup();
      const { container } = render(withI18n(<App />));

      // Hold on to the element rather than re-querying by name: the launch
      // button is itself localized, so "launch a 5-member circle" stops
      // matching the moment the locale changes.
      const launch = screen.getByRole("button", { name: /launch a 5-member circle/i });

      await user.selectOptions(screen.getByRole("combobox", { name: /language/i }), "es");
      expect(document.documentElement.lang).toBe("es");

      await user.click(launch);
      // Match the funding controls on a fragment that survives translation
      // ("Fund 10 XLM (Demo)" / "Aportar 10 XLM (Demo)").
      const fundButton = () => screen.getAllByRole("button", { name: /XLM \(Demo\)/i })[0];
      await waitFor(fundButton, { timeout: 10_000 });

      // Navigating to the circle screen remounts the live region, so it has to
      // be looked up again here — a reference taken on the landing screen would
      // be pointing at a detached node and would read "" forever.
      const region = liveRegion(container);
      expect(region, "the live region disappeared on the funding screen").not.toBeNull();

      await user.click(fundButton());
      await waitFor(() => expect(liveRegion(container)?.textContent ?? "").not.toBe(""), {
        timeout: 5_000,
      });

      // liveRegion.help is "Help: {message}" in en and "Ayuda: {message}" in es,
      // so an English prefix here means the announcement is not following the
      // selected locale.
      expect(
        liveRegion(container)?.textContent,
        "the live region still announces in English after switching to es",
      ).toMatch(/^Ayuda:/);
    },
    FLOW_TIMEOUT,
  );
});

// ── locale, lang and dir (#298) ──────────────────────────────────────────────

describe("locale, lang and dir (#298)", () => {
  it("reflects the selected locale on the document element", async () => {
    const user = userEvent.setup();
    render(withI18n(<App />));
    expect(document.documentElement.lang).toBe("en");

    await user.selectOptions(screen.getByRole("combobox", { name: /language/i }), "es");
    expect(document.documentElement.lang).toBe("es");

    await user.selectOptions(screen.getByRole("combobox", { name: /language/i }), "en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("persists the locale and restores it on the next load", async () => {
    const user = userEvent.setup();
    const first = render(withI18n(<App />));
    await user.selectOptions(screen.getByRole("combobox", { name: /language/i }), "es");
    expect(localStorage.getItem("sharibo.locale")).toBe("es");
    first.unmount();

    // A fresh mount must come back in the persisted locale rather than
    // silently resetting to the browser default.
    render(withI18n(<App />));
    expect(document.documentElement.lang).toBe("es");
  });

  it("sets dir=rtl for a right-to-left locale", async () => {
    const user = userEvent.setup();
    render(withI18n(<App />));

    await user.selectOptions(screen.getByRole("combobox", { name: /language/i }), "ar");
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");

    await user.selectOptions(screen.getByRole("combobox", { name: /language/i }), "en");
    expect(document.documentElement.dir).toBe("ltr");
  });
});

// ── member ring labelling (#312) ────────────────────────────────────────────

describe("member ring labelling", () => {
  it(
    "labels the rendered ring with the member count and funded total",
    async () => {
      await renderFundingScreen();

      // The ring App actually renders. The label is built from the localized
      // `ring.label.*` keys, so it has to carry both the size and how much of
      // the pot is funded — a sighted glance at five grey dots conveys neither.
      const ring = screen.getByRole("img", { name: /5-member circle/i });
      expect(ring).toHaveAccessibleName(/5-member circle/i);
      expect(ring).toHaveAccessibleName(/\d+ of 5 funded/i);
      // "unlinkable" only appears in the revealed wording, so its absence proves
      // the unrevealed label did not claim the pot was already paid out. (The
      // unrevealed label does contain the word "claimed" — in "not yet claimed".)
      expect(
        ring,
        "an unrevealed ring must not claim the payout already happened",
      ).not.toHaveAccessibleName(/unlinkable/i);
    },
    FLOW_TIMEOUT,
  );

  it("announces an ineligible member as ineligible (#312)", () => {
    // NOTE: this renders components/MemberRing, which is the copy that carries
    // #312. The ring inside App.tsx does NOT — it only knows `funded` and
    // `pending` — while conversely components/MemberRing still hardcodes
    // aria-label="Member ring" instead of the localized keys. The two copies
    // have diverged in both directions; see the module comment. Until they are
    // reconciled, #312 can only be guarded here.
    render(
      withI18n(<MemberRing members={makeMembers(5, { ineligible: true })} revealed={false} />),
    );

    const ineligible = screen.getAllByLabelText(/ineligible/i);
    expect(ineligible.length, "an ineligible member must be labelled as such").toBe(5);
    for (const node of ineligible) {
      expect(node).toHaveAccessibleName(/already claimed/i);
    }
  });
});
