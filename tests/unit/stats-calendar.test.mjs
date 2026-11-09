import { test } from "node:test";
import assert from "node:assert/strict";
import { overview, byMonth, topGenres, serviceValue, verdict } from "../../public/js/stats.js";
import { episodeInfo, groupByDate, dayLabel, buildICS } from "../../public/js/calendar.js";

const series = {seasons: [{n: 1, c: 8}, {n: 2, c: 10}], episode_run_time: [50], last: {s: 2, e: 4}, next: {date: "2026-11-12", s: 2, e: 5}};

test("Überblick zählt Filme, Folgen und Stunden", () => {
  const full = new Map([["movie:1", {runtime: 120, genres: []}], ["tv:2", series]]);
  const o = overview([{key: "movie:1", type: "movie", t: 1}], full, {"tv:2": {s: 2, e: 2}});
  assert.deepEqual(o, {movies: 1, series: 1, episodes: 10, hours: Math.round((120 + 10 * 50) / 60)});
});

test("Monate: zwölf Balken, richtig zugeordnet", () => {
  const now = new Date(2026, 10, 8);
  const m = byMonth([{t: new Date(2026, 10, 1).getTime()}, {t: new Date(2026, 9, 3).getTime()}, {t: new Date(2025, 0, 1).getTime()}], now);
  assert.equal(m.length, 12);
  assert.equal(m[11].label, "Nov"); assert.equal(m[11].count, 1);
  assert.equal(m[10].count, 1);
});

test("Genres mit Anteil „Gefällt mir“", () => {
  const full = new Map([["a", {genres: [{name: "Drama"}]}], ["b", {genres: [{name: "Drama"}, {name: "Komödie"}]}]]);
  const g = topGenres([{key: "a", like: 1}, {key: "b"}], full);
  assert.deepEqual(g[0], {name: "Drama", count: 2, liked: 1});
});

test("Welcher Dienst lohnt sich: Zahl, exklusive Titel, Preis pro Titel, fremde Dienste", () => {
  const P = (id, name) => ({provider_id: id, provider_name: name, logo_path: "/x.png"});
  const regions = new Map([
    ["a", {flatrate: [P(8, "Netflix")]}], ["b", {flatrate: [P(8, "Netflix"), P(337, "Disney Plus")]}],
    ["c", {flatrate: [P(350, "Apple TV+")]}], ["d", {flatrate: [P(350, "Apple TV+")]}], ["e", null]]);
  const sv = serviceValue(["a", "b", "c", "d", "e"].map(k => ({key: k})), regions, [8, 337], {8: 20});
  assert.deepEqual(sv.rows.map(r => [r.id, r.count, r.exclusive]), [[8, 2, 1], [337, 1, 0]]);
  assert.equal(sv.rows[0].perTitle, 10);
  assert.deepEqual(sv.others.map(o => [o.id, o.count]), [[350, 2]]);
  const v = verdict(sv);
  assert.ok(v.includes("Netflix lohnt sich am meisten"));
  assert.ok(v.includes("Apple TV+"));
});

test("Serien: ungesehene Folgen und nächster Termin", () => {
  const i = episodeInfo(series, {s: 1, e: 8});
  assert.equal(i.aired, 12); assert.equal(i.done, 8); assert.equal(i.unseen, 4);
  assert.equal(episodeInfo(series, null).unseen, 0);
});

test("Kalender: Heute, Morgen, Wochentag, Datum", () => {
  assert.equal(dayLabel("2026-11-08", "2026-11-08"), "Heute");
  assert.equal(dayLabel("2026-11-09", "2026-11-08"), "Morgen");
  assert.match(dayLabel("2026-11-11", "2026-11-08"), /^Mittwoch, 11\. November$/);
  assert.match(dayLabel("2026-12-24", "2026-11-08"), /24\. Dezember 2026/);
  const g = groupByDate([{date: "2026-11-10", title: "B"}, {date: "2026-11-09", title: "A"}, {date: "2026-11-01", title: "alt"}], "2026-11-08");
  assert.deepEqual(g.map(x => [x.date, x.items.length]), [["2026-11-09", 1], ["2026-11-10", 1]]);
});

test("Kalenderdatei ist gültiges iCalendar", () => {
  const ics = buildICS([{uid: "tv1s2e5", date: "2026-11-12", title: "Serie, neu; Folge", desc: "Bei Netflix\nhttps://x"}], new Date("2026-11-08T10:00:00Z"));
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20261112\r\n"));
  assert.ok(ics.includes("DTEND;VALUE=DATE:20261113\r\n"));
  assert.ok(ics.includes("SUMMARY:Serie\\, neu\\; Folge"));
  assert.ok(ics.includes("DESCRIPTION:Bei Netflix\\nhttps://x"));
  assert.ok(ics.trimEnd().endsWith("END:VCALENDAR"));
});
