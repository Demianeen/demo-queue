export const MAX_HACKATHON_VIDEO_BYTES = 250 * 1024 * 1024;
export const MAX_HACKATHON_VIDEO_LABEL = "250 MB";
export const MAX_ADDITIONAL_TEAM_MEMBERS = 9;
export const MAX_TEAM_NAME_LENGTH = 80;
export const MAX_TEAM_MEMBER_NAME_LENGTH = 80;

const VIDEO_CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

export function videoContentType(file: Pick<File, "name" | "type">) {
  if (file.type.startsWith("video/")) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_CONTENT_TYPES_BY_EXTENSION[extension] ?? "";
}

export function isSupportedVideo(file: Pick<File, "name" | "type">) {
  return Boolean(videoContentType(file));
}

export function parseAdditionalTeamMembers(value: string) {
  return value
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
}
