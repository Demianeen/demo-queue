export const MIN_ROUND_ONE_JUDGES = 2;
export const MAX_ROUND_ONE_JUDGES = 50;
export const MAX_JUDGE_NAME_LENGTH = 100;

function normalizeJudgeName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function judgeKey(value: string) {
  return normalizeJudgeName(value).toLocaleLowerCase("en");
}

export function parseRoundOneJudges(raw: string | string[]) {
  const values = Array.isArray(raw) ? raw : raw.split(/\r?\n/);
  const judges: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const judge = normalizeJudgeName(value);
    if (!judge) continue;
    if (judge.length > MAX_JUDGE_NAME_LENGTH) {
      throw new Error(`Judge names must be ${MAX_JUDGE_NAME_LENGTH} characters or fewer.`);
    }
    const key = judgeKey(judge);
    if (seen.has(key)) continue;
    seen.add(key);
    judges.push(judge);
  }

  if (judges.length < MIN_ROUND_ONE_JUDGES) {
    throw new Error("Add at least 2 distinct judges.");
  }
  if (judges.length > MAX_ROUND_ONE_JUDGES) {
    throw new Error(`Add no more than ${MAX_ROUND_ONE_JUDGES} judges.`);
  }
  return judges;
}

export function sameJudge(a: string, b: string) {
  return judgeKey(a) === judgeKey(b);
}

export function isValidRoundOneAssignment(assignment: string[] | undefined) {
  return Boolean(
    assignment &&
      assignment.length === 2 &&
      assignment.every((judge) => normalizeJudgeName(judge).length > 0) &&
      !sameJudge(assignment[0], assignment[1]),
  );
}

function pairKey(a: string, b: string) {
  return [judgeKey(a), judgeKey(b)].sort().join("\u0000");
}

export type JudgeAssignmentCounts = {
  individual: Map<string, number>;
  pairs: Map<string, number>;
};

export function buildJudgeAssignmentCounts(assignments: (string[] | undefined)[]) {
  const counts: JudgeAssignmentCounts = { individual: new Map(), pairs: new Map() };
  for (const assignment of assignments) {
    if (!isValidRoundOneAssignment(assignment)) continue;
    const [first, second] = assignment!;
    for (const judge of [first, second]) {
      const key = judgeKey(judge);
      counts.individual.set(key, (counts.individual.get(key) ?? 0) + 1);
    }
    const key = pairKey(first, second);
    counts.pairs.set(key, (counts.pairs.get(key) ?? 0) + 1);
  }
  return counts;
}

export function assignRoundOneJudgePair(
  roster: string[],
  counts: JudgeAssignmentCounts,
): [string, string] {
  if (roster.length < MIN_ROUND_ONE_JUDGES) {
    throw new Error("Add at least 2 distinct judges.");
  }

  let best: { pair: [string, string]; rank: number[] } | null = null;
  for (let firstIndex = 0; firstIndex < roster.length - 1; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < roster.length; secondIndex += 1) {
      const first = roster[firstIndex];
      const second = roster[secondIndex];
      const firstCount = counts.individual.get(judgeKey(first)) ?? 0;
      const secondCount = counts.individual.get(judgeKey(second)) ?? 0;
      const rank = [
        firstCount + secondCount,
        Math.max(firstCount, secondCount),
        counts.pairs.get(pairKey(first, second)) ?? 0,
        firstIndex,
        secondIndex,
      ];
      if (!best || rank.some((value, index) => value < best!.rank[index] && rank.slice(0, index).every((prior, priorIndex) => prior === best!.rank[priorIndex]))) {
        best = { pair: [first, second], rank };
      }
    }
  }

  const pair = best!.pair;
  for (const judge of pair) {
    const key = judgeKey(judge);
    counts.individual.set(key, (counts.individual.get(key) ?? 0) + 1);
  }
  const key = pairKey(pair[0], pair[1]);
  counts.pairs.set(key, (counts.pairs.get(key) ?? 0) + 1);
  return pair;
}

export function rosterIncludesJudge(roster: string[], judge: string) {
  return roster.some((candidate) => sameJudge(candidate, judge));
}
