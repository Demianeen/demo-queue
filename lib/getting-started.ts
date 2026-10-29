/** Pure rules for the Getting started guide. */

export type TeamCounts = { members: number; invited: number; accepted: number };

export function guideProgress(steps: boolean[]) {
  const done = steps.filter(Boolean).length;
  return { done, total: steps.length, percent: steps.length ? Math.round((done / steps.length) * 100) : 0 };
}

/** "3 invitations sent, 1 accepted", or the member count when nobody was invited here. */
export function teamSummary({ members, invited, accepted }: TeamCounts) {
  if (invited === 0) return `${members} ${members === 1 ? "member" : "members"}`;
  return `${invited} ${invited === 1 ? "invitation" : "invitations"} sent, ${accepted} accepted`;
}
