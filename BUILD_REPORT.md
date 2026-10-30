# BUILD REPORT — StreamGuardian AI

Final report for the StreamGuardian AI MVP (Codex × TwitchCon Hackathon), built from the user's 15-section spec as the product authority, following the website-building instructions PDF for build quality and honesty (9-phase workflow, original design, no fake controls, WCAG 2.2 AA + reduced motion, verify before claiming). All results below were observed on 29 October 2026. Nothing in this report is claimed beyond what was actually run.

## 1. What was built

A full-stack moderation co-pilot MVP in `~/workspace/codex`, left on disk only — **not pushed, not deployed**:

- **App shell**: left sidebar (Dashboard, Live Chat, AI Moderation, Community Insights, Important Questions, Incident Timeline, Settings), header (connection status, channel, alert bell with count, moderator profile menu), footer with the current mode.
- **Real pipeline**: incoming event → Zod validation → normalisation → sentiment/question analysis → deterministic (+ optional OpenAI) moderation analysis → SQLite storage → question grouping → incident creation → Socket.IO broadcast.
- **Demo Mode simulator** with start/pause/reset/speed/scenario controls and seeded data.
- **Moderation review queue** with confirmation dialogs and a decision audit trail.
- **Incident timeline** with type/severity filters and a detail view.
- **Insights**: activity + sentiment charts, deterministic copilot summaries, suggested replies requiring approval.
- **Real Twitch OAuth + EventSub code** (authorization-code flow, state validation, server-side tokens, `channel.chat.message` subscription, reconnection).
- **Docs**: this report, `README.md` (spec §13 contents), `.env.example` (placeholders only), `.gitignore`.

## 2. Stack and versions

| Layer | Choice | Version observed |
| --- | --- | --- |
| Runtime | Node.js | v24.22.1 (npm 10.9.4) |
| Client | React + Vite + TypeScript | React 19, Vite 6.4.5, TS 5.7.2 |
| Client styling | Tailwind CSS via @tailwindcss/vite | Tailwind v4 |
| Client charts | Recharts (lazy-loaded chunk) | 2.15.x |
| Client icons / realtime / validation | lucide-react, socket.io-client, zod | 0.469, 4.8.1, 3.24.1 |
| Server | Express + TypeScript + Socket.IO | Express 4.21.2, Socket.IO 4.8.1 |
| Server storage | **Node built-in `node:sqlite`** (see §13) | — |
| Server validation/rate-limit | zod, express-rate-limit | 3.24.1, 8.x |
| Tests | Vitest (server + client) | 2.1.9 |
| Shared | `shared/src/types.ts`, imported by both sides | — |

No other runtime dependencies were installed. No code, branding, or design was copied from any source; all code is original.

## 3. Research and resource decisions

Per the standing "check all seven links, pick what fits" rule, the seven animated-website resources were considered in the Research phase and **none was installed or used** — this is a data-dense safety dashboard, and the fitting choices were restraint, hierarchy, and speed:

| Resource | Decision | Reason |
| --- | --- | --- |
| Framer | Not used | Hosted site builder; does not fit a self-hosted full-stack app. |
| Webflow | Not used | Hosted builder/CMS; same reason. |
| Rive | Not used | Interactive vector animation; no animated mascot/UI element is needed. |
| LottieFiles | Not used | No Lottie animation is needed; CSS transitions cover the micro-interactions. |
| Spline | Not used | 3D scenes would hurt load time and add nothing to a moderation tool. |
| GSAP | Not used | No complex timelines; CSS transitions + Recharts' built-in animation suffice. |
| Motion (free library) | Not used | Same reason as GSAP; restrained CSS motion was chosen instead. |
| Motion+ (paid) | Not used, not accessed | Paid membership; no access held; nothing copied. |

Design references used as inspiration only (never copied): Dribbble patterns — dark AI/SaaS interface, dashboard hierarchy, bento grids. Tilda style vocabulary — Bento + Minimalism. Figma 2026 trends used — dark mode, restrained motion design, sustainable/accessible design. Patterns deliberately **not** used: 3D/immersive, experimental navigation, maximalism, collage, neumorphism, neo-brutalism, gamified design — none fits a trust-critical moderation tool.

## 4. Architecture

Monorepo: `client/` (Vite dev proxy for `/api` and `/socket.io` → server on port 4000), `server/` (Express + Socket.IO), `shared/` (types). The pipeline is the single path for demo and live events: `simulator.ts` / Twitch EventSub → `pipeline.ts` → `analysis.ts` + `sentiment.ts` + `questions.ts` → `store.ts` (SQLite) → Socket.IO broadcast + incident creation. The OpenAI client (`services/ai/openai.ts`) is called only when a key is configured, server-side, with an 8s timeout and Zod-validated JSON; failures fall back to the deterministic engine and are labelled as such. The Twitch module owns OAuth state, token exchange/refresh, Helix calls, and the EventSub WebSocket client. Full diagram in `README.md`.

## 5. Design choices

- **One distinctive style**: premium dark — deep navy/near-black `#070b16` base, glass panels (translucent white gradient + fine border + blur), neon violet `#8b5cf6` primary with electric blue `#38bdf8` accents, bento-grid dashboard cards, Swiss-style grid discipline.
- **Typography**: system font stack (no web-font download, no FOUT, fastest load). Headings bold/tight; body copy at AA contrast or better (see §10).
- **Mode honesty is the core visual rule**: Demo Mode is an amber banner on the dashboard, an amber pill in the header, "simulated" badges on every demo message, and "Demo Mode" in the footer — on every view. Live Mode switches all of these to emerald. Connection state (Twitch + socket) is shown in the header and Settings from the real server status payload.
- **No fake controls**: every button calls a real endpoint or changes real view state. Demo controls, decisions, question actions, suggestion approvals, Twitch connect/disconnect, and the theme of each badge all reflect server state. Loading, empty, error, and reconnecting states are implemented for every data view.
- **Chat text is untrusted**: rendered as plain text only (React escapes it), stored verbatim, sent to OpenAI only as JSON data.

## 6. Effects and motion

Restrained on purpose. CSS transitions on buttons/nav; a single pulsing dot on the Live indicator (never the sole carrier of meaning); Recharts animations on the two charts. All animation is disabled under `prefers-reduced-motion` via a global CSS kill-switch **and** `isAnimationActive={!reducedMotion}` on every chart series, driven by a live `matchMedia` hook. No scroll-jacking, no parallax, no 3D, no autoplay beyond the simulator the user starts.

## 7. Features and how each works

All seven views are wired to real endpoints (verified in the smoke run, §12):

1. **Dashboard** — counts from `/api/insights/summary`, activity/sentiment charts, copilot summary, recent incidents, compact live chat, demo controls.
2. **Live Chat** — stored history (`/api/messages`) merged with live socket messages, deduped; filters All / Flagged / Questions / Negative; auto-scroll that respects manual scroll-up.
3. **AI Moderation** — pending alerts from `/api/alerts` + live `moderation:alert` events; decision endpoint `POST /api/moderation/:messageId/decision` with confirmation dialog; audit trail from `/api/decisions`.
4. **Community Insights** — charts from `/api/insights/activity` + `/api/insights/sentiment`; copilot summary + suggestions from `/api/copilot/*`; approve/dismiss endpoints.
5. **Important Questions** — groups from `/api/questions`; mark-answered and suggest-reply actions (both moderator-gated).
6. **Incident Timeline** — `/api/incidents` with type filter + client-side high/critical filter; detail view from `/api/incidents/:id` with the linked message/analysis.
7. **Settings** — real connection/AI/simulator state from `/api/status`; Twitch connect link (honest 503 without credentials) and disconnect; demo controls; security notes. The OAuth callback (`/settings?twitch=connected|error`) is read on load, shown as a notice, and cleaned from the URL.

## 8. Twitch integration state

Real code, honestly untested live: OAuth authorize URL with one-time state (10-minute TTL, cookie + server copy), server-side code exchange, token refresh handling, Helix user lookup, EventSub WebSocket subscription to `channel.chat.message` with session handling, reconnection, and revocation handling. **Only one scope is requested: `user:read:chat`.** No live Twitch connection was exercised — no credentials were available, and none were invented. `/api/auth/twitch` returns HTTP 503 with a clear message when credentials are missing (verified). Connection status reflects the server's real state at all times.

## 9. Security

- Startup env validation with Zod; fail-fast with a clear message on bad config; partial Twitch config logs a warning and stays in Demo Mode; `SESSION_SECRET` required in production, ephemeral dev secret with a warning otherwise.
- Rate limits: global 300/min; 60/min on demo/moderation/copilot endpoints; 10/min on demo login.
- Privileged endpoints (demo controls, decisions, question answers, suggestion approval, Twitch disconnect) require the demo moderator session; unauthenticated requests get 401 (verified).
- Demo-only auth is documented as demo-only in the UI, README, and Settings; it must be replaced with a real identity provider before production use.
- No secrets in the repo: `.env.example` holds placeholders only; a scan of the tree found no keys/tokens. No token is logged. Chat text is never interpolated into prompts or executed.
- Graceful shutdown on SIGINT/SIGTERM; Socket.IO payloads are Zod-validated client-side and dropped if malformed (never rendered).

## 10. Accessibility (WCAG 2.2 AA practices applied)

Applied and statically checked; **no screen-reader or live-browser audit was possible in this environment** (see §13):

- Skip-to-content link, `<main>` landmark, labelled `<nav>`, single `<h1>` per view with heading hierarchy (h2 cards, h3 sub-sections).
- Visible `:focus-visible` outlines everywhere; keyboard-operable dialogs (Escape closes, initial focus on Cancel), filter groups (`aria-pressed`), nav (`aria-current="page"`), disclosures (`aria-expanded`).
- `aria-live="polite"` announcements for high/critical alerts; `role="alert"`/`role="status"` for errors/notices; `role="log"` on the chat feed; charts carry `role="img"` + labels.
- Contrast: body text slate-200/300/400 on `#070b16` (≈7:1 or better); badges use light text on translucent tinted backgrounds with rings; primary buttons white on violet-600 (≈5.7:1).
- Reduced motion: §6. Form controls are labelled (including the speed `fieldset`/`legend`); icon-only button (notifications) has an `aria-label` with the live count.
- Responsive: sidebar becomes a horizontal scroll nav under `lg`; chat panel becomes the Live Chat view on small screens; no horizontal overflow by design (not browser-verified — §13).

## 11. Performance

- Production client build: main chunk **382.69 kB (gzip 111.39 kB)**, CSS 22.75 kB (gzip 6.41 kB), charts lazy chunk **407.34 kB (gzip 110.84 kB)** loaded only when Dashboard/Insights mount. System font stack (no font downloads). No images shipped. No heavy unused dependencies: every installed package is imported and used.
- Server: single-process Express + SQLite; activity/sentiment buckets are computed from indexed queries over the requested window only.
- Not measured: Core Web Vitals (no live browser in this environment), so no LCP/INP/CLS numbers are claimed.

## 12. Verification results (exact, observed)

Run on Node v24.22.1, 29 Oct 2026, from `~/workspace/codex`:

```bash
npm test
# server: Test Files 6 passed (6) / Tests 60 passed (60)
# client: Test Files 1 passed (1) / Tests 7 passed (7)

npm run build
# server: tsc -p tsconfig.json — clean (no errors)
# client: tsc -b && vite build — clean; chunks as in §11

npx tsc -p tsconfig.json --noEmit   # client — clean
```

**Bug found and fixed during verification:** the server `start` script pointed at `dist/src/index.js` but `tsc` (with `rootDir: ..`) emits `dist/server/src/index.js`, so `npm start` would have failed. Fixed the script to `node dist/server/src/index.js` and re-verified by starting the built server.

**End-to-end smoke run** (built server on :4000 with a throwaway DB in /tmp, client preview on :4173; both stopped afterwards):

- `GET /api/health` → `{"ok":true,...}`; `GET /api/status` → mode `demo`, Twitch `disconnected`, AI `deterministic` with the fallback note, simulator stopped.
- Unauthenticated decision → **401**. Demo login → session cookie; `/api/auth/me` returns the session.
- `POST /api/demo/start` → simulator running; Socket.IO client received **10 `chat:message` events and 3 `moderation:alert` events in 14s** (spam, harassment, suspicious-link flags with reasons).
- `GET /api/messages`, `/api/alerts`, `/api/insights/summary` (44 messages, 15 flagged, 15 open alerts, 7 open question groups), `/api/insights/activity`, `/api/copilot/summary` (headline + 4 bullets), `/api/questions` — all returned real stored data.
- Approve decision on a flagged message → **201**, `submittedToTwitch: false` with "Not submitted: Demo Mode has no live Twitch connection", decision in `/api/decisions`, `approved_action` incident in `/api/incidents`.
- Suggest-reply → **201**, `sendable: false`. Twitch connect without credentials → **503** with a clear message.
- Client preview served `index.html` (200) and proxied `/api/health` correctly; the JS asset returned 200.

**Not verified:** live Twitch OAuth/EventSub against Twitch (no credentials); any browser rendering, phone widths, or console errors (no live browser available to this builder); screen-reader behaviour; Core Web Vitals. None of these are claimed.

## 13. Known limits and incomplete work

- **Prisma was not used.** The spec allowed a fallback if the Prisma engine download was blocked; the build used Node's built-in `node:sqlite` from the start (no engine download needed, works offline). Schema lives in `server/src/db/store.ts`; there is no Prisma schema or migration tooling.
- **Demo-only auth** (§9) — must be replaced before production.
- **No Twitch write actions** — approvals/suggestions are recorded, never submitted or sent (§7–§8).
- **Summaries are deterministic templates**, even with an OpenAI key; the key only affects per-message classification.
- **Single-scope Twitch integration** — chat read only; no moderator actions, no chat sending.
- **No deployment.** Nothing was pushed to GitHub and nothing is hosted; deployment steps are documented in `README.md` but unexecuted.
- **No live-browser verification** of layout, console errors, phone widths, or the Dark/… visual states (this environment has no live browser for this builder). The client was verified by typecheck, tests, production build, and API/socket smoke tests only.
- **Simulator realism limits**: scripted lines repeat by design, which the coordination rule flags — correct behaviour per the spec's repetition rule, but demo data looks repetitive over long runs.
- **SQLite single-file storage**: fine for the demo; a production deployment would need PostgreSQL and a real session store.

## 14. How to run and delivery status

```bash
cd ~/workspace/codex
npm install
npm run dev     # server :4000 + client :5173 (Demo Mode, no credentials needed)
npm test        # 60 server + 7 client tests
npm run build   # server tsc + client production build
npm start       # built server only (serve client/dist/ separately)
```

**Delivery status: complete on disk, not shipped.** The code is in `~/workspace/codex` (see file list in `README.md`), with `README.md`, `.env.example`, `.gitignore`, and this report. **Not pushed to GitHub** (per the build brief, the parent pushes via the connected GitHub route) and **not deployed** (no deployment is claimed). The next steps for the parent: verify `npm test` + `npm run build` once more if desired, then push through the GitHub connector snapshot route to `habeebc84-create/codex`, and optionally run a live-browser check of the client (layout, console, phone width) which this build could not perform.

## 15. Addendum — fresh-clone build failure found and fixed (30 October 2026)

**What was wrong.** The first pushed commit did not build from a fresh clone, even though the README said `npm install` installs everything. The root `package.json` had no `workspaces` config and no install hook, so a plain `npm install` installed only the root `concurrently` package. `npm run build` then failed immediately with `sh: 1: tsc: not found`, because the server and client dependencies were never installed. This was reproduced from a clean clone of the GitHub repo on 30 October 2026, and it is the same failure that errored the Vercel deployment of commit `32c19722` (project "server", Express preset). The Vercel build log itself could not be read — the Vercel connection has no access to the `habeebc84-creates-projects` team scope (HTTP 403) — so the Vercel-side error is inferred from the identical local failure, not from the log.

**The fix (no re-architecture).** A root `prepare` script now runs `npm install` in `server/` and `client/` automatically whenever the root dependencies are installed, so one `npm install` at the root is enough, for local clones, CI, and build hosts alike. A GitHub Actions workflow (`.github/workflows/ci.yml`, Node 22) now runs `npm install`, `npm test`, and `npm run build` on every push to `main` and every pull request, so a broken build shows up on GitHub itself instead of only on a deploy host. The README deployment step was corrected (it previously said `npm install --omit=dev`, which would have skipped the build tools) and a CI badge was added.

**Re-verified after the fix** (clean copy, 30 October 2026): `npm install` → `npm test` (60 server + 7 client tests pass) → `npm run build` (clean). The Vercel project itself was not changed: as built, this app still needs a persistent Node host for its Socket.IO server and SQLite database, and Vercel's short-lived functions cannot run it unchanged. Fixing the repo build does not by itself make the Vercel deployment work.
