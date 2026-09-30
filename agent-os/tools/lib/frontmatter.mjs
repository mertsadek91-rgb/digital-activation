// Front matter: a deliberately small YAML subset. Scalars, flow lists ([a, b]),
// flow lists wrapped over several lines (what Prettier produces), and block
// lists ("- item"). In V2 front matter is a *projection* of canonical state, so
// this only has to read what `serialize` writes — plus V1 files, once, on import.

function unquote(v) {
  if (/^".*"$/.test(v)) return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  return null;
}

function splitFlow(inner) {
  const out = [];
  let cur = '';
  let quote = null;
  for (const ch of inner) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export function scalar(raw) {
  const v = String(raw).trim();
  if (v === '' || v === '~' || v === 'null') return null;
  const q = unquote(v);
  if (q !== null) return q;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    return inner === ''
      ? []
      : splitFlow(inner)
          .map((s) => scalar(s))
          .filter((s) => s !== null);
  }
  return v;
}

export function parse(text) {
  text = text.replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text, ok: false };
  const meta = {};
  const blockKeys = new Set();
  let listKey = null;
  let flowKey = null;
  let flow = '';
  const closeFlow = () => {
    meta[flowKey] = scalar(flow.replace(/,\s*\]$/, ']'));
    flowKey = null;
  };
  for (const line of m[1].split('\n')) {
    if (flowKey) {
      flow += ' ' + line.trim();
      if (line.trim().endsWith(']')) closeFlow();
      continue;
    }
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (listKey && /^\s+\[/.test(line)) {
      blockKeys.delete(listKey);
      flowKey = listKey;
      listKey = null;
      flow = line.trim();
      if (flow.endsWith(']')) closeFlow();
      continue;
    }
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      meta[listKey].push(scalar(item[1]));
      blockKeys.delete(listKey);
      continue;
    }
    const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const inline = kv[2].trim();
    if (inline === '') {
      meta[kv[1]] = [];
      blockKeys.add(kv[1]);
      listKey = kv[1];
    } else if (inline.startsWith('[') && !inline.endsWith(']')) {
      flowKey = kv[1];
      flow = inline;
      listKey = null;
    } else {
      meta[kv[1]] = scalar(inline);
      listKey = null;
    }
  }
  for (const k of blockKeys) meta[k] = null;
  return { meta, body: m[2], ok: true };
}

const NEEDS_QUOTES = /^$|^[-?:,[\]{}#&*!|>'"%@`]|: | #|[\[\]{},]|^(true|false|null|~)$|^-?\d+(\.\d+)?$/;
function fmtScalar(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : s;
}

export function serialize(meta, keyOrder = []) {
  const keys = [...keyOrder.filter((k) => k in meta), ...Object.keys(meta).filter((k) => !keyOrder.includes(k))];
  const lines = keys.map((k) => {
    const v = meta[k];
    if (Array.isArray(v)) return `${k}: [${v.map(fmtScalar).join(', ')}]`;
    const s = fmtScalar(v);
    return s === '' ? `${k}:` : `${k}: ${s}`;
  });
  return `---\n${lines.join('\n')}\n---\n`;
}

/** Deep equality for front-matter values (lists, scalars, null). */
export function sameValue(a, b) {
  const norm = (x) => (x === undefined ? null : x);
  a = norm(a);
  b = norm(b);
  if (Array.isArray(a) || Array.isArray(b)) {
    const aa = Array.isArray(a) ? a : a === null ? [] : [a];
    const bb = Array.isArray(b) ? b : b === null ? [] : [b];
    return aa.length === bb.length && aa.every((x, i) => sameValue(x, bb[i]));
  }
  return a === b || String(a) === String(b);
}
