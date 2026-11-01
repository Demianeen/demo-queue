import assert from "node:assert/strict";
import test from "node:test";

import {
  capExcerpts,
  entryRank,
  fetchCode,
  inputChanged,
  keepTreePath,
  planCodeRead,
  SUMMARY_CODE_FILE_LIMIT,
  SUMMARY_CODE_LIST_LIMIT,
  SUMMARY_CODE_TOTAL_LIMIT,
} from "../lib/ai-summary-inputs.ts";

/** A fetch that answers by URL, recording each call. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [match, answer] of routes) {
      if (String(url).includes(match)) return typeof answer === "function" ? answer(url, init) : answer.clone();
    }
    return new Response("Not found", { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

/** A request that never answers; it fails when the caller's timeout aborts it. The timer keeps the test alive until then. */
const hang = (url, init) => new Promise((_, reject) => {
  const alive = setTimeout(() => {}, 5_000);
  init.signal.addEventListener("abort", () => {
    clearTimeout(alive);
    reject(init.signal.reason);
  });
});

test("vendored, generated, binary, lock and test files are left out of the tree", () => {
  for (const path of [
    "node_modules/react/index.js", "web/dist/app.js", "build/main.js", ".next/server/page.js", "out/index.html",
    "coverage/lcov.info", "vendor/lib.go", "convex/_generated/api.js", "package-lock.json", "pnpm-lock.yaml", "web/yarn.lock",
    "Cargo.lock", "public/app.min.js", "styles.min.css", "public/logo.png", "assets/demo.mp4", "font.woff2", "model.onnx",
    "src/app.test.ts", "src/app.spec.tsx", "tests/test_api.py", "src/__tests__/a.ts", "fixtures/data.json", "pkg/x_test.go",
    "test_main.py", "bundle.js.map",
  ]) assert.equal(keepTreePath(path), false, path);
  for (const path of ["README.md", "src/app/page.tsx", "server/main.py", "package.json", "src/lib/latest.ts", "contest/main.go", "docs/build-notes.md"]) {
    assert.equal(keepTreePath(path), true, path);
  }
});

test("entry points rank before other files, shallow first", () => {
  assert.equal(entryRank("app/page.tsx"), 0);
  assert.equal(entryRank("src/app/page.tsx"), 0);
  assert.equal(entryRank("app/(chat)/page.tsx"), 0);
  assert.equal(entryRank("artifacts/code/server.ts"), null);
  assert.equal(entryRank("main.py"), 1);
  assert.equal(entryRank("src/index.ts"), 2);
  assert.equal(entryRank("backend/app/server.py"), 3);
  assert.equal(entryRank("app/api/chat/route.ts"), 4);
  assert.equal(entryRank("pages/api/hello.ts"), 4);
  assert.equal(entryRank("server/routes/users.py"), 4);
  assert.equal(entryRank("app/(chat)/api/chat/schema.ts"), null);
  assert.equal(entryRank("a/b/c/index.ts"), null);
  assert.equal(entryRank("src/components/Button.tsx"), null);
});

test("the files read are the entry points, then the largest source files", () => {
  const blob = (path, size = 100) => ({ path, type: "blob", size });
  const tree = [
    { path: "src", type: "tree" },
    blob("README.md", 9_000),
    blob("package.json", 800),
    blob("next.config.ts", 90_000),
    blob("src/types.d.ts", 80_000),
    blob("src/lib/agent.ts", 12_000),
    blob("src/lib/huge-data.ts", 500_000),
    blob("src/lib/small.ts", 300),
    blob("src/lib/queue.ts", 7_000),
    blob("src/components/Board.tsx", 9_000),
    blob("src/app/page.tsx", 2_000),
    blob("src/app/api/chat/route.ts", 1_500),
    blob("src/app.test.ts", 50_000),
    blob("node_modules/big/index.js", 900_000),
    blob("public/hero.png", 400_000),
  ];
  const plan = planCodeRead(tree);
  assert.deepEqual(plan.chosen, ["src/app/page.tsx", "src/app/api/chat/route.ts", "src/lib/agent.ts", "src/components/Board.tsx", "src/lib/queue.ts"]);
  assert.equal(plan.files[0], "README.md");
  assert.ok(plan.files.includes("src/lib/huge-data.ts"));
  assert.ok(!plan.files.some((path) => path.includes("node_modules") || path.endsWith(".png") || path.endsWith(".test.ts")));
  assert.equal(plan.total, plan.files.length);

  // Many routes: three entry points, then the largest files still get a place.
  const routes = planCodeRead([
    ...["a", "b", "c", "d", "e"].map((name) => blob(`app/api/${name}/route.ts`, 500)),
    blob("lib/core.ts", 20_000),
    blob("lib/util.ts", 10_000),
  ]);
  assert.deepEqual(routes.chosen, ["app/api/a/route.ts", "app/api/b/route.ts", "app/api/c/route.ts", "lib/core.ts", "lib/util.ts"]);

  const many = Array.from({ length: 250 }, (_, index) => blob(`src/file${index}.ts`));
  const big = planCodeRead(many);
  assert.equal(big.files.length, SUMMARY_CODE_LIST_LIMIT);
  assert.equal(big.total, 250);
});

test("excerpts are capped each and in total, in the order chosen", () => {
  const capped = capExcerpts(["a", "b", "c", "d", "e"].map((name) => ({ path: `${name}.ts`, text: name.repeat(10_000) })));
  assert.ok(capped.every((excerpt) => excerpt.text.length <= SUMMARY_CODE_FILE_LIMIT));
  assert.equal(capped.reduce((sum, excerpt) => sum + excerpt.text.length, 0), SUMMARY_CODE_TOTAL_LIMIT);
  assert.deepEqual(capped.map((excerpt) => excerpt.path), ["a.ts", "b.ts", "c.ts", "d.ts"]);
  assert.deepEqual(capExcerpts([{ path: "empty.ts", text: "  " }, { path: "x.ts", text: "x" }]), [{ path: "x.ts", text: "x" }]);
});

const repository = { owner: "example", name: "guardrail", defaultBranch: "main" };
const treeResponse = () => new Response(JSON.stringify({ tree: [
  { path: "src/index.ts", type: "blob", size: 500 },
  { path: "src/policy.ts", type: "blob", size: 900 },
  { path: "README.md", type: "blob", size: 100 },
] }));

test("the code read is one tree call, then the chosen files from raw.githubusercontent.com in parallel", async () => {
  const fetch = fakeFetch([
    ["/git/trees/main?recursive=1", treeResponse()],
    ["raw.githubusercontent.com/example/guardrail/main/src/index.ts", new Response("export const start = 1;")],
    ["raw.githubusercontent.com/example/guardrail/main/src/policy.ts", new Response("export function check() {}")],
  ]);
  const result = await fetchCode(repository, { fetch, headers: { Authorization: "Bearer test-token" } });
  assert.deepEqual(result, {
    kind: "ok",
    files: ["README.md", "src/index.ts", "src/policy.ts"],
    total: 3,
    excerpts: [{ path: "src/index.ts", text: "export const start = 1;" }, { path: "src/policy.ts", text: "export function check() {}" }],
    fileFailures: 0,
  });
  assert.equal(fetch.calls.filter((call) => call.url.startsWith("https://api.github.com/")).length, 1);
  assert.ok(fetch.calls.every((call) => call.init.headers.Authorization === "Bearer test-token"));
});

test("a rate-limited, failed or slow tree read means no code; a failed file is left out", async () => {
  for (const status of [403, 429]) {
    assert.deepEqual(await fetchCode(repository, { fetch: fakeFetch([["/git/trees/", new Response("limited", { status })]]) }), { kind: "failed", reason: "code_rate_limited" });
  }
  for (const answer of [new Response("oops", { status: 500 }), new Response("not json"), new Response(JSON.stringify({ message: "x" }))]) {
    assert.deepEqual(await fetchCode(repository, { fetch: fakeFetch([["/git/trees/", answer]]) }), { kind: "failed", reason: "code_tree_failed" });
  }
  assert.deepEqual(await fetchCode(repository, { fetch: fakeFetch([["/git/trees/", hang]]), timeoutMs: 20 }), { kind: "failed", reason: "code_timeout" });
  // An empty repository, or one with nothing worth listing, has no code.
  assert.deepEqual(await fetchCode(repository, { fetch: fakeFetch([["/git/trees/", new Response("empty", { status: 409 })]]) }), { kind: "none" });
  assert.deepEqual(await fetchCode(repository, { fetch: fakeFetch([["/git/trees/", new Response(JSON.stringify({ tree: [{ path: "logo.png", type: "blob" }] }))]]) }), { kind: "none" });

  const partial = await fetchCode(repository, { fetch: fakeFetch([
    ["/git/trees/", treeResponse()],
    ["/src/index.ts", new Response("limited", { status: 429 })],
    ["/src/policy.ts", new Response("binary\u0000data")],
  ]) });
  assert.deepEqual(partial, { kind: "ok", files: ["README.md", "src/index.ts", "src/policy.ts"], total: 3, excerpts: [], fileFailures: 2 });
});

test("only a real change to an input counts; a failed read or an older summary never does", () => {
  assert.equal(inputChanged("aaa", "bbb"), true);
  assert.equal(inputChanged("none", "bbb"), true);
  assert.equal(inputChanged("aaa", "none"), true);
  assert.equal(inputChanged("aaa", "aaa"), false);
  // Could not be read now.
  assert.equal(inputChanged("aaa", null), false);
  // Written before these inputs existed.
  assert.equal(inputChanged(undefined, "bbb"), false);
  assert.equal(inputChanged(null, "bbb"), false);
});
