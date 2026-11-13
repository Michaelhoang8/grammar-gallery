import test from "node:test";
import assert from "node:assert/strict";
import { build, parse, analyze, example } from "../core.js";
function leaves(tree) {
  return tree.children ? tree.children.flatMap(leaves) : [tree.symbol];
}
test("prototype-named terminals remain ordinary table keys", () => {
  const t = build("S -> __proto__ constructor");
  assert.equal(parse(t, "__proto__ constructor").status, "accepted");
  assert.equal(Object.hasOwn(t.actions[0], "__proto__"), true);
});
test("expression grammar builds 12 states and respects precedence through reductions", () => {
  const r = analyze(example());
  assert.equal(r.table.states.length, 12);
  assert.deepEqual(r.table.conflicts, []);
  assert.equal(r.parse.status, "accepted");
  assert.deepEqual(leaves(r.parse.tree), ["id", "+", "id", "*", "id"]);
  assert.equal(r.parse.tree.children[2].production, 3);
  assert.deepEqual(r.table.first.E, ["(", "id"]);
  assert.deepEqual(r.table.follow.F, ["$", ")", "*", "+"]);
});
test("nullable chains propagate FIRST/FOLLOW and parse empty input", () => {
  const t = build("S -> A B\nA -> a A | ~\nB -> b B | ~");
  assert.deepEqual(t.nullable, ["A", "B", "S"]);
  assert.deepEqual(t.first.S, ["a", "b"]);
  assert.deepEqual(t.follow.A, ["$", "b"]);
  for (const input of ["", "a", "b", "a a b b"])
    assert.equal(parse(t, input).status, "accepted");
  assert.equal(parse(t, "b a").status, "rejected");
});
test("conflicts are reported without arbitrary resolution or ambiguity claims", () => {
  const sr = build("E -> E + E | id");
  assert.ok(sr.conflicts.some((c) => c.kind === "shift/reduce"));
  assert.equal(parse(sr, "id").status, "conflict");
  const rr = build("S -> A | B\nA -> a\nB -> a");
  assert.ok(rr.conflicts.some((c) => c.kind === "reduce/reduce"));
  const nonSlr = build("S -> L = R | R\nL -> * R | id\nR -> L");
  assert.ok(nonSlr.conflicts.length);
});
test("all short token strings agree with independent bounded derivation enumeration", () => {
  for (const source of [
    "S -> a S b | ~",
    "S -> A B\nA -> a A | ~\nB -> b B | ~",
    "S -> a S | b",
    "S -> ( S ) S | ~",
  ]) {
    const t = build(source);
    assert.equal(t.conflicts.length, 0);
    const language = new Set(),
      queue = [[t.start]],
      seen = new Set();
    while (queue.length) {
      const form = queue.shift(),
        key = form.join(" ");
      if (seen.has(key)) continue;
      seen.add(key);
      if (
        form.filter((x) => !t.nonterminals.includes(x)).length > 6 ||
        form.length > 14
      )
        continue;
      const at = form.findIndex((x) => t.nonterminals.includes(x));
      if (at < 0) {
        language.add(key);
        continue;
      }
      for (const p of t.productions.slice(1))
        if (p.lhs === form[at])
          queue.push([...form.slice(0, at), ...p.rhs, ...form.slice(at + 1)]);
    }
    const alphabet = t.terminals;
    for (let length = 0; length <= 6; length++)
      for (let code = 0; code < alphabet.length ** length; code++) {
        let k = code;
        const tokens = Array.from({ length }, () => {
          const token = alphabet[k % alphabet.length];
          k = Math.floor(k / alphabet.length);
          return token;
        });
        const result = parse(t, tokens.join(" "));
        assert.equal(
          result.status === "accepted",
          language.has(tokens.join(" ")),
          source + " / " + tokens,
        );
        if (result.status === "accepted")
          assert.deepEqual(leaves(result.tree), tokens);
      }
  }
});
test("item transitions are complete closures with valid table destinations", () => {
  const t = build(example().grammar);
  for (const tr of t.transitions) {
    const advanced = t.states[tr.from]
      .filter(([p, d]) => t.productions[p].rhs[d] === tr.symbol)
      .map(([p, d]) => [p, d + 1]);
    for (const item of advanced)
      assert.ok(
        t.states[tr.to].some((x) => x[0] === item[0] && x[1] === item[1]),
      );
  }
  for (const state of t.states)
    for (const [p, d] of state) {
      const symbol = t.productions[p].rhs[d];
      t.productions.forEach((production, i) => {
        if (production.lhs === symbol)
          assert.ok(state.some((x) => x[0] === i && x[1] === 0));
      });
    }
});
test("bounds, undefined terminals, unreachable rules and reserved EOF", () => {
  assert.throws(() => build("S ->"));
  assert.throws(() => build("S -> a | a"));
  assert.throws(() => build("S -> $"));
  assert.throws(() => parse(build("S -> a"), "$"));
  assert.throws(() => parse(build("S -> a"), "a ".repeat(101)));
  const t = build("S -> a\nUnused -> z");
  assert.deepEqual(t.unreachable, ["Unused"]);
  assert.equal(parse(t, "unknown").status, "rejected");
  assert.equal(parse(build("S -> Missing"), "Missing").status, "accepted");
});
