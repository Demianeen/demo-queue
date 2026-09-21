# GPT-6 Astra theme assets

The theme reuses the supplied Astra Commons event artwork and the same native
launch galaxy already used in Outpost's Pet Drop, check-in display and countdown.
It preserves the galaxy's original five spiral paths, particle geometry, palette,
shaders and bloom. Interface controls remain Demo Queue's own components.

## Supplied event artwork

The source in the user-supplied Outpost archive is
`partner-codex/gpt-6-astra/GPT6-AstraCommons_Photo Wall_8'x10'ai.ai`.
Its SHA-256 is
`e9bcda55c3e6034ebd2a9285f3780de704cdcbcd8ada5d5c94d5f7a211e40cd6`.

- `public/astra/gpt6-astra-background.webp` preserves the full embedded galaxy-six
  composition, resized from 7688 × 4324 to 2560 × 1440. It is the existing Pet Drop
  web derivative, copied unchanged.
- `public/astra/gpt6-wordmark.svg` contains the original five white outline paths.
- `public/astra/astra-wordmark.svg` contains the original five Astra outline paths,
  as used by Pet Drop's share cards.
- `public/astra/astra-commons-wordmark.svg` contains the original twelve Astra
  Commons outline paths used by the Outpost check-in display.
- `public/astra/openai-sans-medium.woff2` is the existing OpenAI Sans Medium web
  font from Outpost's Field Tools asset bundle, copied unchanged.

The SVG wordmarks require no fonts. Their shapes and aspect ratios are unchanged.
Artwork uses contain sizing to retain the whole six on narrow and wide displays.

## Native launch scene

`lib/vendor/astra-launch.mjs` is an unchanged copy of the renderer preserved for
Pet Drop and Field Tools. The public client modules were retrieved from the
[GPT-6 Astra announcement](https://openai.com/index/gpt-6-astra/) on 15 September
2026. Their module bodies are preserved; the earlier extraction replaced
Turbopack registration with a small static module loader. This is published
browser JavaScript, not OpenAI's unpublished source project.

The bundle includes Three.js r180 and postprocessing. Retained notices are in
`public/astra/THIRD-PARTY-NOTICES.txt` and `public/astra/licenses/`. Three.js is
MIT-licensed; postprocessing retains its zlib-style notice. Those library
licenses do not grant rights to the separate OpenAI artwork, typeface, branding,
or custom launch code. No separate redistribution license for those materials
was supplied with this archive; they remain their respective owners' materials
and are not relicensed by this contribution.

`public/astra/launch-poster.webp` is the unchanged [official fallback
poster](https://images.ctfassets.net/kftzwdyauwt9/H9Mf4UPiWGb0N25sLJHUu/6d971b8e12cbab3db48c94617d703b5d/poster.webp),
1920 × 900. All runtime assets are served locally; no third-party script or
remote image is requested by the backdrop.

`components/AstraBackdrop.tsx` is the new React integration. It loads the engine
only for an animated, visible desktop backdrop. Reduced-motion preferences,
screens below 768 CSS pixels and static previews retain the event artwork without
loading the renderer. The animation starts with the fully formed six, with
article scrolling and shape morphing disabled. Hidden tabs and offscreen
backdrops stop requesting frames. Resize updates the viewport, DPR is capped at
1.5, and context loss or initialization errors retain the poster. Unmounting
releases animation resources and removes observers and listeners.

## SHA-256 integrity

| File | SHA-256 |
| --- | --- |
| `public/astra/gpt6-astra-background.webp` | `d7b28ec210b327e67c86281e5cd6fdd5c88a58c71cd5c71145127bb632091c00` |
| `public/astra/gpt6-wordmark.svg` | `cc8c460fc022d4f06d402cbbd314128fce7647b604cc32188ea71bb1cbb9bfde` |
| `public/astra/astra-wordmark.svg` | `efb60f2047031735dd62069cda2cdd26a63841497205cf8fa4c6b4279521e414` |
| `public/astra/astra-commons-wordmark.svg` | `02d5f94426a4c9754208af65a795bb587c339929b782fc1eff974b2f899e4a2c` |
| `public/astra/openai-sans-medium.woff2` | `a48e7c2730258400834a005e6addcb29b475fea25fca74c497ac05452ad4d6bc` |
| `public/astra/launch-poster.webp` | `34417bdc216e8450cc1accfef0f039668c701d210c83255fee17f14b703d7f4e` |
| `lib/vendor/astra-launch.mjs` | `bc9be6a6de074bf355acacecbc6f3dbe52e0262b9fca9e35a8543e64a527006a` |
