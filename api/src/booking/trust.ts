// Trust score, infra/blueprint.md §4:
//   score = (C*m + sum stars) / (C + n)        C=5, m=4.0 prior
//         - 0.5 * (disputes lost in last 12 mo)
//         - 0.2 * (overdue returns in last 12 mo, excluding late-handover ones)
//         - 0.3 * (lender no-shows at handover in last 12 mo)
//         + 0.1 * min(completed, 20) / 20
//   clamped to [0, 5]

export const TRUST_PRIOR_WEIGHT = 5;
export const TRUST_PRIOR_MEAN = 4.0;
export const BORROWING_PAUSED_BELOW = 2.0;

export function computeTrustScore(i: {
  ratingsCount: number;
  starsSum: number;
  disputesLost12mo: number;
  overdue12mo: number;
  noShows12mo?: number;
  completed: number;
}): number {
  const bayes = (TRUST_PRIOR_WEIGHT * TRUST_PRIOR_MEAN + i.starsSum) / (TRUST_PRIOR_WEIGHT + i.ratingsCount);
  const raw =
    bayes - 0.5 * i.disputesLost12mo - 0.2 * i.overdue12mo - 0.3 * (i.noShows12mo ?? 0) + (0.1 * Math.min(i.completed, 20)) / 20;
  const clamped = Math.min(5, Math.max(0, raw));
  return Math.round(clamped * 100) / 100;
}
