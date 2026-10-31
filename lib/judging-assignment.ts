export const MIN_ROUND_ONE_JUDGES = 2;
export const MAX_ROUND_ONE_JUDGES = 50;
export const MAX_JUDGE_NAME_LENGTH = 100;

/** A judge's name as shown: NFKC, trimmed, single spaces. */
export function normalizeJudgeName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

/**
 * The judge key a stored judge reference stands for. A roster or assignment
 * entry is a judge key, or, on events set up before judges had ids, the
 * judge's name then, whose normalized form is the key it was given. Keys are
 * already normalized, so both shapes resolve to the same key.
 *
 * Never call this on a judge's current name to find the judge: names can
 * change and keys don't. To spot two judges with the same name, compare
 * judgeNameKey of both names.
 */
export function judgeKeyOf(reference: string) {
  return normalizeJudgeName(reference).toLocaleLowerCase("en");
}

/** What two names are compared by, to spot a duplicate. Same as judgeKeyOf, used on names. */
export function judgeNameKey(name: string) {
  return judgeKeyOf(name);
}

/** Names typed or pasted one per line: normalized, blanks and repeats dropped. */
export function parseJudgeNames(raw: string | string[]) {
  const values = Array.isArray(raw) ? raw : raw.split(/\r?\n/);
  const judges: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const judge = normalizeJudgeName(value);
    if (!judge) continue;
    if (judge.length > MAX_JUDGE_NAME_LENGTH) {
      throw new Error(`Judge names must be ${MAX_JUDGE_NAME_LENGTH} characters or fewer.`);
    }
    const key = judgeNameKey(judge);
    if (seen.has(key)) continue;
    seen.add(key);
    judges.push(judge);
  }
  return judges;
}

export function parseRoundOneJudges(raw: string | string[]) {
  const judges = parseJudgeNames(raw);
  if (judges.length < MIN_ROUND_ONE_JUDGES) {
    throw new Error("Add at least 2 distinct judges.");
  }
  if (judges.length > MAX_ROUND_ONE_JUDGES) {
    throw new Error(`Add no more than ${MAX_ROUND_ONE_JUDGES} judges.`);
  }
  return judges;
}

/** Whether two stored judge references (keys, or names from before ids) are the same judge. */
export function sameJudge(a: string, b: string) {
  return judgeKeyOf(a) === judgeKeyOf(b);
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
  return [judgeKeyOf(a), judgeKeyOf(b)].sort().join("\u0000");
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
      const key = judgeKeyOf(judge);
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
      const firstCount = counts.individual.get(judgeKeyOf(first)) ?? 0;
      const secondCount = counts.individual.get(judgeKeyOf(second)) ?? 0;
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
    const key = judgeKeyOf(judge);
    counts.individual.set(key, (counts.individual.get(key) ?? 0) + 1);
  }
  const key = pairKey(pair[0], pair[1]);
  counts.pairs.set(key, (counts.pairs.get(key) ?? 0) + 1);
  return pair;
}

export function rosterIncludesJudge(roster: string[], judge: string) {
  return roster.some((candidate) => sameJudge(candidate, judge));
}
