# Bob "Jelly Pop" Redesign — Design Spec

**Date:** 2026-07-21
**Surface:** Bob desktop app renderer (companion face + full chat window)
**Goal:** A fun, cool, modern look for a hackathon stage demo — makes people smile, photographs well, stays readable when projected.

## Summary

Restyle Bob into the **Jelly Pop** direction: a squishy candy-gradient companion
face, and a **Candy Light** main window (cream canvas with candy accents) so demo
text stays crisp on a projector. This is a **CSS-only** change — the existing DOM
in `realtime-desktop-app.ts` already has every element and class we need
(`.companion-face/-eye/-mouth/-halo`, `.app-shell`, `.sidebar`, `.message`,
`.composer`, `data-status` states). No markup or logic changes.

Scope is purely visual. No new components, no behavior changes, no dependencies.

## Palette (Jelly Pop)

| Token | Value | Use |
|-------|-------|-----|
| pink | `#ff5fa2` | primary accent, user-bubble gradient start |
| orange | `#ff9d5c` | gradient mid, accent |
| yellow | `#ffd76f` | gradient end |
| ink | `#3a2140` | face features (eyes/mouth), dark text |
| canvas | `#fffdfb` / `#fff6fb` | chat + app background (Candy Light) |
| sidebar | `#ffe9f3` | sidebar surface |
| bot-bubble | bg `#ffe0ee`, text `#8a2b5e` | assistant messages |
| user-bubble | gradient pink→orange, text `#fff` | user messages |
| composer | `#fff`, border `#ffd0e4` | input area |
| status-good | `#3ad07a` | ready/listening/speaking dot |
| status-busy | `#f1a545` | connecting/thinking dot |
| status-error | `#ff6b6b` | error dot |

Gradient (used on companion + accents): `linear-gradient(135deg,#ff5fa2,#ff9d5c 55%,#ffd76f)`.

## Surface 1 — Companion face (full candy)

The 118px floating face becomes a glossy **jelly blob**.

- **Halo** (`.companion-halo`): full candy gradient background instead of dark;
  soft drop shadow; hover scales up slightly (keep existing hover transform).
- **Face** (`.companion-face`): white→pink blob, organic border-radius
  `50% 50% 48% 52% / 54% 54% 46% 46%`, glossy inner shadow
  (`inset 0 -8px 16px rgba(255,120,170,.35)`) + soft outer shadow. A gloss
  highlight via `::before` pseudo-element (no markup change).
- **Eyes** (`.companion-eye`): rounded ink ovals with a tiny white catchlight
  (`::after`).
- **Mouth** (`.companion-mouth`): ink smile.
- **State pill** (`.companion-state`): white translucent chip on the candy halo.

### State animations (keyed on existing `data-status`)

| status | motion |
|--------|--------|
| sleeping | eyes become closed lines; mouth relaxes; no bounce |
| ready/idle | gentle `jelly` squash-stretch loop (scale 1↔1.06/0.94) |
| listening | expanding ring pulse (box-shadow ring) |
| connecting / thinking | eyes flatten and dart side-to-side |
| speaking | mouth open/close talk loop |
| error | face tints red, mouth flips to a frown |

All animations disabled under `@media (prefers-reduced-motion: reduce)` (keep
existing rule).

## Surface 2 — Main window (Candy Light)

Light, readable, candy-accented. Restyle in place:

- **App shell** (`.app-shell`): cream canvas `#fffdfb`, soft rounded border, a
  faint candy radial glow in one corner. Drop the dark charcoal background.
- **Sidebar** (`.sidebar`): `#ffe9f3` surface, ink-on-pink text. Active session
  and "New" button use the candy gradient with white text; inactive rows are
  white pills.
- **Brand mark** (`.brand-mark`): candy gradient tile.
- **Topbar** (`.topbar`): light, ink title, candy status dot. Window controls +
  voice/companion buttons restyled to light candy.
- **Messages** (`.message`): assistant bubbles `#ffe0ee`/`#8a2b5e` with a
  tail radius; user bubbles candy gradient + white text, right-aligned.
- **Empty-state orb** (`.orb`): mini candy jelly face echoing the companion.
- **Composer** (`.composer`): white card, `#ffd0e4` border, candy focus ring;
  round candy-gradient send button.
- **Notices** (`.notice`): light candy variants for error/success.

Typography stays Inter (already loaded). `index.html` `color-scheme` meta becomes
`light` (window is light now; companion stays transparent regardless).

## Out of scope / non-goals

- No changes to `realtime-desktop-app.ts` logic, IPC, agent, or MotionKey code.
- No new fonts or dependencies.
- No layout/structure changes — same grid, same components, only skin.
- "Full Candy" gradient-everywhere variant is rejected (readability).

## Testing / verification

Visual, since it's pure CSS:

1. `npm run dev`, confirm the app renders in both window modes.
2. Companion mode: click through/observe each `data-status` state (can force via
   devtools by setting `data-status` on `.companion`) — verify each animation.
3. Full mode: check sidebar, an empty conversation (orb), a conversation with
   user + assistant messages, composer focus ring, and a notice.
4. Confirm text contrast is legible at projector scale (zoom out to ~60%).
5. `prefers-reduced-motion` disables animations.

No unit tests (no logic touched). `npm run typecheck` must still pass (unchanged).

## Risk / rollback

Single-file change (`styles.css`) plus a one-line `index.html` meta and possibly
a couple of pseudo-element additions. Rollback = revert the CSS. Low risk.
