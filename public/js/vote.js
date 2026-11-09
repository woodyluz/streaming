// Filmabend-Abstimmung auswerten. Reine Funktion, getestet in tests/unit/vote.test.mjs.
// items: [{key, …}], parts: [{pid, name, yes:[keys], no:[keys], done}]

export function voteResult(items, parts){
  const ps = parts.filter(p => (p.yes || []).length + (p.no || []).length > 0);
  const n = ps.length;
  const rows = items.map((it, i) => {
    const yes = ps.filter(p => p.yes?.includes(it.key)), no = ps.filter(p => p.no?.includes(it.key));
    return {...it, i, yes: yes.length, no: no.length, open: n - yes.length - no.length, yesNames: yes.map(p => p.name)};
  });
  const matches = n >= 2 ? rows.filter(r => r.yes === n) : [];
  const ranking = rows.filter(r => r.yes > 0).sort((a, b) => (b.yes - a.yes) || (a.no - b.no) || (a.i - b.i));
  const possible = rows.filter(r => r.no === 0 && r.open > 0);
  return {n, match: matches[0] || null, matches, ranking, possible: possible.length, done: n > 0 && parts.every(p => p.done)};
}
