// Ähnliches finden: Titel wählen und Vorschläge berechnen
import { test, expect } from "@playwright/test";

const errors = [];
test.beforeEach(async ({page, request}) => {
  errors.length = 0;
  page.on("pageerror", e => errors.push(e.message));
  await request.get("/__reset");
});
test.afterEach(() => expect(errors, "keine JavaScript-Fehler").toEqual([]));

test("Ähnliches finden: Titel suchen, wählen, Vorschläge erhalten", async ({page}) => {
  await page.goto("/#aehnlich");
  await expect(page.locator("#v-aehnlich")).toBeVisible();
  await expect(page.locator("#a-go")).toBeDisabled();
  await page.fill("#a-q", "film");
  const first = page.locator("#a-sugg [data-add]").first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page.locator("#a-seeds [data-unpick]")).toHaveCount(1);
  await page.click("#a-go");
  await expect(page.locator("#sim-status")).not.toHaveText("Suche Ähnliches …");
  await page.click("#a-seeds [data-unpick]");
  await expect(page.locator("#a-go")).toBeDisabled();
});

test("Ohne Bewertungen zeigt der Top-Modus einen Hinweis", async ({page}) => {
  await page.goto("/#aehnlich");
  await page.click("[data-mode='top']");
  await expect(page.locator("#a-hint")).toContainText("Noch keine Favoriten");
});
