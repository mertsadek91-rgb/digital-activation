/**
 * SSH tunnel to the Coolify backing services.
 *
 *   pnpm tunnel
 *
 * Forwards Postgres, Redis and Meilisearch from the server's loopback interface
 * to the same ports on this machine, so development runs against the real
 * services while none of them has a public port.
 *
 * The useful side effect: .env keeps pointing at localhost either way, so the
 * same file works whether you are tunnelled to Coolify or running `pnpm
 * infra:up` locally. There is no configuration to remember to change at deploy
 * time, which is where that kind of thing gets forgotten.
 *
 * Requires each Coolify resource to bind to the server's loopback rather than
 * publish publicly — in Ports Mappings:
 *
 *   127.0.0.1:5432:5432     postgres
 *   127.0.0.1:6379:6379     redis
 *   127.0.0.1:7700:7700     meilisearch
 *
 * That makes them reachable from the VPS itself and nowhere else. This tunnel
 * then carries them here over SSH.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

import { config as loadEnv } from 'dotenv';

const ROOT = process.cwd();
loadEnv({ path: path.join(ROOT, '.env'), quiet: true });

interface Forward {
  name: string;
  localPort: number;
  remotePort: number;
}

const FORWARDS: Forward[] = [
  { name: 'postgres', localPort: 5432, remotePort: 5432 },
  { name: 'redis', localPort: 6379, remotePort: 6379 },
  { name: 'meilisearch', localPort: 7700, remotePort: 7700 },
];

function main(): void {
  const target = process.env.TUNNEL_SSH_HOST;
  if (!target) {
    console.error('TUNNEL_SSH_HOST is not set in .env.');
    console.error('Set it to the SSH target for the Coolify server, e.g. root@203.0.113.10');
    process.exitCode = 1;
    return;
  }

  const args = ['-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30'];
  for (const forward of FORWARDS) {
    args.push('-L', `${forward.localPort}:127.0.0.1:${forward.remotePort}`);
  }
  args.push(target);

  console.log('');
  console.log(`Tunnelling to ${target}:`);
  for (const forward of FORWARDS) {
    console.log(`  localhost:${forward.localPort}  ->  ${forward.name}`);
  }
  console.log('');
  console.log('Leave this running. Ctrl+C closes it.');
  console.log('');

  const ssh = spawn('ssh', args, { stdio: 'inherit' });

  ssh.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      console.error('`ssh` was not found on PATH. On Windows, install the OpenSSH Client');
      console.error('optional feature, or run this from Git Bash.');
    } else {
      console.error(`Failed to start ssh: ${error.message}`);
    }
    process.exitCode = 1;
  });

  ssh.on('exit', (code) => {
    if (code === 0) return;
    console.error('');
    console.error(`ssh exited with code ${String(code)}.`);
    console.error('ExitOnForwardFailure is on, so a forward that could not bind is the likely');
    console.error('cause: either the local port is already in use — `pnpm infra:down` if the');
    console.error('local Docker stack is up — or the Coolify resource is not bound to');
    console.error('127.0.0.1 on the server.');
    process.exitCode = code ?? 1;
  });

  const stop = (): void => {
    ssh.kill('SIGTERM');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main();
