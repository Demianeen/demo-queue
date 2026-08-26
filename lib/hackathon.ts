export const MAX_ADDITIONAL_TEAM_MEMBERS = 9;
export const MAX_TEAM_NAME_LENGTH = 80;
export const MAX_TEAM_MEMBER_NAME_LENGTH = 80;
export const MAX_GITHUB_REPOSITORY_URL_LENGTH = 300;
export const MAX_HACKATHON_VIDEO_URL_LENGTH = 2_000;

export function parseAdditionalTeamMembers(value: string) {
  return value
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
}

export function normalizeGithubRepositoryUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_GITHUB_REPOSITORY_URL_LENGTH) return null;

  try {
    const url = new URL(trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "https:" || !["github.com", "www.github.com"].includes(url.hostname.toLowerCase())) {
      return null;
    }

    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length !== 2 || !pathParts[0] || !pathParts[1]) return null;
    const repository = pathParts[1].replace(/\.git$/i, "");
    if (!repository) return null;

    return `https://github.com/${pathParts[0]}/${repository}`;
  } catch {
    return null;
  }
}

export function normalizeHackathonVideoUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_HACKATHON_VIDEO_URL_LENGTH) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}
