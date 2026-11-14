import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreCandidates, reasonsFor } from "../../public/js/recommend.js";

const rec = (id, va = 7, gids = [18]) => ({id, media_type: "movie", title: "Film " + id, vote_average: va, vote_count: 1000, genre_ids: gids});

test("Mehrfach empfohlene Titel stehen vorne, Gesehenes fällt raus", () => {
  const s1 = {key: "movie:1", title: "A", how: "liked"}, s2 = {key: "movie:2", title: "B", how: "seen"};
  const out = scoreCandidates({seedRecs: [{seed: s1, recs: [rec(10), rec(11)]}, {seed: s2, recs: [rec(11), rec(12)]}], exclude: new Set(["movie:12"])});
  assert.equal(out[0].key, "movie:11");
  assert.ok(!out.some(c => c.key === "movie:12"));
});

test("„Nicht mein Fall“ wertet ähnliche Titel und Genres ab", () => {
  const s = {key: "movie:1", title: "A", how: "liked"};
  const base = {seedRecs: [{seed: s, recs: [rec(20, 7, [27]), rec(21, 7, [35])]}]};
  const plain = scoreCandidates(base);
  const pen = scoreCandidates({...base, disliked: [{key: "movie:9", recs: [rec(20)], genres: [27]}]});
  const score = (list, k) => list.find(c => c.key === k).score;
  assert.ok(score(pen, "movie:20") < score(plain, "movie:20") - 3);
  assert.equal(score(pen, "movie:21"), score(plain, "movie:21"));
  assert.equal(pen[0].key, "movie:21");
});

test("Begründung nennt gemeinsame Regie, Besetzung, Genre und Verfügbarkeit", () => {
  const seed = {key: "movie:1", title: "Arrival", how: "liked"};
  const seedFull = new Map([["movie:1", {genres: [{id: 878, name: "Science-Fiction"}], cast: [{id: 5, name: "Amy Adams"}], crew: [{id: 7, name: "Denis Villeneuve", job: "Director"}], created_by: []}]]);
  const c = {r: rec(30, 8.1), seeds: [seed]};
  const full = {genres: [{id: 878, name: "Science-Fiction"}], cast: [{id: 5, name: "Amy Adams"}], crew: [{id: 7, name: "Denis Villeneuve", job: "Director"}], created_by: []};
  const r = reasonsFor(c, full, seedFull, {status: {kind: "mine", names: ["Netflix"]}});
  assert.equal(r.why, "Weil du „Arrival“ mochtest");
  assert.ok(r.list.some(x => x.includes("Denis Villeneuve")));
  assert.ok(r.list.some(x => x.includes("Amy Adams")));
  assert.ok(r.list.some(x => x.includes("Science-Fiction")));
  assert.ok(r.list.some(x => x.includes("Netflix")));
});

test("Ausgewählte Ausgangstitel: Begründung nennt „ausgewählt“ und zählt wie Favoriten", () => {
  const seed = {key: "movie:1", title: "Inception", how: "picked"};
  const rec = {id: 2, media_type: "movie", title: "Tenet", vote_average: 7.4, vote_count: 500, genre_ids: []};
  const [c] = scoreCandidates({seedRecs: [{seed, recs: [rec]}]});
  const [l] = scoreCandidates({seedRecs: [{seed: {...seed, how: "liked"}, recs: [rec]}]});
  assert.equal(c.score, l.score);
  assert.match(reasonsFor(c, null, new Map()).why, /ausgewählt/);
});
