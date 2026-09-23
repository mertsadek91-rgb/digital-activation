import type { Prisma } from '@da/db';

/**
 * A moved address, as the redirect map records it.
 *
 * The same three writes the product rename makes in `catalog-edit.service.ts`,
 * plus the one it is missing. Written inside the caller's transaction, because
 * a slug change and its redirect are one decision: the old URL is in Google and
 * in customers' inboxes, and a rename that commits without its 301 is the one
 * edit that silently destroys traffic.
 *
 *   1. old → new, created or re-pointed.
 *   2. Anything that pointed at old now points at new, so two renames do not
 *      make a chain a crawler gives up on.
 *   3. Any redirect *from* the new address is removed. Renaming A→B and back
 *      again otherwise leaves B→A beside A→B: harmless while A answers 200,
 *      a loop the day it is unpublished and the storefront consults the map.
 */
export async function recordMove(
  tx: Prisma.TransactionClient,
  input: { from: string; to: string; actorId: string | undefined },
): Promise<void> {
  const { from, to } = input;
  if (from === to) return;

  await tx.redirect.deleteMany({ where: { from: to } });
  await tx.redirect.upsert({
    where: { from },
    update: { to, code: 301, isActive: true },
    create: {
      from,
      to,
      code: 301,
      isActive: true,
      source: 'manual',
      createdById: input.actorId ?? null,
    },
  });
  await tx.redirect.updateMany({ where: { to: from }, data: { to } });
}
