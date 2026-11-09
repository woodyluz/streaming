import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeAll, mergeProfile, upgrade, emptyProfile } from "../../public/js/merge.js";

const item = (id, added) => ({key: "movie:" + id, type: "movie", id, title: "Film " + id, added});
const NOW = 1_800_000_000_000;

test("Einträge beider Geräte bleiben erhalten", () => {
  const A = {lists: [{id: "main", name: "Merkliste", items: [item(1, NOW - 100)]}]};
  const B = {lists: [{id: "main", name: "Merkliste", items: [item(2, NOW - 50)]}]};
  const m = mergeProfile(A, B, NOW);
  assert.deepEqual(m.lists[0].items.map(i => i.id), [2, 1]);
});

test("Entfernen gilt nur für ältere Einträge", () => {
  const A = {lists: [{id: "main", items: [item(1, NOW - 100)]}], tomb: {items: {"main|movie:1": NOW - 10}}};
  const B = {lists: [{id: "main", items: [item(1, NOW - 100)]}]};
  assert.equal(mergeProfile(A, B, NOW).lists[0].items.length, 0);
  const C = {lists: [{id: "main", items: [item(1, NOW - 5)]}]};   // danach wieder hinzugefügt
  assert.equal(mergeProfile(A, C, NOW).lists[0].items.length, 1);
});

test("Gelöschte Listen bleiben gelöscht, neue Listen kommen dazu", () => {
  const A = {lists: [{id: "main", items: []}, {id: "x", name: "Alt", items: [item(3, NOW - 100)]}]};
  const B = {lists: [{id: "main", items: []}, {id: "y", name: "Neu", items: []}], tomb: {lists: {x: NOW - 1}}};
  assert.deepEqual(mergeProfile(A, B, NOW).lists.map(l => l.id), ["main", "y"]);
});

test("Umbenennen: der neuere Name gewinnt", () => {
  const A = {lists: [{id: "main", name: "Alt", nt: 1, items: []}]};
  const B = {lists: [{id: "main", name: "Neu", nt: 2, items: []}]};
  assert.equal(mergeProfile(A, B, NOW).lists[0].name, "Neu");
});

test("Gesehen und Bewertung: neuerer Stand gewinnt, Löschung zählt", () => {
  const A = {watched: {"movie:1": {t: 10, like: 1}, "movie:2": {t: 10}}};
  const B = {watched: {"movie:1": {t: 20, like: -1}}, tomb: {watched: {"movie:2": 15}}};
  const w = mergeProfile(A, B, 1000).watched;
  assert.equal(w["movie:1"].like, -1);
  assert.equal(w["movie:2"], undefined);
});

test("Einstellungen: das zuletzt geänderte Gerät gewinnt", () => {
  const L = {profiles: [], pdata: {}, mine: [8], country: "CH", setT: 5};
  const R = {profiles: [], pdata: {}, mine: [8, 337], country: "DE", setT: 9};
  const m = mergeAll(L, R, NOW);
  assert.deepEqual(m.mine, [8, 337]);
  assert.equal(m.country, "DE");
});

test("Profile werden zusammengeführt, gelöschte bleiben weg, Hauptprofil immer da", () => {
  const L = {profiles: [{id: "main", name: "Ich"}, {id: "k", name: "Kinder", maxFsk: 6}], pdata: {k: emptyProfile()}};
  const R = {profiles: [{id: "main", name: "Ich"}, {id: "p", name: "Partner"}], pdata: {}, ptomb: {k: NOW - 1}};
  const m = mergeAll(L, R, NOW);
  assert.deepEqual(m.profiles.map(p => p.id), ["main", "p"]);
  assert.ok(m.pdata.main && m.pdata.p);
});

test("Alter Server-Stand ohne Profile wird übernommen", () => {
  const old = {lists: [{id: "main", name: "Merkliste", items: [item(7, 1)]}], watched: {}, mine: [8], setT: 3};
  const u = upgrade(old);
  assert.equal(u.profiles[0].id, "main");
  const m = mergeAll({profiles: [{id: "main", name: "Ich"}], pdata: {main: emptyProfile()}}, old, NOW);
  assert.equal(m.pdata.main.lists[0].items[0].id, 7);
});
