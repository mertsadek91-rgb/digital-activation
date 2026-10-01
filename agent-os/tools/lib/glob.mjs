// Minimal glob → RegExp. Braces are expanded first ({a,b/**}), then each
// alternative is compiled: `**/` (zero or more directories), `**` (anything),
// `*` (within a segment), `?`, and `[...]` character classes. Paths are
// compared repo-relative with forward slashes.
const cache = new Map();

export function expandBraces(glob) {
  const open = glob.indexOf('{');
  if (open < 0) return [glob];
  let depth = 0;
  let close = -1;
  const parts = [];
  let start = open + 1;
  for (let i = open; i < glob.length; i++) {
    if (glob[i] === '{') depth++;
    else if (glob[i] === '}' && --depth === 0) {
      close = i;
      parts.push(glob.slice(start, i));
      break;
    } else if (glob[i] === ',' && depth === 1) {
      parts.push(glob.slice(start, i));
      start = i + 1;
    }
  }
  if (close < 0) return [glob];
  const head = glob.slice(0, open);
  const tail = glob.slice(close + 1);
  return parts.flatMap((p) => expandBraces(head + p + tail));
}

function compile(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = glob.indexOf(']', i);
      re += end > i ? glob.slice(i, end + 1) : '\\[';
      if (end > i) i = end;
    } else re += c.replace(/[.+^$()|\\]/g, '\\$&');
  }
  return re;
}

export function globRegex(glob, flags = '') {
  const key = flags + '\0' + glob;
  if (!cache.has(key)) cache.set(key, new RegExp('^(?:' + expandBraces(glob).map(compile).join('|') + ')$', flags));
  return cache.get(key);
}

export const toPosix = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');
export const matches = (path, glob) => globRegex(glob).test(toPosix(path));
export const matchesAny = (path, globs) => globs.some((g) => matches(path, g));
// Case-insensitive: the guard runs on Windows/macOS filesystems where
// `.ENV`, `AGENT-OS/state` and `old website` name the same files.
export const matchesCI = (path, glob) => globRegex(glob, 'i').test(toPosix(path));
