// Browser-Tests für die Funktionen aus Version 6
import { test, expect } from "@playwright/test";

const errors = [];
test.beforeEach(async ({page, request}) => {
  errors.length = 0;
  page.on("pageerror", e => errors.push(e.message));
  await request.get("/__reset");
});
test.afterEach(() => expect(errors, "keine JavaScript-Fehler").toEqual([]));

async function connect(page){
  await page.goto("/#einstellungen");
  await page.fill("#y-input", "geheim");
  await page.locator("#y-form button").click();
  await expect(page.locator("#y-status")).toContainText("Synchronisiert");
}
async function saveSome(page, idx){
  await page.goto("/#entdecken");
  await expect(page.locator("#d-status")).toContainText("Filme");
  for (const i of idx) await page.locator("#d-grid .card .save").nth(i).click();
}

test("Abo-Planer plant Monate, rechnet Kosten und schlägt Kündigen vor", async ({page}) => {
  await page.goto("/#einstellungen");
  await page.locator("[data-pv='8']").click();
  await page.locator("[data-pv='337']").click();
  await saveSome(page, [1, 3, 5, 7, 0]);
  await page.goto("/#planer");
  await expect(page.locator(".month-plan").first()).toContainText("Netflix");
  await expect(page.locator(".month-plan").first()).toContainText("4 Titel");
  await expect(page.locator("#pl-box")).toContainText("Kündigen?");
  await expect(page.locator("#pl-box")).toContainText("Disney Plus");
  await page.locator("[data-price='8']").fill("20");
  await page.locator("[data-price='337']").fill("12");
  await expect(page.locator(".tiles")).toContainText("gespart", {timeout: 5000});
  await page.locator("[data-sub=reise]").click();
  await page.selectOption("#rs-country", "DE");
  await expect(page.locator("#rs-status")).toContainText("in Deutschland");
});

test("Stimmungssuche ohne KI versteht Stichworte", async ({page}) => {
  await page.goto("/#fuerdich");
  await page.fill("#m-text", "Etwas Lustiges unter 2 Stunden, nicht zu brutal");
  await page.locator("#m-form button").click();
  await expect(page.locator(".understood")).toContainText("lustig");
  await expect(page.locator(".understood")).toContainText("unter 120 Minuten");
  await expect(page.locator(".understood")).toContainText("bis FSK 12");
  await expect(page.locator("#m-grid .card").first()).toBeVisible();
});

test("Filmabend: erstellen, zwei Personen stimmen ab, Treffer", async ({browser}) => {
  const host = await (await browser.newContext()).newPage(), guest = await (await browser.newContext()).newPage();
  for (const p of [host, guest]) p.on("pageerror", e => errors.push(e.message));
  await connect(host);
  await saveSome(host, [0, 1, 2]);
  await host.goto("/#listen");
  await host.locator("[data-vote^='l:']").click();
  await host.uncheck("#vmk-mine");
  await host.locator("#vmk-go").click();
  const url = await host.locator("#vmk-url").inputValue();
  expect(url).toMatch(/#abstimmen-\w{10}$/);
  await host.locator("#vmk-open").click();
  await host.fill("#vt-n", "Thomas"); await host.locator("#vt-name button").click();
  for (let i = 0; i < 3; i++) await host.locator(i === 1 ? "#vt-no" : "#vt-yes").click();
  await expect(host.locator("#vt-box")).toContainText("1 Person hat");
  await guest.goto(url.replace(/^https?:\/\/[^/]+/, ""));
  await guest.fill("#vt-n", "Anna"); await guest.locator("#vt-name button").click();
  const first = await guest.locator(".vcard h3").textContent();
  await guest.locator("#vt-yes").click();
  for (let i = 0; i < 2; i++) await guest.locator("#vt-no").click();
  await expect(guest.locator(".match")).toBeVisible();
  await expect(guest.locator(".match h3")).toHaveText(first);
  await expect(host.locator(".match")).toBeVisible({timeout: 8000});
});

test("Liste teilen: Leselink öffnet für Fremde", async ({browser}) => {
  const me = await (await browser.newContext()).newPage(), friend = await (await browser.newContext()).newPage();
  for (const p of [me, friend]) p.on("pageerror", e => errors.push(e.message));
  await me.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await connect(me);
  await saveSome(me, [0, 1]);
  await me.goto("/#listen");
  await me.locator("#l-share").click();
  await expect(me.locator("#l-unshare")).toBeVisible();
  const url = await me.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(/#liste-\w{10}$/);
  await friend.goto(url.replace(/^https?:\/\/[^/]+/, ""));
  await expect(friend.locator("#sl-head h2")).toHaveText("Merkliste");
  await expect(friend.locator("#sl-grid .card")).toHaveCount(2);
  await friend.locator("#sl-grid .card .save").first().click();
  await friend.goto("/#listen");
  await expect(friend.locator("#l-grid .card")).toHaveCount(1);
});

test("Kinderschutz: PIN schützt Profilwechsel und Einstellungen", async ({page}) => {
  await page.goto("/#einstellungen");
  await page.fill("#pf-name", "Kinder"); await page.locator("#pf-new button").click();
  await page.locator("#pf-list .prof").nth(1).locator("select").selectOption("6");
  await page.fill("#pin-new", "1234"); await page.locator("#pin-form button[type=submit]").click();
  await expect(page.locator("#pin-status")).toContainText("PIN gespeichert");
  await page.selectOption("#profileSel", {label: "Kinder"});
  await page.goto("/#einstellungen");
  await expect(page.locator("#pin")).toBeVisible();
  await page.fill("#pin-in", "0000"); await page.locator("#pin-check button[type=submit]").click();
  await expect(page.locator("#pin-err")).toHaveText("Die PIN stimmt nicht.");
  await page.locator("#pin-cancel").click();
  await expect(page.locator("#v-einstellungen")).toBeHidden();
  await page.selectOption("#profileSel", {label: "Ich"});
  await expect(page.locator("#pin")).toBeVisible();
  await page.fill("#pin-in", "1234"); await page.locator("#pin-check button[type=submit]").click();
  await expect(page.locator("#profileSel")).toHaveValue("main");
});

test("Sterne, Notiz, Jahresrückblick, Kino und Sicherung", async ({page}) => {
  await connect(page);
  await page.goto("/#neu");
  await expect(page.locator("#nh-kino")).toHaveText("Jetzt im Kino");
  await page.locator("#nr-kino .card .hit").first().click();
  await expect(page.locator("[data-kino]")).toBeVisible();
  await page.locator("[data-act=seen]").click();
  await page.locator("[data-act=star][data-v='4']").click();
  await page.fill("#d-note", "Mit Anna im Kino");
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
  await page.goto("/#statistik");
  await expect(page.locator(".recap h2")).toContainText("Dein Filmjahr");
  await expect(page.locator(".recap")).toContainText("Film 4");
  await page.goto("/#listen");
  await page.locator("[data-list='__seen']").click();
  await expect(page.locator("#l-grid .card")).toContainText("★★★★");
  // Sicherung, dann Titel löschen und zurückholen
  await page.goto("/#einstellungen");
  await page.locator("#bk-now").click();
  await expect(page.locator("#bk-list [data-bk]").first()).toBeVisible();
  await page.goto("/#listen");
  await page.locator("[data-list='__seen']").click();
  await page.locator("#l-grid .card .hit").first().click();
  await page.locator("[data-act=seen]").click();
  await page.keyboard.press("Escape");
  await page.goto("/#einstellungen");
  await page.locator("#bk-load").click();
  await page.locator("#bk-list [data-bk]").first().click();
  await expect(page.locator("#bk-status")).toContainText("zurückgeholt");
  await page.goto("/#listen");
  await page.locator("[data-list='__seen']").click();
  await expect(page.locator("#l-grid .card")).toHaveCount(1);
});
