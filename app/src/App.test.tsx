/**
 * App.test.tsx — landing screen smoke tests
 *
 * @sharibo/client is mocked via __mocks__/@sharibo/client.ts so the heavy
 * Poseidon/snarkjs/Stellar crypto never loads. Tests exercise the React
 * component layer only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";
import { I18nProvider } from "./i18n";

// Activate the manual mock at <root>/__mocks__/@sharibo/client.ts.
vi.mock("@sharibo/client");

// Also mock @stellar/stellar-sdk's Keypair so `Keypair.random()` and
// `friendbotFund` (which calls `fetch`) don't hit the network.
vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    Keypair: {
      random: vi.fn(() => ({
        publicKey: () => "GMOCKPUBLICKEY000000000000000000000000000000000000000000",
        secret: () => "SMOCKSECRETKEY000000000000000000000000000000000000000000",
      })),
    },
  };
});

// Stub fetch so the "friendbot" call in startCircle never fires.
global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

// The app reads a `sharibo.locale` preference from localStorage; give each
// test a clean slate.
function renderApp() {
  return render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
}

describe("App — landing screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("renders the SHARIBO heading", () => {
    renderApp();
    expect(screen.getByRole("heading", { name: /sharibo/i })).toBeInTheDocument();
  });

  it("renders the launch button", () => {
    renderApp();
    const btn = screen.getByRole("button", { name: /launch a 5-member circle on testnet/i });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it("renders the tagline copy", () => {
    renderApp();
    expect(
      screen.getByText(/private rotating savings circle/i),
    ).toBeInTheDocument();
  });

  it("renders the testnet-only disclaimer fineprint", () => {
    renderApp();
    expect(screen.getByText(/testnet only/i)).toBeInTheDocument();
  });
});