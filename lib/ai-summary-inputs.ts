/**
 * The optional input of a summary next to the README: a short read of the
 * repository's code. It is best effort: any failure means the summary is
 * written without it, never later.
 */

/** How many source files are excerpted, how much of each, and how much in all. */
export const SUMMARY_CODE_FILE_COUNT = 5;
export const SUMMARY_CODE_ENTRY_COUNT = 3;
export const SUMMARY_CODE_FILE_LIMIT = 4_000;
export const SUMMARY_CODE_TOTAL_LIMIT = 15_000;
/** How many repository paths the model sees. */
export const SUMMARY_CODE_LIST_LIMIT = 100;
/** One budget for the code read: the tree plus its files. */
export const SUMMARY_INPUT_TIMEOUT_MS = 8_000;
/** Bigger files are likely bundled or generated, so they are listed but never excerpted. */
const CODE_FILE_MAX_BYTES = 200_000;

type Fetch = typeof fetch;
export type InputOptions = { fetch?: Fetch; timeoutMs?: number };

const isTimeout = (error: unknown) => error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

// Code read

export type TreeEntry = { path: string; type: string; size?: number };
export type CodeExcerpt = { path: string; text: string };
export type CodeReason = "code_tree_failed" | "code_rate_limited" | "code_timeout";
export type CodeResult =
  | { kind: "ok"; files: string[]; total: number; excerpts: CodeExcerpt[]; fileFailures: number }
  | { kind: "none" }
  | { kind: "failed"; reason: CodeReason };

const SKIPPED_DIRS = new Set([
  "node_modules", "bower_components", "jspm_packages", "dist", "build", "out", ".next", ".nuxt", ".output", ".svelte-kit",
  ".turbo", ".vercel", ".expo", ".cache", ".parcel-cache", "coverage", ".nyc_output", "vendor", "vendors", "third_party",
  "third-party", "target", "pods", "deriveddata", "__pycache__", ".venv", "venv", ".tox", ".mypy_cache", ".pytest_cache",
  ".git", ".idea", ".vscode", "generated", "__generated__", "_generated",
  "test", "tests", "__tests__", "spec", "specs", "e2e", "fixtures", "__fixtures__", "__mocks__", "testdata", "cypress",
]);
const LOCKFILES = new Set([
  "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock", "deno.lock",
  "cargo.lock", "gemfile.lock", "poetry.lock", "pipfile.lock", "uv.lock", "composer.lock", "go.sum", "mix.lock",
  "pubspec.lock", "podfile.lock", "flake.lock", "packages.lock.json",
]);
const BINARY = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "icns", "tif", "tiff", "psd", "svg", "heic",
  "mp4", "mov", "avi", "webm", "mkv", "mp3", "wav", "ogg", "flac", "m4a", "aac",
  "pdf", "zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "jar", "war", "class", "exe", "dll", "so", "dylib", "a", "o",
  "bin", "wasm", "pyc", "pyo", "whl", "woff", "woff2", "ttf", "otf", "eot", "db", "sqlite", "sqlite3", "parquet",
  "npy", "npz", "pkl", "pickle", "pt", "pth", "onnx", "h5", "ckpt", "safetensors", "tflite", "glb", "gltf", "fbx", "stl",
  "blend", "apk", "ipa", "dmg", "iso", "keystore", "jks", "p12", "pem", "key", "snap", "map", "lockb",
]);
const SOURCE = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "java", "kt", "kts", "swift", "rb", "php", "cs", "cpp", "cc",
  "cxx", "c", "h", "hpp", "m", "mm", "vue", "svelte", "astro", "dart", "scala", "ex", "exs", "erl", "clj", "hs", "lua",
  "sol", "r", "jl", "zig", "ml", "fs", "gd",
]);
const ENTRY_NAMES = ["main", "app", "server", "index", "__main__", "cli"];
// A main or index two folders down counts only under one of these, so artifacts/code/server.ts does not.
const SOURCE_ROOTS = new Set(["src", "app", "apps", "packages", "backend", "frontend", "server", "web", "client", "api", "cmd"]);

const extension = (path: string) => /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
const depth = (path: string) => path.split("/").length - 1;
const byDepth = (a: string, b: string) => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0);

/** True for a file worth listing: not vendored, generated, a lockfile, minified, binary, or a test or fixture. */
export function keepTreePath(path: string) {
  const parts = path.split("/");
  const name = parts.at(-1)!.toLowerCase();
  if (parts.slice(0, -1).some((dir) => SKIPPED_DIRS.has(dir.toLowerCase()))) return false;
  if (LOCKFILES.has(name) || BINARY.has(extension(name))) return false;
  if (/\.min\./.test(name) || /\.(test|spec|stories)\.[^.]+$/.test(name) || /_test\.(go|py)$/.test(name) || /^test_.*\.py$/.test(name)) return false;
  return true;
}

/** A file a reader would open first: an app's main, server or index near the root, a root page, an API route. Lower ranks first. */
export function entryRank(path: string) {
  const parts = path.toLowerCase().split("/");
  const stem = parts.at(-1)!.replace(/\.[^.]+$/, "");
  // Next.js route groups such as app/(chat)/page.tsx do not change the route.
  const dirs = parts.slice(0, -1).filter((dir) => !/^\(.*\)$/.test(dir));
  if (stem === "page" && dirs.at(-1) === "app") return 0;
  const named = ENTRY_NAMES.indexOf(stem);
  if (named !== -1 && (dirs.length <= 1 || (dirs.length === 2 && SOURCE_ROOTS.has(dirs[0])))) return 1 + dirs.length;
  // Under a Next.js app folder only route files are endpoints; elsewhere any file in api or routes.
  if ((dirs.includes("api") || dirs.includes("routes")) && (stem === "route" || !dirs.includes("app"))) return 4;
  return null;
}

/** A source file that may be excerpted: code, not a config file, and not so big it is likely generated. */
const excerptable = (entry: TreeEntry) =>
  SOURCE.has(extension(entry.path)) && !/\.d\.ts$|\.config\.[cm]?[jt]s$/i.test(entry.path) && (entry.size ?? 0) <= CODE_FILE_MAX_BYTES;

/**
 * What the model sees of a repository tree: the kept paths, shallow first,
 * and the source files to excerpt, entry points first, then the largest.
 */
export function planCodeRead(tree: TreeEntry[]) {
  const kept = tree.filter((entry) => entry.type === "blob" && typeof entry.path === "string" && keepTreePath(entry.path));
  const files = kept.map((entry) => entry.path).sort(byDepth);
  const sources = kept.filter(excerptable);
  const entries = sources
    .flatMap((entry) => {
      const rank = entryRank(entry.path);
      return rank === null ? [] : [{ entry, rank }];
    })
    .sort((a, b) => a.rank - b.rank || byDepth(a.entry.path, b.entry.path))
    .map(({ entry }) => entry.path);
  // At most three entry points, so the largest files (often the core logic) still get a place.
  const chosen = entries.slice(0, SUMMARY_CODE_ENTRY_COUNT);
  const largest = sources
    .filter((entry) => !chosen.includes(entry.path))
    .sort((a, b) => (b.size ?? 0) - (a.size ?? 0) || byDepth(a.path, b.path))
    .map((entry) => entry.path);
  return { files: files.slice(0, SUMMARY_CODE_LIST_LIMIT), total: files.length, chosen: [...chosen, ...largest].slice(0, SUMMARY_CODE_FILE_COUNT) };
}

/** Each excerpt capped, and all of them together, in the order chosen. */
export function capExcerpts(excerpts: CodeExcerpt[]) {
  const capped: CodeExcerpt[] = [];
  let left = SUMMARY_CODE_TOTAL_LIMIT;
  for (const excerpt of excerpts) {
    const text = excerpt.text.slice(0, Math.min(SUMMARY_CODE_FILE_LIMIT, left)).trimEnd();
    if (!text) continue;
    capped.push({ path: excerpt.path, text });
    left -= text.length;
    if (left <= 0) break;
  }
  return capped;
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");
const isRateLimited = (response: Response) => response.status === 403 || response.status === 429;

/**
 * A short read of a public repository's code: one GitHub API call for the
 * tree of the default branch, then up to five files from
 * raw.githubusercontent.com in parallel, all within one timeout. Only call it
 * for a repository already checked to be public.
 */
export async function fetchCode(
  repository: { owner: string; name: string; defaultBranch: string },
  options: InputOptions & { headers?: Record<string, string> } = {},
): Promise<CodeResult> {
  const request = options.fetch ?? fetch;
  const signal = AbortSignal.timeout(options.timeoutMs ?? SUMMARY_INPUT_TIMEOUT_MS);
  const headers = options.headers ?? {};
  const base = `${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
  let tree: TreeEntry[];
  try {
    const response = await request(`https://api.github.com/repos/${base}/git/trees/${encodeURIComponent(repository.defaultBranch)}?recursive=1`, {
      headers: { Accept: "application/vnd.github+json", ...headers },
      signal,
    });
    if (isRateLimited(response)) return { kind: "failed", reason: "code_rate_limited" };
    // An empty repository has no tree: a 404 or 409.
    if (response.status === 404 || response.status === 409) return { kind: "none" };
    if (!response.ok) return { kind: "failed", reason: "code_tree_failed" };
    const body = (await response.json()) as { tree?: unknown };
    if (!Array.isArray(body.tree)) return { kind: "failed", reason: "code_tree_failed" };
    tree = body.tree as TreeEntry[];
  } catch (error) {
    return { kind: "failed", reason: isTimeout(error) ? "code_timeout" : "code_tree_failed" };
  }
  const plan = planCodeRead(tree);
  if (plan.files.length === 0) return { kind: "none" };
  const fetched = await Promise.all(plan.chosen.map(async (path): Promise<CodeExcerpt | null> => {
    try {
      const response = await request(`https://raw.githubusercontent.com/${base}/${encodePath(repository.defaultBranch)}/${encodePath(path)}`, { headers, signal });
      if (!response.ok) return null;
      const text = await response.text();
      // A binary file with a source name.
      return text.includes("\u0000") ? null : { path, text };
    } catch {
      return null;
    }
  }));
  const excerpts = capExcerpts(fetched.filter((excerpt): excerpt is CodeExcerpt => excerpt !== null));
  return { kind: "ok", files: plan.files, total: plan.total, excerpts, fileFailures: fetched.filter((excerpt) => excerpt === null).length };
}

// Change detection

/**
 * Whether an input changed since a summary was written. stored is what the
 * summary was written from: a hash, "none" when the model saw nothing for it,
 * or undefined for a summary written before this input existed, which is
 * never rewritten for it. current is null when it could not be read now, so
 * a failed read never counts as a change.
 */
export function inputChanged(stored: string | undefined | null, current: string | null) {
  return stored !== undefined && stored !== null && current !== null && stored !== current;
}
