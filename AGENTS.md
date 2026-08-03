# Working rules for this repository

This file is persistent guidance for coding agents working on **hasalon-games**.
Read this file and the complete root `CLAUDE.md` before changing code. The latter
contains architectural details and hard-won debugging notes; this file records the
required working agreement and the newer mobile/Meme Machine lessons.

## Product priorities

- This is a family game used primarily on phones. Mobile behavior is a release
  requirement, not a desktop layout afterthought.
- Production is `main`, and real family users are not testers. Changes that affect
  gameplay, layout, media, voice, networking, PWA behavior, or controls must be
  exercised on Railway `dev` before they reach `main`.
- Preserve the site's visual vocabulary: hard offset shadows, no soft shadows, no
  arbitrary card tilt, logical CSS properties for RTL, and Rubik/`--font-display`
  for prominent text that can contain Hebrew.
- Never claim that an iPhone-specific behavior was verified on a real iPhone unless
  it actually was. Browser emulation is useful and required, but it is not a real
  device test.

## Required workflow for a change

1. Inspect the current branch, worktree, relevant code, tests, and these instruction
   files before editing. Existing uncommitted changes belong to the user; preserve
   unrelated work.
2. Unless the user explicitly says otherwise, make a new descriptive feature branch
   from the intended base. Do not develop directly on `main`.
3. Trace a behavior end to end before changing it: shared types/simulation, server,
   socket/store mirroring, React UI, CSS, assets, and tests. Let exhaustive unions and
   `tsc` identify wiring sites.
4. Make the smallest coherent change. Do not opportunistically rewrite unrelated
   systems, change game feel, or weaken an existing invariant.
5. Add focused regression tests for the failure mode, especially for secrecy,
   protocol behavior, scoring, deterministic simulation, static media/range support,
   and pure layout helpers.
6. During implementation run focused typechecks/tests. Before handoff or deployment,
   run from the repo root:

   ```text
   npm run typecheck
   npm test
   npm run build
   git diff --check
   ```

7. For visible work, run a real browser audit at the important mobile sizes and
   visually inspect screenshots. Check computed bounds, focus behavior, viewport
   scale, overflow, safe areas, touch-target sizes, both color schemes where
   relevant, Hebrew/RTL, landscape, and reduced motion. A green build is not visual
   verification.
8. For multiplayer work, use one browser plus a real WebSocket bot, or extend
   `scripts/smoke-ws.mjs`. Do not rely on two browser tabs; shared storage,
   backgrounded `requestAnimationFrame`, and held seats make that misleading.
9. Push the feature branch and point Railway `dev` at that exact branch. Confirm the
   deployed commit hash, instance state, and one-replica topology; then run smoke
   against the dev URL. If the feature needs physical devices, stop and report the
   remaining device checklist honestly unless the user performs it.
10. Only merge/push to `main` when the user has authorized production and the
    required local/dev checks pass. After pushing, verify Railway deployed the exact
    `git rev-parse HEAD`, then run production smoke. A successful push or healthy
    `/healthz` alone is not proof that the new build is live.
11. Leave Railway targeting the `production` environment when finished and report
    the branch, commit, checks, deployment hash, smoke result, and any unverified
    real-device behavior.

Do not push, deploy, merge, delete data, or make an external change merely because
you inspected or reviewed code. Those actions require the user's request. When the
user asks to implement and deploy, carry the workflow through rather than stopping
after editing.

## Mobile and iPhone rules

- Test at minimum a narrow portrait viewport and a short landscape viewport. Height
  is often the limiting dimension, so use the existing combined breakpoint pattern:
  `(max-width: 760px), (max-height: 560px)` where appropriate.
- Interactive controls need a real target of at least 44 by 44 CSS pixels. Do not
  fade a touch-only control behind a `:hover` rule.
- Inputs focused on iOS must use at least `16px` font size. Keep the viewport meta
  zoom-accessible: do not restore `maximum-scale=1` or `user-scalable=no`.
- Respect every `env(safe-area-inset-*)`; this app intentionally uses
  `viewport-fit=cover`. Top HUD elements must clear the notch/Dynamic Island and
  corner controls. Bottom actions must clear the home indicator.
- Keyboard-critical information, especially the Skribbl masked word, must remain
  visible while an input is focused. The current solution uses a fixed mobile word
  header plus `interactive-widget=resizes-content`; do not regress it to ordinary
  document-flow sticky behavior, which cannot counter iOS visual-viewport panning.
- Mobile overlays and option panels must fit short landscape screens. Their scrolling
  region and footer/actions must remain reachable, and hard shadows need enough
  outer room that they are not clipped by the panel bounds.
- Installed-iPhone reload belongs at the top of the Options panel. Preserve the
  viewport normalization around reload/navigation so returning to the lobby does not
  retain a zoomed visual viewport.
- The web manifest should retain stable identity/scope (`id`, `start_url`, `scope`),
  `orientation: "any"`, `handle_links: "preferred"`, and a navigate-existing launch
  handler. These are standards-based hints. Safari/iOS does not give a website a
  reliable way to force a normal Safari link to open an installed Home Screen web
  app, so do not promise that it can.
- Use native share when available, then clipboard, then the prompt fallback.
- For mobile changes, verify the behavior after the edit. At minimum record browser
  dimensions and computed assertions; add screenshots for anything visual. Explicitly
  distinguish emulation from a physical iPhone test.

## Architecture and protocol invariants

- The server is authoritative. Clients send intents and render snapshots; clients do
  not decide phase changes, winners, accepted captions/guesses, or scores.
- Keep the 60 Hz deterministic simulation pure. No wall-clock time or ambient
  randomness in game state. Use the game's seeded RNG and maintain deterministic
  replay tests.
- A public snapshot is encoded once and sent to everyone, so it can never contain a
  secret. Hidden words, private templates/drafts, votes, and unrevealed authorship
  belong in `privateFor`. Add whole-buffer end-to-end secrecy tests when touching
  hidden information.
- Mark snapshots droppable only when each snapshot is fully self-describing. Any
  drained delta stream such as Skribbl ink or Achtung trail must remain
  non-droppable and bypass throttled HUD mirroring.
- Reconnection must restore all private state needed to continue. A private payload
  is non-draining and should return `null` cheaply for spectators/no-private-state.
- Any incompatible wire or snapshot/config union change requires a protocol version
  bump and a handshake regression test. Older tabs must fail cleanly rather than
  half-participate.
- A new game must be wired through all exhaustive locations listed in `CLAUDE.md`:
  shared unions and registry, shared export subpath, Room settings, client registry,
  both i18n dictionaries, music, store/HUD, and socket mirroring.
- Rooms are in memory. Keep Railway at exactly one replica. Do not casually add a
  persistence layer or deploy multiple replicas.

## Voice invariants

- Listening must never require microphone permission. `prepare()` may establish the
  receive path but must not call `getUserMedia` or create an `AudioContext`.
- Peer shape is decided only from both players' broadcast `voice` and `listening`
  flags. Read our own flags from `room.players`, never from a local voice snapshot.
  Local state announces an intent; the mesh reacts to the server echo. This symmetry
  is what makes the single `selfId < peerId` offerer rule safe.
- `voice` implies `listening`; turning hearing off also turns the microphone off.
  Listener-listener pairs should not create silent connections.
- A receive-only connection needs an audio `recvonly` transceiver. Direction changes
  are handled by rebuilding the peer after the broadcast, not by local ad-hoc
  renegotiation.
- `stopMic()` keeps listening and remote level sampling alive. Full `stop()` is only
  for teardown/leaving. Do not announce voice state after membership is gone; that
  caused the immediate red `NOT_IN_ROOM` error.
- Retain Safari autoplay retries, paused-audio liveness recovery, MP3 audio, HTTP byte
  range support, and the iOS silent-switch note.

## Skribbl invariants

- The real word never appears in a broadcast snapshot. Only the masked word is
  public; the drawer receives the word through `privateFor`.
- Ink is a drained delta stream. It must not go through `mirrorHud` throttling or
  snapshot history, and undo remains clear plus full replay.
- Preserve Hebrew guess normalization, including final-letter folding, niqqud
  removal, and the established optional interior vav/yod behavior.
- On mobile the masked-word banner must stay locked at the visible top while the
  keyboard is open and must not overlap the safe area or corner controls.

## Meme Machine invariants

- Meme Machine supports 2-8 players. Do not restore a three-player minimum.
- Templates are local assets selected from the manifest. There must be no third-party
  API call during a match. The current library contains 120 still JPEG templates and
  80 current Imgflip animated templates stored as compact muted MP4 loops.
- Maintain `public/memes/ATTRIBUTION.md` for every asset and keep source curation
  scripts reproducible. Do not silently add an asset without a matching manifest and
  attribution row.
- Serve still images with `object-fit: contain`; do not crop memes. Animated templates
  use `<video autoplay loop muted playsinline>` and require `video/mp4`, byte-range
  responses, and graceful failure.
- Template text boxes are normalized, template-specific geometry. Keep captions
  movable and persist their adjusted positions through submission, reveal, and
  download. The composer preview, reveal, and exported file must use the same layout.
- Caption sanitation, usability checks, voting eligibility, vote replacement,
  authors' inability to vote for themselves, scoring, phase changes, and early exits
  are server rules. Invalid inputs silently return rather than throwing.
- During writing, public snapshots may not reveal any template id or caption. Before
  result, `authorSeat` stays hidden and the live vote split stays hidden. These are
  load-bearing security properties with unit and server integration tests.
- Hide the round/gameplay banner when the shared match-over overlay is active. The
  overlay must remain above game chrome.
- The result download action creates the meme locally and must include the uncropped
  template, captions, and adjusted text-box positions. Provide graceful feedback if
  browser download/export fails.
- Only preload templates used by the current match; do not eagerly download the full
  media library on a phone connection.

## Assets, UI, and accessibility

- Public media is referenced by root runtime paths and must degrade gracefully on a
  404. Avoid importing a large public library into the JS bundle.
- JPEG and MP4 are deliberate Safari-safe formats here. Do not introduce WebP, AVIF,
  Ogg, or a new codec without real-device verification and a fallback.
- Static video/audio serving must support HTTP `Range` requests and return `206` with
  the correct MIME type. Keep the static-server tests green and probe an actual
  deployed asset.
- Use the same component for a live preview and its final presentation wherever
  pixel-for-pixel consistency matters.
- Hebrew/English user-visible strings go in both i18n dictionaries. Dynamic caption
  content uses `dir="auto"`; room codes and numeric physical readouts get explicit
  direction where needed.
- Preserve keyboard operation, labels, visible focus, live-region restraint,
  radiogroup semantics where appropriate, and the global reduced-motion behavior.
- Every user-visible error should be actionable and legitimate. Do not expose errors
  generated by teardown races or harmless stale state.

## Railway verification details

- Dev URL: `https://hasalon-dev-dev.up.railway.app`
- Production URL: `https://hasalon-games-production.up.railway.app`
- `railway service source connect` may print `ServiceInstance not found` and still
  succeed. Ignore the prose and inspect `railway status --json`.
- Compare `.latestDeployment.meta.commitHash` with `git rev-parse HEAD` for both dev
  and production. `/healthz` is version-blind.
- Railway runtime state is `Online` or `Sleeping` (or a failure state), not
  `Success`. Check the deployment status and the running instance separately.
- A GitHub-to-Railway webhook can silently fail to start a build. Confirm a deployment
  exists; use `railway up` only when necessary and within the user's deployment
  authorization.
- Run `npm run smoke -- <url>` against each deployed environment. For media work,
  also issue a small Range request and verify `206`, `Content-Range`, and MIME type.
- Return the CLI context to the production environment after dev verification so a
  later command does not accidentally target dev.

## Definition of done

A change is done only when the requested behavior is implemented end to end, focused
regressions exist, static checks pass, relevant mobile/visual/multiplayer behavior is
actually exercised, deployment is verified by exact commit when requested, and any
remaining physical-device or external limitation is stated plainly. Passing tests is
necessary; it is not a substitute for checking that the user-visible change happened.
