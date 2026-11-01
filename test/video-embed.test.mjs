import assert from "node:assert/strict";
import test from "node:test";

import { videoEmbedUrl } from "../lib/video-embed.ts";

test("known video hosts get an embed address", () => {
  assert.equal(videoEmbedUrl("https://www.youtube.com/watch?v=abcdef12345"), "https://www.youtube-nocookie.com/embed/abcdef12345");
  assert.equal(videoEmbedUrl("https://youtu.be/abcdef12345"), "https://www.youtube-nocookie.com/embed/abcdef12345");
  assert.equal(videoEmbedUrl("https://vimeo.com/123456789"), "https://player.vimeo.com/video/123456789");
  assert.equal(videoEmbedUrl("https://vimeo.com/123456789/abcdef1234"), "https://player.vimeo.com/video/123456789?h=abcdef1234");
  assert.equal(videoEmbedUrl("https://player.vimeo.com/video/123456789"), "https://player.vimeo.com/video/123456789");
  assert.equal(videoEmbedUrl("https://www.loom.com/share/0123456789abcdef"), "https://www.loom.com/embed/0123456789abcdef");
  assert.equal(videoEmbedUrl("https://loom.com/embed/0123456789abcdef"), "https://www.loom.com/embed/0123456789abcdef");
  assert.equal(videoEmbedUrl("https://drive.google.com/file/d/1AbCdEfGhIjK/view?usp=sharing"), "https://drive.google.com/file/d/1AbCdEfGhIjK/preview");
});

test("any other link, or a host page without a video, is not embedded", () => {
  for (const url of [
    "https://example.com/demo-video/infra-diff",
    "https://my-team.dev/demo.mp4",
    "https://evil.example/youtube.com/watch?v=abcdef12345",
    "https://vimeo.com/channels/staffpicks",
    "https://www.loom.com/looms/videos",
    "https://drive.google.com/drive/folders/1AbCdEfGhIjK",
    "https://notyoutube.com/watch?v=abcdef12345",
    "http://vimeo.com/123456789",
    "not a link",
    "",
    null,
    undefined,
  ]) assert.equal(videoEmbedUrl(url), null, String(url));
});
