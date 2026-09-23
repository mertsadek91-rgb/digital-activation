import type { ReviewRequestSettings } from '@da/contracts';

/** One review request: which `ReviewInvite.stage` it is, and when it is due. */
export interface ReviewStage {
  stage: number;
  afterDays: number;
}

/**
 * The stages the invite sweep sends, from the `reviewRequests` settings.
 *
 * Stage numbers are fixed — 1 is the first ask, 2 the reminder — because they
 * are what `ReviewInvite`'s unique (orderId, stage) key remembers. Renumbering
 * them when a setting changed would make every order already asked look
 * un-asked, and ask it again.
 *
 * The reminder is dropped rather than moved when it would not come after the
 * first request: a second email on the same day as the first, or before it, is
 * the "asked twice in one minute" the sweep's lock exists to prevent. 0 is the
 * explicit way to say "no reminder".
 */
export function reviewStages(settings: ReviewRequestSettings): ReviewStage[] {
  const stages: ReviewStage[] = [{ stage: 1, afterDays: settings.firstAfterDays }];
  if (settings.secondAfterDays > settings.firstAfterDays) {
    stages.push({ stage: 2, afterDays: settings.secondAfterDays });
  }
  return stages;
}
