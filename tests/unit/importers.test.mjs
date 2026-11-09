import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCSV, detectFormat, toQueries, parseTitleList, pickResult, likeFromRating, toCSV } from "../../public/js/importers.js";

test("CSV mit Anführungszeichen, Kommas und Zeilenumbrüchen", () => {
  const rows = parseCSV('﻿a,b\r\n"x, y","sagt ""hallo"""\n"mehr\nzeilig",2\n');
  assert.deepEqual(rows, [["a", "b"], ["x, y", 'sagt "hallo"'], ["mehr\nzeilig", "2"]]);
});

test("IMDb-Bewertungen erkennen und Serien von Folgen trennen", () => {
  const csv = "Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year\n" +
    "tt0111161,9,2024-01-02,The Shawshank Redemption,,u,Movie,9.3,142,1994\n" +
    "tt0903747,8,2024-02-03,Breaking Bad,,u,TV Series,9.5,49,2008\n" +
    "tt0959621,10,2024-02-04,Pilot,,u,TV Episode,9,58,2008\n";
  const q = toQueries(csv, "ratings.csv");
  assert.equal(q.format, "imdb-ratings");
  assert.deepEqual(q.items.map(i => [i.imdb, i.type, i.rating, i.watched]), [["tt0111161", "movie", 9, true], ["tt0903747", "tv", 8, true]]);
});

test("IMDb-Merkliste", () => {
  const csv = "Position,Const,Created,Modified,Description,Title,URL,Title Type,IMDb Rating,Runtime (mins),Year\n1,tt1375666,2024-01-01,,,Inception,u,Movie,8.8,148,2010\n";
  const q = toQueries(csv, "WATCHLIST.csv");
  assert.equal(q.format, "imdb-list");
  assert.equal(q.items[0].watched, false);
});

test("Letterboxd: Merkliste, Gesehen und Bewertungen anhand von Kopfzeile und Dateiname", () => {
  const h = "Date,Name,Year,Letterboxd URI\n2024-05-01,Past Lives,2023,https://boxd.it/x\n";
  assert.equal(toQueries(h, "watchlist.csv").format, "lb-list");
  assert.equal(toQueries(h, "watched.csv").format, "lb-watched");
  const r = toQueries("Date,Name,Year,Letterboxd URI,Rating\n2024-05-01,Dune,2021,u,4.5\n", "ratings.csv");
  assert.equal(r.format, "lb-ratings");
  assert.equal(r.items[0].rating, 9);
  assert.equal(r.items[0].watched, true);
});

test("Titelliste: Aufzählungszeichen, Jahre, Doppelte und Links", () => {
  const items = parseTitleList("1. Dune (2021)\n- The Bear\n• Past Lives - 2023\nhttps://www.justwatch.com/ch\n\nThe Bear\n");
  assert.deepEqual(items.map(i => [i.title, i.year]), [["Dune", 2021], ["The Bear", null], ["Past Lives", 2023]]);
});

test("Sicherung wird erkannt", () => {
  const q = toQueries(JSON.stringify({app: "streamfinder", v: 2, data: {profiles: []}}));
  assert.equal(q.format, "backup");
});

test("Treffer auswählen: streng bei Titellisten, tolerant bei Dateien", () => {
  const res = [{title: "Dune: Part Two", release_date: "2024-02-28", media_type: "movie"}, {title: "Dune", release_date: "2021-09-15", media_type: "movie"}];
  assert.equal(pickResult({title: "Dune", year: 2021, strict: true}, res).release_date, "2021-09-15");
  assert.equal(pickResult({title: "Netflix", strict: true}, res), null);
  assert.equal(pickResult({title: "Duen", year: 2024, strict: false}, res).title, "Dune: Part Two");
});

test("Bewertung zu „Gefällt mir“", () => {
  assert.equal(likeFromRating(8), 1);
  assert.equal(likeFromRating(5), 0);
  assert.equal(likeFromRating(3), -1);
  assert.equal(likeFromRating(null), 0);
});

test("CSV-Export maskiert Sonderzeichen", () => {
  assert.equal(toCSV([["a,b", 'c"d', "e"]]), '"a,b","c""d",e\r\n');
});
