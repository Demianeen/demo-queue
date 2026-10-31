/** A privacy-enhanced YouTube embed address for a watch, short or share link, or null. */
export function youtubeEmbedUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    let id = "";
    if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (url.pathname === "/watch") id = url.searchParams.get("v") ?? "";
      else id = url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1] ?? "";
    }
    return /^[A-Za-z0-9_-]{6,}$/.test(id)
      ? `https://www.youtube-nocookie.com/embed/${id}`
      : null;
  } catch {
    return null;
  }
}

const VIDEO_ID = /^[A-Za-z0-9_-]{6,}$/;

/**
 * An embed address for the video hosts the judge page plays inline: YouTube,
 * Vimeo, Loom and Google Drive file previews. Any other link is null, and the
 * page shows "Open the demo video" instead of putting the site in a frame.
 */
export function videoEmbedUrl(value: string | null | undefined) {
  const youtube = youtubeEmbedUrl(value);
  if (youtube) return youtube;
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  if (host === "vimeo.com" && /^\d+$/.test(parts[0] ?? "")) {
    const hash = /^[0-9a-f]{6,}$/i.test(parts[1] ?? "") ? `?h=${parts[1]}` : "";
    return `https://player.vimeo.com/video/${parts[0]}${hash}`;
  }
  if (host === "player.vimeo.com" && parts[0] === "video" && /^\d+$/.test(parts[1] ?? "")) {
    const hash = url.searchParams.get("h");
    return `https://player.vimeo.com/video/${parts[1]}${hash && /^[0-9a-f]+$/i.test(hash) ? `?h=${hash}` : ""}`;
  }
  if (host === "loom.com" && (parts[0] === "share" || parts[0] === "embed") && VIDEO_ID.test(parts[1] ?? "")) {
    return `https://www.loom.com/embed/${parts[1]}`;
  }
  if (host === "drive.google.com" && parts[0] === "file" && parts[1] === "d" && VIDEO_ID.test(parts[2] ?? "")) {
    return `https://drive.google.com/file/d/${parts[2]}/preview`;
  }
  return null;
}
