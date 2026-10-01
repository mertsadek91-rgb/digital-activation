/**
 * Lets `final-processor.ts` — the processor's reference SDK, kept byte-for-byte
 * as delivered — compile against @types/node.
 *
 * The SDK passes `cache: 'no-store'` to `fetch`. Node's fetch (undici) accepts
 * it at runtime (`new Request(url, { cache: 'no-store' }).cache === 'no-store'`
 * on Node 22), but @types/node's `RequestInit` does not declare the member, so
 * tsc refuses the object literal. Declaring it here, rather than editing the
 * SDK, keeps the file identical to the reference.
 */
export {};

declare global {
  interface RequestInit {
    cache?: 'default' | 'force-cache' | 'no-cache' | 'no-store' | 'only-if-cached' | 'reload';
  }
}
