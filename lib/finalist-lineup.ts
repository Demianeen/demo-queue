/**
 * On a hackathon the stage lineup is the finalists. This plans the lineup
 * after finalists are submitted: the existing queue machinery (status
 * "queued", queueOrder, the current presenter, advance) then runs the pitches.
 *
 * Nothing is deleted. Only "candidate" and "queued" rows move:
 * - finalists already in the lineup keep their order, so a reorder on Stage
 *   and the current presenter survive a resubmit;
 * - finalists waiting in the pool join at the end, in the finalists' order;
 * - anyone else in the lineup (an old hand-built lineup) goes back to the pool.
 * Rows that pitched, did not show, withdrew or were hidden stay as they are.
 */
export type LineupRow = { id: string; status: string; queueOrder?: number };

export type LineupUpdate = { id: string; status: "queued" | "candidate"; queueOrder: number | undefined };

export function finalistLineupPlan(rows: LineupRow[], finalistIds: string[]) {
  const finalists = new Set(finalistIds);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const queued = rows
    .filter((row) => row.status === "queued")
    .sort((a, b) => (a.queueOrder ?? Number.MAX_SAFE_INTEGER) - (b.queueOrder ?? Number.MAX_SAFE_INTEGER));
  const kept = queued.filter((row) => finalists.has(row.id)).map((row) => row.id);
  const keptSet = new Set(kept);
  const joining = finalistIds.filter((id) => !keptSet.has(id) && byId.get(id)?.status === "candidate");
  const lineup = [...kept, ...joining];

  const updates: LineupUpdate[] = [];
  lineup.forEach((id, index) => {
    const row = byId.get(id)!;
    if (row.status !== "queued" || row.queueOrder !== index + 1) updates.push({ id, status: "queued", queueOrder: index + 1 });
  });
  for (const row of queued) {
    if (!finalists.has(row.id)) updates.push({ id: row.id, status: "candidate", queueOrder: undefined });
  }
  return { lineup, updates };
}
