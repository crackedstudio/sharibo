import { test, expect, MODE } from "./fixtures.js";
import type { MockChainSnapshot } from "./mock/client.mock.js";

// Proving runs the real wasm in a real browser, so allow it time. Live mode
// also waits on testnet ledger closes for every transaction.
const STEP = MODE === "live" ? 120_000 : 30_000;
const PROVE_AND_CLAIM = MODE === "live" ? 8 * 60_000 : 3 * 60_000;

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

test("demo flow: create a circle, fund five members, prove, claim", async ({ page }) => {
  await page.goto("/");

  // ── Landing ──────────────────────────────────────────────────────────────
  await expect(page.getByRole("heading", { name: "SHARIBO" })).toBeVisible();

  if (MODE === "mock") {
    // The mock layer registers this hook; if it is missing the aliasing
    // failed and the run must not continue against anything else.
    expect(await page.evaluate(() => Boolean(window.__shariboMockChain))).toBe(true);
  }

  // ── Create ───────────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Launch a 5-member circle on testnet" }).click();
  await expect(page.getByRole("link", { name: /circle #\d+ on-chain/ })).toBeVisible({
    timeout: STEP,
  });

  // ── Fund all five members ────────────────────────────────────────────────
  const fundButtons = page.getByRole("button", { name: "Fund 10 XLM (Demo)" });
  const fundedLinks = page.getByRole("link", { name: /funded/ });
  await expect(fundButtons).toHaveCount(5);

  for (let i = 0; i < 5; i++) {
    // Funded members swap their button for a link, so the first remaining
    // button is always the next unfunded member.
    await fundButtons.first().click();
    await expect(fundedLinks).toHaveCount(i + 1, { timeout: STEP });
  }
  await expect(page.getByText(/pot: 50\.0 \/ 50 XLM/)).toBeVisible();

  // ── Prove + claim ────────────────────────────────────────────────────────
  await expect(page.getByRole("heading", { name: "Claim", exact: true })).toBeVisible();
  // Claim as member 3 rather than the default first member.
  await page.getByRole("radio").nth(2).check();
  await page.getByRole("button", { name: "Generate proof & claim" }).click();

  const result = page.getByTestId("claim-result");
  const appError = page.locator("p.error");
  // Wait for whichever comes first so a failure reports the app's own message
  // instead of a bare timeout on the result card.
  await expect(result.or(appError)).toBeVisible({ timeout: PROVE_AND_CLAIM });
  if (await appError.count()) {
    throw new Error(`the app reported an error during the claim: ${await appError.first().innerText()}`);
  }

  await expect(result.getByRole("heading", { name: "Payout landed" })).toBeVisible();

  // ── Privacy: the recipient shows up in the result card and nowhere else ──
  const accountHref = await result.locator('a[href*="/account/"]').getAttribute("href");
  const recipient = accountHref?.match(/\/account\/(G[A-Z2-7]{55})$/)?.[1];
  expect(recipient, "result card links to the recipient account").toBeTruthy();
  const recipientShort = short(recipient!);

  await expect(result.locator("code").first()).toHaveText(recipientShort);

  // Serialize the whole document minus the result card. Being HTML, this
  // covers text, attributes (href/title/aria-label), SVG and the live region.
  const outsideCard = await page.evaluate(() => {
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[data-testid="claim-result"]').forEach((el) => el.remove());
    return clone.outerHTML;
  });
  expect(outsideCard, "full recipient address outside the result card").not.toContain(recipient!);
  expect(outsideCard, "shortened recipient address outside the result card").not.toContain(
    recipientShort,
  );

  // Not persisted where it could be read back later, either.
  const storage = await page.evaluate(() =>
    JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
  );
  expect(storage).not.toContain(recipient!);

  // ── Mock mode only: check the unlinkability at the chain level ───────────
  if (MODE === "mock") {
    const chain: MockChainSnapshot = await page.evaluate(() =>
      window.__shariboMockChain!.snapshot(),
    );
    expect(chain.circles).toHaveLength(1);
    const [circle] = chain.circles;
    expect(circle.fundedBy).toHaveLength(5);
    expect(circle.claims).toHaveLength(1);
    expect(circle.claims[0].recipient).toBe(recipient);
    // The payout address is fresh: neither a funder nor the admin.
    expect(circle.fundedBy).not.toContain(recipient);
    expect(circle.admin).not.toBe(recipient);
  }
});
