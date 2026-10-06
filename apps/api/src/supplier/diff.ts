import type { SupplierLine } from './sheet-parse.js';

/**
 * What changed on one supplier line between two reads. Pure, so the rules —
 * which fields count, what a cost change looks like — are pinned by tests.
 */

export type ChangeKind = 'COST' | 'STOCK' | 'CATEGORY' | 'WARRANTY' | 'REMARKS';

export interface StoredLine {
  costUsd: string | null;
  outOfStock: boolean;
  category: string | null;
  warranty: string | null;
  remarks: string | null;
}

export interface LineChange {
  kind: ChangeKind;
  before: string | boolean | null;
  after: string | boolean | null;
}

export function diffLine(stored: StoredLine, line: SupplierLine): LineChange[] {
  const changes: LineChange[] = [];
  if (stored.costUsd !== line.costUsd) {
    changes.push({ kind: 'COST', before: stored.costUsd, after: line.costUsd });
  }
  if (stored.outOfStock !== line.outOfStock) {
    changes.push({ kind: 'STOCK', before: stored.outOfStock, after: line.outOfStock });
  }
  if (stored.category !== line.category) {
    changes.push({ kind: 'CATEGORY', before: stored.category, after: line.category });
  }
  if (stored.warranty !== line.warranty) {
    changes.push({ kind: 'WARRANTY', before: stored.warranty, after: line.warranty });
  }
  if (stored.remarks !== line.remarks) {
    changes.push({ kind: 'REMARKS', before: stored.remarks, after: line.remarks });
  }
  return changes;
}

/**
 * Whether a linked variant should be "notify me": the line is struck through,
 * or the supplier no longer lists it at all. A line that vanished is not one
 * we can buy, and selling it would be a refund.
 */
export function supplierUnavailable(item: {
  outOfStock: boolean;
  missingSince: Date | null;
}): boolean {
  return item.outOfStock || item.missingSince !== null;
}

/**
 * A read that suddenly has far fewer rows than the last one is a broken read
 * (a tab renamed, a filter left on, half the sheet deleted by mistake), not
 * the supplier discontinuing most of its catalogue. Applying it would mark
 * hundreds of variants "notify me" at once.
 */
export function suspiciousShrink(previousActive: number, now: number): boolean {
  return previousActive >= 20 && now < previousActive * 0.5;
}

/**
 * A read that would switch more than half the linked, currently buyable
 * products to "notify me" at once (with at least ten linked) is held for a
 * person: a formatting accident is far likelier than the supplier running
 * out of most of its list in an hour.
 */
export function suspiciousOutage(linked: number, newlyOut: number): boolean {
  return linked >= 10 && newlyOut > linked * 0.5;
}
