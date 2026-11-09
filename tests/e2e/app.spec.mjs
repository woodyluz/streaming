// Ende-zu-Ende-Tests im Browser gegen den Testserver (tests/e2e/mock-server.mjs)
import { test, expect } from "@playwright/test";

const errors = [];
test.beforeEach(async ({page, request}) => {
  errors.length = 0;
  page.on("pageerror", e => errors.push(e.message));
  await request.get("/__reset");
});
test.afterEach(() => expect(errors, "keine JavaScript-Fehler").toEqual([]));

async function start(page, hash = ""){
  await page.goto("/" + (hash ? "#" + hash : ""));
  if (!hash || hash === "entdecken") await expect(page.locator("#d-status")).toContainText("Filme");
}
async function chooseNetflix(page){
  await page.goto("/#einstellungen");
  await page.locator("[data-pv='8']").click();
  await expect(page.locator("[data-pv='8']")).toHaveAttribute("aria-pressed", "true");
}

test("Entdecken lädt Titel und fragt die Verfügbarkeit gebündelt ab", async ({page}) => {
  const urls = [];
  page.on("request", r => urls.push(new URL(r.url()).pathname));
  await start(page);
  await expect(page.locator("#d-grid .card")).toHaveCount(20);
  await expect(page.locator("#d-grid .chip").first()).not.toHaveClass(/wait/);
  expect(urls.filter(u => u === "/batch/providers").length).toBeGreaterThan(0);
  expect(urls.filter(u => /\/watch\/providers$/.test(u) && u.startsWith("/3/movie")).length).toBe(0);
});

test("Details: Freigabe, Besetzung, Gesehen, Gefällt mir und Bedienung per Tastatur", async ({page}) => {
  await start(page);
  const hit = page.locator("#d-grid .card .hit").first();
  await hit.focus();
  await page.keyboard.press("Enter");
  const sheet = page.locator("#sheet");
  await expect(sheet).toBeVisible();
  await expect(page.locator("#d-title")).toHaveText("Film 1");
  await expect(page.locator(".score.fsk")).toHaveText("FSK 6");
  await expect(page.locator("[data-close]")).toBeFocused();
  for (let i = 0; i < 40; i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.getElementById("sheet").contains(document.activeElement))).toBe(true);
  await expect(page.locator(".wrap")).toHaveAttribute("inert", "");
  await page.locator("[data-act=seen]").click();
  await expect(page.locator("[data-act=seen]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-act=seen]")).toBeFocused();
  await page.locator("[data-act=star][data-v='5']").click();
  await expect(page.locator("[data-act=star][data-v='5']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-act=star][data-v='5']")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(hit).toBeFocused();
});

test("Mehrere Listen über die Auswahl, Fokus bleibt im Fenster", async ({page}) => {
  await start(page);
  await page.locator("#d-grid .card .hit").first().click();
  await page.locator(".actions [data-pick]").click();
  await expect(page.locator("#picker")).toBeVisible();
  await page.locator("#pick-name").fill("Filmabend");
  await page.locator("#pick-new button").click();
  await expect(page.locator("#pick-lists input:checked")).toHaveCount(1);
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.getElementById("picker").contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("#picker")).toBeHidden();
  await expect(page.locator("#sheet")).toBeVisible();
  await expect(page.locator(".actions [data-pick]")).toHaveText("Gemerkt");
  await page.keyboard.press("Escape");
  await page.goto("/#listen");
  await expect(page.locator("#l-chips")).toContainText("Filmabend1");
});

test("Listen sortieren und filtern", async ({page}) => {
  await start(page);
  for (const i of [0, 1, 2, 3]) await page.locator("#d-grid .card .save").nth(i).click();
  await page.goto("/#listen");
  await expect(page.locator("#l-grid .card")).toHaveCount(4);
  await page.selectOption("#l-sort", "rating");
  await expect(page.locator("#l-grid .card").first()).toHaveAttribute("data-id", "4");
  await page.selectOption("#l-sort", "title");
  await expect(page.locator("#l-grid .card").first()).toHaveAttribute("data-id", "1");
  await page.selectOption("#l-genre", "Komödie");
  await expect(page.locator("#l-grid .card")).toHaveCount(2);
  await page.selectOption("#l-genre", "");
  await page.check("#l-mine");
  await expect(page.locator("#l-status")).toContainText("0 Titel in deinen Diensten");
});

test("Profile mit Altersgrenze und getrennten Listen", async ({page}) => {
  await start(page);
  await page.locator("#d-grid .card .save").first().click();
  await page.goto("/#einstellungen");
  await page.fill("#pf-name", "Kinder");
  await page.locator("#pf-new button").click();
  const kid = page.locator("#pf-list .prof").nth(1);
  await kid.locator("select").selectOption("6");
  await expect(page.locator("#profileSel")).toBeVisible();
  await page.selectOption("#profileSel", {label: "Kinder"});
  await page.goto("/#entdecken");
  await expect(page.locator("#d-status")).toContainText("Filme");
  await expect(page.locator("#d-grid .card")).not.toHaveCount(0);
  const ids = await page.locator("#d-grid .card:visible").evaluateAll(cs => cs.map(c => +c.dataset.id));
  expect(ids.length).toBeGreaterThan(5);
  expect(ids.filter(id => id % 3 === 0)).toEqual([]);
  await page.goto("/#listen");
  await expect(page.locator("#l-status")).toContainText("leer");
  await page.selectOption("#profileSel", {label: "Ich"});
  await expect(page.locator("#l-grid .card")).toHaveCount(1);
});

test("Serien-Kalender mit Stand, neuen Folgen und Kalenderdatei", async ({page}) => {
  await start(page);
  await page.locator("#d-seg [data-type=tv]").click();
  await expect(page.locator("#d-status")).toContainText("Serien");
  await page.locator("#d-grid .card .hit").nth(1).click();
  await expect(page.locator("#d-title")).toHaveText("Serie 2");
  for (let i = 0; i < 6; i++) await page.locator("#pg-next").click();
  await expect(page.locator(".progress p")).toContainText("Staffel 1, Folge 6");
  await expect(page.locator("[data-act=follow]")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await page.goto("/#kalender");
  await expect(page.locator("#k-box")).toContainText("Neue Folgen für dich");
  await expect(page.locator("#k-box")).toContainText("4 neue Folgen");
  await expect(page.locator(".daygroup h3").first()).toBeVisible();
  await expect(page.locator(".daygroup")).toContainText("S2 · F5 · Der Plan");
  const dl = page.waitForEvent("download");
  await page.locator("#k-ics").click();
  expect((await dl).suggestedFilename()).toBe("streamfinder-folgen.ics");
});

test("Statistik und „Welcher Dienst lohnt sich?“", async ({page}) => {
  await chooseNetflix(page);
  await start(page, "entdecken");
  for (const i of [1, 3, 4]) await page.locator("#d-grid .card .save").nth(i).click();
  await page.locator("#d-grid .card .hit").nth(1).click();
  await page.locator("[data-act=seen]").click();
  await page.keyboard.press("Escape");
  await page.goto("/#statistik");
  await expect(page.locator(".tile").first()).toContainText("1");
  await expect(page.locator(".svc")).toContainText("Netflix");
  await expect(page.locator(".verdict")).toContainText("Netflix lohnt sich am meisten: 2 Titel");
  await page.fill("[data-price='8']", "20");
  await expect(page.locator("[data-per='8']")).toHaveText("10.00");
});

test("Import einer Titelliste mit nicht gefundenen Zeilen", async ({page}) => {
  await start(page);
  await page.goto("/#listen");
  await page.locator("#l-tools [data-import]").click();
  await expect(page.locator("#imp")).toBeVisible();
  await page.fill("#imp-text", "1. Film 4 (2024)\n- Film 8\nNetflix\n");
  await page.locator("#imp-go").click();
  await expect(page.locator("#imp-status")).toContainText("2 auf die Liste gesetzt");
  await expect(page.locator("#imp-status")).toContainText("1 nicht gefunden: Netflix");
  await page.locator("#imp-close").click();
  await expect(page.locator("#l-grid .card")).toHaveCount(2);
});

test("Sync zwischen zwei Geräten, inklusive Profilen", async ({browser}) => {
  const A = await (await browser.newContext()).newPage(), B = await (await browser.newContext()).newPage();
  for (const p of [A, B]) p.on("pageerror", e => errors.push(e.message));
  const connect = async p => {
    await p.goto("/#einstellungen");
    await p.fill("#y-input", "geheim");
    await p.locator("#y-form button").click();
    await expect(p.locator("#y-status")).toContainText("Synchronisiert");
  };
  await connect(A);
  await A.goto("/#entdecken");
  await A.locator("#d-grid .card .save").first().click();
  await A.goto("/#einstellungen");
  await A.fill("#pf-name", "Partner");
  await A.locator("#pf-new button").click();
  await A.locator("#y-now").click();
  await expect(A.locator("#y-status")).toContainText("Synchronisiert");
  await B.goto("/#entdecken");
  await B.locator("#d-grid .card .save").nth(1).click();
  await connect(B);
  await B.goto("/#listen");
  await expect(B.locator("#l-grid .card")).toHaveCount(2);
  await expect(B.locator("#profileSel")).toBeVisible();
  await A.goto("/#einstellungen");
  await A.locator("#y-now").click();
  await expect(A.locator("#y-status")).toContainText("Synchronisiert");
  await A.goto("/#listen");
  await expect(A.locator("#l-grid .card")).toHaveCount(2);
});

test("Neu & bald, Top 10, Suche, Personen und Empfehlungen", async ({page}) => {
  await chooseNetflix(page);
  await page.goto("/#einstellungen");
  await page.fill("#y-input", "geheim"); await page.locator("#y-form button").click();
  await expect(page.locator("#y-status")).toContainText("Synchronisiert");
  await page.goto("/#neu");
  await expect(page.locator("#n-box h2").first()).toHaveText("Neu in deinen Diensten");
  await expect(page.locator("#nr-expiring .chip").first()).toContainText("Netflix · bis");
  await page.check("#n-de");
  await expect(page.locator("#nr-expiring .card")).toHaveCount(1);
  await page.goto("/#top");
  await expect(page.locator("#t-list .card")).toHaveCount(10);
  await page.selectOption("#t-fsk", "12");
  await expect(page.locator("#t-list .card:visible")).toHaveCount(10);
  await expect(page.locator("#t-list .card:visible .rank").last()).toHaveText("10");
  await page.fill("#q", "anna");
  await expect(page.locator("#s-people .person")).toHaveCount(1);
  await page.locator("#s-people .person").click();
  await expect(page.locator("#p-head h2")).toHaveText("Anna Muster");
  await expect(page.locator("#p-tabs")).toContainText("Vor der Kamera2");
  await page.locator("#p-grid .card .hit").first().click();
  await page.locator("[data-act=seen]").click();
  await page.locator("[data-act=star][data-v='5']").click();
  await expect(page.locator("#sa-box")).toContainText("Ton: Deutsch, Englisch");
  await expect(page.locator("#scores")).toContainText("IMDb 8,1");
  await page.keyboard.press("Escape");
  await page.goto("/#fuerdich");
  await expect(page.locator(".reco").first()).toBeVisible();
  await expect(page.locator(".reco .why").first()).toContainText("Weil du „Film 4“ mochtest");
  await page.locator("#r-go").click();
  await expect(page.locator("#r-out h3")).toBeVisible();
});

test("Am Handy: keine seitliche Scrollleiste in allen Bereichen", async ({page}) => {
  await page.setViewportSize({width: 390, height: 800});
  await start(page);
  for (const h of ["entdecken", "neu", "kalender", "top", "fuerdich", "listen", "statistik", "einstellungen"]){
    await page.goto("/#" + h);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), h).toBe(true);
  }
});
