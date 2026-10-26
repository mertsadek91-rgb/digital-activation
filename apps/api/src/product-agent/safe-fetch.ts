import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

/**
 * GET over https from a host a model named, without letting that host be us.
 *
 * The product agent fetches a brand's website to find its logo, and the
 * domain comes from a model's answer — so the URL is untrusted. A plain
 * `fetch` would follow it to `localhost`, to the cloud metadata address, or
 * to a name that resolves to the database's private IP. Here:
 *
 *  - https only, port 443, no credentials in the URL, a host name not a literal IP;
 *  - the address is checked in the socket's own DNS lookup, so the address
 *    checked is the address connected to (no gap for DNS rebinding);
 *  - every redirect is a new request through the same checks, at most three;
 *  - the body is capped, and the whole request has one deadline.
 */

export class FetchRefusedError extends Error {}

const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  // Unspecified, loopback and the deprecated IPv4-compatible ::a.b.c.d.
  ['::', 96],
  // NAT64 forms of any IPv4 address. (IPv4-mapped ::ffff:0:0/96 is handled
  // in isPublicAddress: as a BlockList rule it also matches every plain IPv4.)
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  // 6to4 and Teredo carry an IPv4 address inside; site-local is private.
  ['2002::', 16],
  ['2001::', 32],
  ['fec0::', 10],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv6');
}

/** Whether an address is on the public internet. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !BLOCKED.check(address, 'ipv4');
  if (family === 6) {
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)?.[1];
    if (mapped) return isPublicAddress(mapped);
    // The hex spelling of a mapped address (::ffff:7f00:1): refused outright.
    if (/^(0{0,4}:){0,5}:?ffff:/i.test(address)) return false;
    return !BLOCKED.check(address, 'ipv6');
  }
  return false;
}

/** The URL, if it is one this module may fetch; otherwise why not. */
export function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchRefusedError('not a URL');
  }
  if (url.protocol !== 'https:') throw new FetchRefusedError('https only');
  if (url.username || url.password) throw new FetchRefusedError('credentials in URL');
  if (url.port && url.port !== '443') throw new FetchRefusedError('port not allowed');
  // A trailing dot names the same host ("localhost." is localhost).
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (isIP(host)) throw new FetchRefusedError('IP literal not allowed');
  if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new FetchRefusedError('host not allowed');
  }
  return url;
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** `dns.lookup` that fails when any address of the name is not public. */
function guardedLookup(hostname: string, options: { all?: boolean }, callback: LookupCallback) {
  dnsLookup(hostname, { all: true }, (error, addresses) => {
    if (error) {
      callback(error, []);
      return;
    }
    const list = addresses;
    if (list.length === 0 || list.some((entry) => !isPublicAddress(entry.address))) {
      callback(new FetchRefusedError(`${hostname} resolves to a non-public address`), []);
      return;
    }
    if (options.all) callback(null, list);
    else callback(null, list[0]?.address ?? '', list[0]?.family);
  });
}

export interface Fetched {
  /** The URL that answered, after redirects. */
  url: string;
  contentType: string;
  body: Buffer;
}

export interface GetOptions {
  maxBytes: number;
  timeoutMs: number;
  accept: string;
}

const USER_AGENT =
  'Mozilla/5.0 (compatible; DigitalActivationBot/1.0; +https://digital-activation.com)';
const MAX_REDIRECTS = 3;

export async function safeGet(raw: string, options: GetOptions): Promise<Fetched> {
  const deadline = Date.now() + options.timeoutMs;
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = checkUrl(current);
    const answer = await once(url, options, deadline);
    if ('location' in answer) {
      current = new URL(answer.location, url).toString();
      continue;
    }
    return answer;
  }
  throw new FetchRefusedError('too many redirects');
}

function once(
  url: URL,
  options: GetOptions,
  deadline: number,
): Promise<Fetched | { location: string }> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        lookup: guardedLookup,
        headers: { accept: options.accept, 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          resolve({ location: response.headers.location });
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(new Error(`HTTP ${String(status)}`));
          return;
        }
        const declared = Number(response.headers['content-length'] ?? 0);
        if (declared > options.maxBytes) {
          response.destroy();
          reject(new FetchRefusedError('too large'));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            response.destroy();
            reject(new FetchRefusedError('too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            url: url.toString(),
            contentType: String(response.headers['content-type'] ?? '').toLowerCase(),
            body: Buffer.concat(chunks),
          }),
        );
        response.on('error', reject);
      },
    );
    request.on('error', reject);
  });
}
