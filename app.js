import { example } from "./core.js";
const $ = (id) => document.getElementById(id),
  worker = new Worker("/worker.js", { type: "module" });
let result,
  sequence = 0,
  step = 0,
  state = 0,
  ready = false,
  timer = null;
function el(tag, text) {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}
function message(text, error = false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", error);
}
function stop() {
  clearInterval(timer);
  timer = null;
  $("play").textContent = "Play";
}
function run(model) {
  stop();
  ready = false;
  $("evidence").disabled = $("dot").disabled = true;
  worker.postMessage({ id: ++sequence, model });
  message("Constructing item sets and resolving FOLLOW-gated reductions…");
}
function set(model) {
  $("grammar").value = model.grammar;
  $("input").value = model.input;
  run(model);
}
function action(a) {
  return a.type === "shift"
    ? "s" + a.state
    : a.type === "reduce"
      ? "r" + a.production
      : a.type === "accept"
        ? "acc"
        : "error";
}
function production(p) {
  return p.lhs + " → " + (p.rhs.join(" ") || "ε");
}
function inspect() {
  if (!ready) return;
  const t = result.table;
  $("state").value = state;
  $("items").textContent = t.states[state]
    .map(([p, d]) => {
      const rule = t.productions[p],
        rhs = [...rule.rhs];
      rhs.splice(d, 0, "•");
      return `${p}. ${rule.lhs} → ${rhs.join(" ")}`;
    })
    .join("\n");
  const paths = new Map([[0, []]]),
    queue = [0];
  for (const from of queue)
    for (const edge of t.transitions.filter((e) => e.from === from))
      if (!paths.has(edge.to)) {
        paths.set(edge.to, [...paths.get(from), edge.symbol]);
        queue.push(edge.to);
      }
  $("prefix").textContent =
    "Shortest automaton path from I0: " +
    (paths.get(state).join(" ") || "ε") +
    " (viable-prefix symbols, not necessarily input tokens).";
  $("transitions").replaceChildren(
    ...t.transitions
      .filter((e) => e.from === state)
      .map((e) => {
        const b = el("button", `${e.symbol} → I${e.to}`);
        b.onclick = () => {
          state = e.to;
          inspect();
        };
        return b;
      }),
  );
}
function trace() {
  if (!ready) return;
  const p = result.parse,
    f = p.trace[step];
  $("step").max = Math.max(0, p.trace.length - 1);
  $("step").value = step;
  $("step").disabled = !p.trace.length;
  $("back").disabled = !f || step === 0;
  $("next").disabled = !f || step === p.trace.length - 1;
  $("play").disabled = !p.trace.length;
  $("position").textContent = f ? `${step + 1} / ${p.trace.length}` : "—";
  const states = f ? f.states : [];
  const previous = Array.from($("stack").children);
  $("stack").replaceChildren(
    ...states.map((v, i) => {
      if (previous[i]?.textContent === String(v)) return previous[i];
      const chip = el("span", String(v));
      chip.className = "new-state";
      return chip;
    }),
  );
  $("symbols").replaceChildren(
    ...(f
      ? f.symbols.length
        ? f.symbols
        : ["ε"]
      : ["No deterministic parse"]
    ).map((v) => el("span", v)),
  );
  $("remaining").replaceChildren(
    ...(f
      ? [...p.tokens.slice(f.position), "$"]
      : ["Resolve grammar conflicts first."]
    ).map((v) => el("span", v)),
  );
  $("action").dataset.kind = f?.action.type || "conflict";
  $("action").textContent = f
    ? f.action.type === "reduce"
      ? `Reduce r${f.action.production}: ${production(result.table.productions[f.action.production])}`
      : f.action.type === "shift"
        ? `Shift ${f.lookahead}; enter I${f.action.state}.`
        : f.action.type === "accept"
          ? "Accept the completed start symbol."
          : "Reject: this table cell has no action."
    : "No conflict-resolution policy is applied.";
  if (f) {
    state = f.states.at(-1);
    inspect();
  }
}
function drawTree(root) {
  const container = $("tree-diagram");
  container.replaceChildren();
  if (!root) {
    container.append(el("p", "No accepted parse tree."));
    return;
  }
  const nodes = [],
    edges = [];
  let leaf = 0,
    depthMax = 0;
  function visit(n, depth) {
    const item = {
      label: n.symbol + (n.children?.length === 0 ? " → ε" : ""),
      depth,
      terminal: n.token !== undefined,
    };
    nodes.push(item);
    depthMax = Math.max(depthMax, depth);
    const children = (n.children || []).map((child) => visit(child, depth + 1));
    item.x = children.length
      ? children.reduce((sum, child) => sum + child.x, 0) / children.length
      : leaf++;
    children.forEach((child) => edges.push([item, child]));
    return item;
  }
  visit(root, 0);
  const unit = Math.max(95, ...nodes.map((n) => n.label.length * 8 + 28));
  const width = Math.max(600, leaf * unit),
    height = (depthMax + 1) * 72 + 35;
  const X = (n) => n.x * unit + unit / 2 + (width - leaf * unit) / 2,
    Y = (n) => n.depth * 72 + 35;
  function shape(tag, attrs, text) {
    const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  const graph = shape("svg", {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    role: "img",
    "aria-label": "Accepted syntax tree",
  });
  graph.append(
    shape("title", {}, `Accepted parse tree with ${nodes.length} nodes`),
  );
  for (const [a, b] of edges)
    graph.append(
      shape("path", {
        d: `M ${X(a)} ${Y(a) + 13} C ${X(a)} ${Y(a) + 38}, ${X(b)} ${Y(b) - 38}, ${X(b)} ${Y(b) - 13}`,
        class: "tree-edge",
      }),
    );
  for (const n of nodes) {
    graph.append(
      shape("rect", {
        x: X(n) - (unit - 18) / 2,
        y: Y(n) - 14,
        width: unit - 18,
        height: 28,
        rx: 4,
        class: n.terminal ? "tree-terminal" : "tree-rule",
      }),
    );
    graph.append(
      shape("text", { x: X(n), y: Y(n) + 4, "text-anchor": "middle" }, n.label),
    );
  }
  container.append(graph);
}
function render() {
  const t = result.table,
    p = result.parse;
  state = 0;
  step = 0;
  $("status").textContent = p.status;
  $("parse-message").textContent = p.message;
  $("metrics").replaceChildren(
    ...[
      ["LR(0) states", t.states.length],
      ["Productions", t.productions.length - 1],
      ["Conflict cells", t.conflicts.length],
    ].map(([label, value]) => {
      const e = el("p", label);
      e.prepend(el("b", String(value)));
      return e;
    }),
  );
  $("state").replaceChildren(
    ...t.states.map((_, i) => {
      const o = el("option", "I" + i);
      o.value = i;
      return o;
    }),
  );
  $("sets").replaceChildren(
    ...t.nonterminals.map((n) => {
      const tr = el("tr", "");
      for (const value of [
        n,
        t.nullable.includes(n) ? "yes" : "no",
        t.first[n].join(", ") || "∅",
        t.follow[n].join(", ") || "∅",
      ])
        tr.append(el("td", value));
      return tr;
    }),
  );
  $("warnings").textContent = t.unreachable.length
    ? "Unreachable nonterminals: " + t.unreachable.join(", ")
    : "Every nonterminal is reachable from the start symbol.";
  $("conflicts").replaceChildren(
    ...t.conflicts.map((c) => {
      const div = el(
        "div",
        `I${c.state}, lookahead ${c.token}: ${c.kind} (${c.choices.map(action).join(" / ")})`,
      );
      div.className = "conflict-card";
      const b = el("button", "Inspect conflict state");
      b.onclick = () => {
        state = c.state;
        inspect();
      };
      div.append(el("br", ""), b);
      return div;
    }),
  );
  const table = el("table", ""),
    header = el("tr", "");
  for (const name of ["State", ...t.terminals, "$", ...t.nonterminals])
    header.append(el("th", name));
  table.append(header);
  t.states.forEach((_, i) => {
    const tr = el("tr", ""),
      td = el("td", ""),
      b = el("button", "I" + i);
    b.onclick = () => {
      state = i;
      inspect();
    };
    td.append(b);
    tr.append(td);
    for (const token of [...t.terminals, "$"]) {
      const choices = Object.hasOwn(t.actions[i], token)
          ? t.actions[i][token]
          : [],
        cell = el("td", choices.map(action).join(" / ") || "—");
      if (choices.length > 1) cell.className = "conflict";
      tr.append(cell);
    }
    for (const n of t.nonterminals)
      tr.append(
        el("td", t.gotos[i][n] === undefined ? "—" : String(t.gotos[i][n])),
      );
    table.append(tr);
  });
  $("table").replaceChildren(table);
  $("productions").textContent = t.productions
    .map((p, i) => `${i}. ${production(p)}`)
    .join("\n");
  const lines = [];
  function tree(node, depth = 0) {
    lines.push(
      "  ".repeat(depth) +
        node.symbol +
        (node.children?.length === 0 ? " → ε" : ""),
    );
    node.children?.forEach((c) => tree(c, depth + 1));
  }
  if (p.tree) tree(p.tree);
  $("tree").textContent = lines.join("\n") || "No accepted parse tree.";
  drawTree(p.tree);
  trace();
  inspect();
}
worker.onmessage = ({ data }) => {
  if (data.id !== sequence) return;
  if (data.error) {
    message(data.error, true);
    return;
  }
  result = data.result;
  ready = true;
  $("evidence").disabled = $("dot").disabled = false;
  render();
  message(
    result.table.conflicts.length
      ? "Construction complete; unresolved conflicts block deterministic parsing."
      : "Construction complete. Inspect states and replay parser actions.",
  );
};
worker.onerror = () =>
  message("Parser worker failed. Reload to restart.", true);
$("build").onclick = () =>
  run({ grammar: $("grammar").value, input: $("input").value });
for (const id of ["grammar", "input"])
  $(id).oninput = () => {
    stop();
    sequence++;
    ready = false;
    $("evidence").disabled = $("dot").disabled = true;
    message("Draft changed. Build table & parse to update results.");
  };
$("example").onclick = () => set(example());
$("nullable").onclick = () =>
  set({ grammar: "S -> A B\nA -> a A | ~\nB -> b B | ~", input: "a a b b" });
$("ambiguous").onclick = () =>
  set({ grammar: "E -> E + E | id", input: "id + id + id" });
$("state").onchange = () => {
  state = Number($("state").value);
  inspect();
};
$("step").oninput = () => {
  if (!ready) return;
  stop();
  step = Number($("step").value);
  trace();
};
$("back").onclick = () => {
  if (!ready) return;
  stop();
  step = Math.max(0, step - 1);
  trace();
};
$("next").onclick = () => {
  if (!ready) return;
  stop();
  step = Math.min(result.parse.trace.length - 1, step + 1);
  trace();
};
$("play").onclick = () => {
  if (timer) {
    stop();
    return;
  }
  if (!ready || !result.parse.trace.length) return;
  if (step === result.parse.trace.length - 1) step = 0;
  $("play").textContent = "Pause";
  trace();
  timer = setInterval(() => {
    step++;
    trace();
    if (step >= result.parse.trace.length - 1) stop();
  }, 650);
};
function download(name, data, type = "application/json") {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("save").onclick = () =>
  download(
    "grammar-gallery-study.json",
    JSON.stringify(
      { grammar: $("grammar").value, input: $("input").value },
      null,
      2,
    ) + "\n",
  );
$("evidence").onclick = () => {
  if (ready)
    download(
      "grammar-gallery-evidence.json",
      JSON.stringify({ ...result, inspection: { state, step } }, null, 2) +
        "\n",
    );
};
$("dot").onclick = () => {
  if (ready) {
    const t = result.table;
    download(
      "grammar-gallery-automaton.dot",
      "digraph LR0 {\n  rankdir=LR;\n" +
        t.states
          .map(
            (items, i) =>
              `  I${i} [label=${JSON.stringify(
                "I" +
                  i +
                  "\n" +
                  items
                    .map(([p, d]) => {
                      const r = t.productions[p],
                        rhs = [...r.rhs];
                      rhs.splice(d, 0, "•");
                      return r.lhs + " -> " + rhs.join(" ");
                    })
                    .join("\n"),
              )}];`,
          )
          .join("\n") +
        "\n" +
        t.transitions
          .map(
            (e) =>
              `  I${e.from} -> I${e.to} [label=${JSON.stringify(e.symbol)}];`,
          )
          .join("\n") +
        "\n}\n",
      "text/vnd.graphviz",
    );
  }
};
$("open").onclick = () => $("file").click();
$("file").onchange = async () => {
  const file = $("file").files[0];
  $("file").value = "";
  if (!file) return;
  try {
    if (file.size > 50000) throw Error("Study must be at most 50 KB.");
    const m = JSON.parse(await file.text());
    if (
      !m ||
      Object.keys(m).sort().join(",") !== "grammar,input" ||
      typeof m.grammar !== "string" ||
      typeof m.input !== "string"
    )
      throw Error("Study needs grammar and input strings.");
    set(m);
  } catch (error) {
    message(error.message, true);
  }
};
set(example());
