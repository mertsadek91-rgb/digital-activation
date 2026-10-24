// Refuses to install on a Node.js older than the security floor (TASK-0132).
//
// Runs as the root `preinstall`, so it guards every `pnpm install`: CI, the
// Coolify builds and a laptop. The build pack picks Node from `.nvmrc`,
// `.node-version` or `engines`, and nothing in the repository can force its
// patch level — so a build that would ship an unpatched runtime fails here,
// loudly, instead of deploying. The floor is the October 2026 Node.js
// security release (Brotli decoder, TLS hostname checks, CA bundle).
//
// Plain Node with no dependencies: it runs before anything is installed.

const FLOOR = { 22: [22, 23, 4], 24: [24, 22, 1], 26: [26, 12, 1] };

const current = process.versions.node.split('.').map(Number);
const floor = FLOOR[current[0]];
// A major newer than any listed shipped after these fixes; odd and older
// majors without an entry are unsupported lines.
const newerMajor = current[0] > Math.max(...Object.keys(FLOOR).map(Number));

const atLeast = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

if (!newerMajor && (!floor || !atLeast(current, floor))) {
  const wanted = Object.values(FLOOR)
    .map((v) => v.join('.'))
    .join(', ');
  console.error(
    `Node ${process.versions.node} is below the security floor. Use one of: ${wanted} or newer in that line (see .node-version).`,
  );
  process.exit(1);
}
