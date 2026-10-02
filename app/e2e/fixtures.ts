import { test as base, expect } from "@playwright/test";
import { resolveMode } from "./mode.js";

export const MODE = resolveMode(process.env);

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
// style.css @imports Google Fonts; harmless, so it is blocked without failing the run.
const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

/**
 * Auto-fixture applied to every test.
 *
 * Mock mode: seals the browser off from the internet. Friendbot gets a canned
 * 200; any other non-local request is aborted AND fails the test. That is the
 * second lock (after the `.invalid` RPC host) on "the default run cannot
 * spend funds".
 *
 * Both modes: an uncaught page error fails the test.
 */
export const test = base.extend<{ guards: void }>({
  guards: [
    async ({ page, context }, use) => {
      const escaped: string[] = [];
      const pageErrors: string[] = [];
      page.on("pageerror", (err) => pageErrors.push(err.message));

      if (MODE === "mock") {
        // Playwright tries the most recently registered matching route first,
        // so the catch-all goes in first and the Friendbot stub second.
        await context.route(
          (url) => !LOCAL_HOSTS.has(url.hostname),
          (route) => {
            const { hostname } = new URL(route.request().url());
            if (!FONT_HOSTS.has(hostname)) escaped.push(route.request().url());
            return route.abort();
          },
        );
        await context.route(
          (url) => url.hostname === "friendbot.stellar.org",
          (route) =>
            route.fulfill({
              status: 200,
              contentType: "application/json",
              headers: { "access-control-allow-origin": "*" },
              body: JSON.stringify({ successful: true }),
            }),
        );
      }

      await use();

      expect(pageErrors, "uncaught errors in the page").toEqual([]);
      expect(escaped, "mock mode must make no requests to external hosts").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
