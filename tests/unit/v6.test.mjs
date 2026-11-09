import { test } from "node:test";
import assert from "node:assert/strict";
import { planSubscriptions } from "../../public/js/plan.js";
import { parseMood, sanitizeMood, moodParams } from "../../public/js/mood.js";
import { voteResult } from "../../public/js/vote.js";
import { yearReview, likeFromStars, starsFromRating } from "../../public/js/stats.js";
import { mergeAll, restoreFrom, emptyProfile } from "../../public/js/merge.js";

const P = (id, name) => ({provider_id: id, provider_name: name, logo_path: "/x.png"});
const NF = P(8, "Netflix"), DP = P(337, "Disney Plus"), SKY = P(29, "Sky"), PLAY = P(691, "Play Suisse");

test("Abo-Planer: pro Monat der Dienst mit dem meisten pro Franken, Auslaufendes zuerst", () => {
  const items = Array.from({length: 12}, (_, i) => ({key: "movie:" + i, title: "F" + i}));
  const regions = new Map(items.map((it, i) => [it.key, i < 6 ? {flatrate: [NF]} : i < 10 ? {flatrate: [SKY]} : i === 10 ? {free: [PLAY]} : null]));
  const now = new Date(2026, 10, 15).getTime();
  const expiry = new Map([["movie:7|29", Math.floor(new Date(2026, 10, 25).getTime() / 1000)]]);
  const r = planSubscriptions({items, regions, mine: [8, 337], prices: {8: 20, 29: 10, 337: 12}, perMonth: 8, months: 3, expiry, now});
  assert.equal(r.free.length, 1);
  assert.equal(r.free[0].services[0], "Play Suisse");
  assert.equal(r.months[0].name, "Sky");                 // 4 Titel, einer läuft aus, halber Preis
  assert.equal(r.months[0].titles[0].key, "movie:7");    // Auslaufender Titel zuerst
  assert.equal(r.months[1].name, "Netflix");
  assert.equal(r.months.length, 2);
  assert.deepEqual(r.cancel.map(c => [c.id, c.count]), [[337, 0]]);
  assert.equal(r.costPlan, 30);
  assert.equal(r.costNow, 64);
  assert.equal(r.notStreaming, 1);                      // Titel 11 läuft nirgends im Abo
});

test("Abo-Planer: abgelaufene Titel zählen im Folgemonat nicht mehr", () => {
  const items = [{key: "a"}, {key: "b"}];
  const regions = new Map([["a", {flatrate: [NF]}], ["b", {flatrate: [SKY]}]]);
  const now = new Date(2026, 10, 2).getTime();
  const expiry = new Map([["b|29", Math.floor(new Date(2026, 10, 20).getTime() / 1000)]]);
  const r = planSubscriptions({items, regions, prices: {8: 10, 29: 10}, perMonth: 1, months: 3, expiry, now});
  assert.deepEqual(r.months.map(m => m.name), ["Sky", "Netflix"]);
});

test("Stimmung: Genres, Verneinung, Dauer, Alter, Sprache", () => {
  const f = parseMood("Etwas Spannendes unter 2 Stunden, nicht zu brutal, kein Horror, koreanisch", new Date(2026, 10, 9));
  assert.deepEqual(f.genres.movie, [53]);
  assert.ok(f.without.movie.includes(27));
  assert.equal(f.runtimeMax, 120);
  assert.equal(f.fskMax, 12);
  assert.equal(f.lang, "ko");
  const p = moodParams(f, "movie");
  assert.equal(p.with_genres, "53");
  assert.equal(p["certification.lte"], 12);
  assert.equal(p["with_runtime.lte"], 120);
});

test("Stimmung: Serie, lustig, neu, 90er, Geheimtipp, Kinder", () => {
  assert.equal(parseMood("lustige Serie").type, "tv");
  assert.deepEqual(parseMood("lustige Serie").genres.tv, [35]);
  assert.equal(parseMood("was Neues", new Date(2026, 1, 1)).yearMin, 2024);
  const n = parseMood("Krimi aus den 90ern");
  assert.equal(n.yearMin, 1990); assert.equal(n.yearMax, 1999);
  assert.equal(parseMood("ein Geheimtipp").voteCountMax, 1500);
  assert.equal(parseMood("Film mit den Kindern").fskMax, 6);
  assert.ok(parseMood("auf Deutsch bitte").notes[0].includes("Tonspur"));
});

test("Antwort der KI wird abgesichert", () => {
  const f = sanitizeMood({type: "tv", genres: {movie: [53, "x", -1], tv: [9648]}, fskMax: 13, lang: "de; drop", runtimeMax: 5000, understood: ["spannend"]});
  assert.equal(f.type, "tv");
  assert.deepEqual(f.genres.movie, [53]);
  assert.equal(f.fskMax, null);
  assert.equal(f.lang, null);
  assert.equal(f.runtimeMax, null);
});

test("Abstimmung: Treffer, Rangliste, fertig", () => {
  const items = [{key: "a"}, {key: "b"}, {key: "c"}];
  const parts = [{pid: "1", name: "Thomas", yes: ["a", "b"], no: ["c"], done: true}, {pid: "2", name: "Anna", yes: ["b"], no: ["a"], done: false}];
  const r = voteResult(items, parts);
  assert.equal(r.n, 2);
  assert.equal(r.match.key, "b");
  assert.deepEqual(r.ranking.map(x => x.key), ["b", "a"]);
  assert.equal(r.done, false);
  assert.equal(voteResult(items, [parts[0]]).match, null);   // allein kein Treffer
});

test("Jahresrückblick und Sterne", () => {
  const full = new Map([["movie:1", {runtime: 100, genres: [{name: "Drama"}]}], ["movie:2", {runtime: 80, genres: [{name: "Drama"}]}]]);
  const w = [{key: "movie:1", type: "movie", t: new Date(2026, 2, 3).getTime(), stars: 5}, {key: "movie:2", type: "movie", t: new Date(2026, 2, 9).getTime(), stars: 3},
    {key: "movie:3", type: "movie", t: new Date(2025, 2, 9).getTime()}];
  const y = yearReview(w, full, 2026);
  assert.equal(y.count, 2); assert.equal(y.hours, 3); assert.equal(y.topMonth, "Mär"); assert.equal(y.best.key, "movie:1"); assert.equal(y.avgStars, 4);
  assert.equal(yearReview(w, full, 2020), null);
  assert.deepEqual([likeFromStars(5), likeFromStars(3), likeFromStars(1), likeFromStars(0)], [1, 0, -1, 0]);
  assert.deepEqual([starsFromRating(9), starsFromRating(4), starsFromRating(1), starsFromRating(null)], [5, 2, 1, 0]);
});

test("Haushalt-PIN und Stadt werden wie Einstellungen synchronisiert, Preiswächter wie Listen", () => {
  const L = {profiles: [], pdata: {main: emptyProfile({pwatch: {"movie:1": {t: 5}}})}, household: {hash: "alt"}, city: "Bern", setT: 1};
  const R = {profiles: [], pdata: {main: emptyProfile({pwatch: {"movie:2": {t: 6}}})}, household: {hash: "neu"}, city: "Zürich", setT: 2};
  const m = mergeAll(L, R, 1000);
  assert.equal(m.household.hash, "neu"); assert.equal(m.city, "Zürich");
  assert.deepEqual(Object.keys(m.pdata.main.pwatch).sort(), ["movie:1", "movie:2"]);
});

test("Sicherung zurückholen überstimmt spätere Löschungen", () => {
  const NOW = 1_800_000_000_000;
  const local = {profiles: [{id: "main"}], pdata: {main: emptyProfile({lists: [{id: "main", items: []}], tomb: {items: {"main|movie:1": NOW - 10}, lists: {x: NOW - 10}}})}};
  const backup = {profiles: [{id: "main"}], pdata: {main: emptyProfile({lists: [{id: "main", items: [{key: "movie:1", added: NOW - 100}]}, {id: "x", name: "Weg", items: []}]})}};
  assert.equal(mergeAll(local, backup, NOW).pdata.main.lists[0].items.length, 0);
  const r = restoreFrom(local, backup, NOW);
  assert.equal(r.pdata.main.lists.find(l => l.id === "main").items.length, 1);
  assert.ok(r.pdata.main.lists.some(l => l.id === "x"));
});
