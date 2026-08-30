import { NextRequest, NextResponse } from "next/server";
import { normalizeGithubRepositoryUrl } from "@/lib/hackathon";

export async function GET(request: NextRequest) {
  const repositoryUrl = normalizeGithubRepositoryUrl(
    request.nextUrl.searchParams.get("url") ?? "",
  );
  if (!repositoryUrl) {
    return NextResponse.json({ error: "Invalid GitHub repository URL." }, { status: 400 });
  }

  const { pathname } = new URL(repositoryUrl);
  const [owner, repository] = pathname.split("/").filter(Boolean);
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/readme`,
    {
      headers: {
        Accept: "application/vnd.github.raw+json",
        "User-Agent": "demo-queue-judge-workspace",
      },
      next: { revalidate: 3600 },
    },
  );

  if (!response.ok) {
    return NextResponse.json(
      { error: response.status === 404 ? "README not found." : "README could not be loaded." },
      { status: response.status === 404 ? 404 : 502 },
    );
  }

  return NextResponse.json({ markdown: await response.text() });
}
