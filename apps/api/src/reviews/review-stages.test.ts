import { describe, expect, it } from 'vitest';

import { reviewRequestSettingsSchema } from '@da/contracts';

import { reviewStages } from './review-stages.js';

describe('reviewStages', () => {
  it('defaults to what the sweep sent before it was configurable: day 3 and day 10', () => {
    expect(reviewStages(reviewRequestSettingsSchema.parse({}))).toEqual([
      { stage: 1, afterDays: 3 },
      { stage: 2, afterDays: 10 },
    ]);
  });

  it('follows the configured days', () => {
    expect(reviewStages({ firstAfterDays: 5, secondAfterDays: 14 })).toEqual([
      { stage: 1, afterDays: 5 },
      { stage: 2, afterDays: 14 },
    ]);
  });

  it('drops the reminder when it is 0', () => {
    expect(reviewStages({ firstAfterDays: 3, secondAfterDays: 0 })).toEqual([
      { stage: 1, afterDays: 3 },
    ]);
  });

  it('drops a reminder that would not come after the first request', () => {
    // Same day or earlier would be two emails at once, or the reminder first.
    expect(reviewStages({ firstAfterDays: 7, secondAfterDays: 7 })).toHaveLength(1);
    expect(reviewStages({ firstAfterDays: 7, secondAfterDays: 4 })).toHaveLength(1);
  });

  it('keeps stage numbers fixed, since ReviewInvite is keyed on them', () => {
    expect(reviewStages({ firstAfterDays: 1, secondAfterDays: 30 }).map((s) => s.stage)).toEqual([
      1, 2,
    ]);
  });
});
