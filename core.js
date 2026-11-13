export function grammar(source) {
  if (typeof source !== "string" || source.length > 8000)
    throw Error("Grammar must be at most 8,000 characters.");
  const productions = [],
    nonterminals = [];
  for (const line of source
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const match = /^([A-Z][A-Za-z0-9_]{0,15})\s*->\s*(.*)$/.exec(line);
    if (!match)
      throw Error("Use Nonterminal -> spaced symbols | alternatives.");
    const lhs = match[1];
    if (!nonterminals.includes(lhs)) nonterminals.push(lhs);
    for (const alt of match[2].split("|")) {
      const text = alt.trim();
      if (!text) throw Error("Use ~ for an empty production.");
      const rhs = text === "~" ? [] : text.split(/\s+/);
      if (
        rhs.length > 8 ||
        rhs.some(
          (s) =>
            s === "~" ||
            s === "$" ||
            s === "@" ||
            s === "->" ||
            !/^[-A-Za-z0-9_+*()=,;:{}<>!?/\.]{1,16}$/.test(s),
        )
      )
        throw Error(
          "Symbols must be short ASCII tokens; use ~ alone for epsilon and reserve $ for EOF.",
        );
      productions.push({ lhs, rhs });
    }
  }
  if (
    !productions.length ||
    productions.length > 24 ||
    nonterminals.length > 12
  )
    throw Error("Use 1–24 productions and at most 12 nonterminals.");
  if (
    new Set(productions.map((p) => JSON.stringify(p))).size !==
    productions.length
  )
    throw Error("Duplicate productions are not supported.");
  const terminals = [
    ...new Set(
      productions
        .flatMap((p) => p.rhs)
        .filter((s) => !nonterminals.includes(s)),
    ),
  ].sort();
  if (terminals.length > 20) throw Error("Use at most 20 terminals.");
  return {
    start: productions[0].lhs,
    productions: [{ lhs: "@", rhs: [productions[0].lhs] }, ...productions],
    nonterminals,
    terminals,
  };
}
export function build(source) {
  const g = grammar(source),
    nullable = new Set(),
    first = Object.fromEntries(g.nonterminals.map((n) => [n, new Set()])),
    follow = Object.fromEntries(g.nonterminals.map((n) => [n, new Set()]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of g.productions.slice(1)) {
      if (p.rhs.every((s) => nullable.has(s)) && !nullable.has(p.lhs)) {
        nullable.add(p.lhs);
        changed = true;
      }
      for (const s of p.rhs) {
        for (const t of Object.hasOwn(first, s) ? first[s] : [s])
          if (!first[p.lhs].has(t)) {
            first[p.lhs].add(t);
            changed = true;
          }
        if (!nullable.has(s)) break;
      }
    }
  }
  follow[g.start].add("$");
  changed = true;
  while (changed) {
    changed = false;
    for (const p of g.productions.slice(1))
      for (let i = 0; i < p.rhs.length; i++) {
        const s = p.rhs[i];
        if (!Object.hasOwn(follow, s)) continue;
        let all = true;
        for (const t of p.rhs.slice(i + 1)) {
          for (const a of Object.hasOwn(first, t) ? first[t] : [t])
            if (!follow[s].has(a)) {
              follow[s].add(a);
              changed = true;
            }
          if (!nullable.has(t)) {
            all = false;
            break;
          }
        }
        if (all)
          for (const a of follow[p.lhs])
            if (!follow[s].has(a)) {
              follow[s].add(a);
              changed = true;
            }
      }
  }
  function closure(seed) {
    const items = [...seed.map((x) => [...x])],
      seen = new Set(items.map((x) => x.join(":")));
    for (let i = 0; i < items.length; i++) {
      const [p, dot] = items[i],
        symbol = g.productions[p].rhs[dot];
      for (let j = 1; j < g.productions.length; j++)
        if (g.productions[j].lhs === symbol && !seen.has(j + ":0")) {
          seen.add(j + ":0");
          items.push([j, 0]);
        }
    }
    return items.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }
  const states = [closure([[0, 0]])],
    stateIds = new Map([[JSON.stringify(states[0]), 0]]),
    transitions = [];
  for (let i = 0; i < states.length; i++) {
    const symbols = [
      ...new Set(
        states[i]
          .map(([p, d]) => g.productions[p].rhs[d])
          .filter((s) => s !== undefined),
      ),
    ].sort();
    for (const symbol of symbols) {
      const next = closure(
          states[i]
            .filter(([p, d]) => g.productions[p].rhs[d] === symbol)
            .map(([p, d]) => [p, d + 1]),
        ),
        key = JSON.stringify(next);
      if (!stateIds.has(key)) {
        if (states.length >= 80)
          throw Error("Grammar exceeds the 80-state construction limit.");
        stateIds.set(key, states.length);
        states.push(next);
      }
      transitions.push({ from: i, symbol, to: stateIds.get(key) });
    }
  }
  const actions = states.map(() => Object.create(null)),
    gotos = states.map(() => Object.create(null));
  function action(state, token, value) {
    const row = actions[state];
    if (!Object.hasOwn(row, token)) row[token] = [];
    if (!row[token].some((x) => JSON.stringify(x) === JSON.stringify(value)))
      row[token].push(value);
  }
  for (const t of transitions)
    if (g.nonterminals.includes(t.symbol)) gotos[t.from][t.symbol] = t.to;
    else action(t.from, t.symbol, { type: "shift", state: t.to });
  for (let i = 0; i < states.length; i++)
    for (const [p, d] of states[i])
      if (d === g.productions[p].rhs.length) {
        if (p === 0) action(i, "$", { type: "accept" });
        else
          for (const token of follow[g.productions[p].lhs])
            action(i, token, { type: "reduce", production: p });
      }
  const conflicts = [];
  for (let i = 0; i < states.length; i++)
    for (const [token, choices] of Object.entries(actions[i]))
      if (choices.length > 1)
        conflicts.push({
          state: i,
          token,
          choices,
          kind: choices.some((a) => a.type === "shift")
            ? "shift/reduce"
            : "reduce/reduce",
        });
  const reachable = new Set([g.start]);
  changed = true;
  while (changed) {
    changed = false;
    for (const p of g.productions.slice(1))
      if (reachable.has(p.lhs))
        for (const s of p.rhs)
          if (g.nonterminals.includes(s) && !reachable.has(s)) {
            reachable.add(s);
            changed = true;
          }
  }
  return {
    ...g,
    nullable: [...nullable].sort(),
    first: Object.fromEntries(
      Object.entries(first).map(([k, v]) => [k, [...v].sort()]),
    ),
    follow: Object.fromEntries(
      Object.entries(follow).map(([k, v]) => [k, [...v].sort()]),
    ),
    states,
    transitions,
    actions,
    gotos,
    conflicts,
    unreachable: g.nonterminals.filter((n) => !reachable.has(n)),
  };
}
export function parse(table, input) {
  if (typeof input !== "string" || input.length > 4000)
    throw Error("Input must be at most 4,000 characters.");
  const tokens = input.trim() ? input.trim().split(/\s+/) : [];
  if (tokens.length > 100)
    throw Error("Use at most 100 space-separated input tokens.");
  if (tokens.includes("$"))
    throw Error("EOF is appended automatically; do not enter $.");
  if (table.conflicts.length)
    return {
      status: "conflict",
      tokens,
      trace: [],
      tree: null,
      message:
        "The grammar is not SLR(1). Resolve table conflicts before parsing.",
    };
  const stream = [...tokens, "$"],
    states = [0],
    symbols = [],
    trees = [],
    trace = [];
  let position = 0;
  for (let step = 0; step < 500; step++) {
    const state = states.at(-1),
      token = stream[position],
      choices = Object.hasOwn(table.actions[state], token)
        ? table.actions[state][token]
        : [],
      action = choices[0] || { type: "error" },
      entry = {
        step,
        states: [...states],
        symbols: [...symbols],
        position,
        lookahead: token,
        action,
      };
    trace.push(entry);
    if (action.type === "error")
      return {
        status: "rejected",
        tokens,
        trace,
        tree: null,
        message: `Unexpected ${token} at token ${position + 1}. Expected: ${Object.keys(table.actions[state]).sort().join(", ") || "(no valid token)"}.`,
      };
    if (action.type === "accept")
      return {
        status: "accepted",
        tokens,
        trace,
        tree: trees[0],
        message: "Accepted by the SLR table.",
      };
    if (action.type === "shift") {
      symbols.push(token);
      trees.push({ symbol: token, token: position });
      states.push(action.state);
      position++;
    } else {
      const production = table.productions[action.production],
        count = production.rhs.length,
        children = count ? trees.splice(trees.length - count, count) : [];
      if (count) {
        symbols.splice(symbols.length - count, count);
        states.splice(states.length - count, count);
      }
      const next = table.gotos[states.at(-1)][production.lhs];
      if (next === undefined) throw Error("Internal goto invariant failed.");
      symbols.push(production.lhs);
      trees.push({
        symbol: production.lhs,
        production: action.production,
        children,
      });
      states.push(next);
    }
  }
  return {
    status: "limit",
    tokens,
    trace,
    tree: null,
    message: "Parsing stopped at the 500-action limit.",
  };
}
export function analyze(model) {
  if (!model || Object.keys(model).sort().join(",") !== "grammar,input")
    throw Error("A study must contain grammar and input.");
  const table = build(model.grammar);
  return {
    format: "grammar-gallery-evidence-v1",
    model: { ...model },
    table,
    parse: parse(table, model.input),
  };
}
export function example() {
  return {
    grammar: "E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id",
    input: "id + id * id",
  };
}
