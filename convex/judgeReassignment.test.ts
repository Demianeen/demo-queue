import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addProject, createEvent, judgeKeys, judgeLink, openJudging, score, setupTest, type TestClient } from "./behaviour.testing";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T18:00:00Z"));
});
afterEach(() => vi.useRealTimers());

async function judgingEvent(names: string[], projectCount: number) {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { judges: names });
  for (let index = 0; index < projectCount; index += 1) await addProject(t, eventId, index);
  const tokens: Record<string, string> = {};
  for (const name of names) tokens[name.toLowerCase()] = await judgeLink(t, name);
  await openJudging(t);
  return { t, eventId, tokens, keys: await judgeKeys(t) };
}

async function assignments(t: TestClient) {
  return new Map((await t.run((ctx) => ctx.db.query("submissions").collect())).map((row) => [String(row._id), row.roundOneAssignedJudges!]));
}

const ownOf = (rows: Map<string, string[]>, key: string) => [...rows].filter(([, judges]) => judges.includes(key)).map(([id]) => id as Id<"submissions">);

test("removing a judge spreads their projects over the judges still scoring, never one added after the hand-out", async () => {
  const { t, keys } = await judgingEvent(["Ada", "Bo", "Cy", "Tom"], 12);
  const before = await assignments(t);
  const tom = ownOf(before, keys.tom);
  expect(tom.length).toBeGreaterThan(3);
  const { added: [uma] } = await t.mutation(api.judging.addJudges, { slug: "hack", names: ["Uma"] });

  await t.mutation(api.judging.removeJudge, { slug: "hack", judgeKey: keys.tom });

  const after = await assignments(t);
  const gained = new Map<string, number>();
  for (const id of tom) {
    const judges = after.get(String(id))!;
    expect(new Set(judges).size).toBe(2);
    expect(judges).not.toContain(keys.tom);
    expect(judges).not.toContain(uma.judgeKey);
    const newJudge = judges.find((key) => !before.get(String(id))!.includes(key))!;
    gained.set(newJudge, (gained.get(newJudge) ?? 0) + 1);
  }
  // One at a time: nobody takes them all.
  expect(gained.size).toBe(3);
  expect(Math.max(...gained.values()) - Math.min(...gained.values())).toBeLessThanOrEqual(1);
});

test("turning a judge off sends their projects to judges with projects left, never to ones who finished or scored it", async () => {
  const { t, tokens, keys } = await judgingEvent(["Ada", "Bo", "Cy", "Di", "Ed", "Rae"], 12);
  const before = await assignments(t);
  // Ada and Bo scored all theirs and left.
  for (const name of ["ada", "bo"]) for (const id of ownOf(before, keys[name])) await score(t, tokens[name], id, 7);
  // Cy helped on one of Rae's projects that isn't Cy's.
  const helped = ownOf(before, keys.rae).find((id) => !before.get(String(id))!.some((key) => [keys.cy, keys.ada, keys.bo].includes(key)));
  expect(helped).toBeDefined();
  await score(t, tokens.cy, helped!, 6);

  const preview = await t.query(api.judging.previewRedistribution, { slug: "hack", unavailableJudgeKey: keys.rae });
  expect(preview.length).toBeGreaterThan(0);
  const newJudges = preview.map((row) => row.judges.find((key) => !row.previousJudges.includes(key))!);
  for (const key of newJudges) expect([keys.cy, keys.di, keys.ed]).toContain(key);
  expect(preview.find((row) => row.submissionId === helped)!.judges).not.toContain(keys.cy);
  for (const row of preview) expect(new Set(row.judges).size).toBe(2);
});

test("when every other judge has finished, a turned-off judge's projects still find someone", async () => {
  const { t, tokens, keys } = await judgingEvent(["Ada", "Bo", "Rae"], 3);
  const before = await assignments(t);
  for (const name of ["ada", "bo"]) for (const id of ownOf(before, keys[name])) await score(t, tokens[name], id, 7);

  const preview = await t.query(api.judging.previewRedistribution, { slug: "hack", unavailableJudgeKey: keys.rae });
  for (const row of preview) {
    expect(row.judges).not.toContain(keys.rae);
    expect(new Set(row.judges).size).toBe(2);
  }
});
