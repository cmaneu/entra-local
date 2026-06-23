---
version: alpha
name: Entra Local
description: >-
  Visual identity for Entra Local — a local, MSAL-compatible emulator of
  Microsoft Entra ID for application developers. A deliberately Fluent-mimic
  developer tool that resembles the real Entra/Azure experience while signalling,
  unmistakably, that it is a local sandbox via a persistent amber LOCAL EMULATOR
  badge. Owned by the designer agent (Murdock).
colors:
  # Primary — Azure / Fluent communication blue ramp.
  # primary == primary-60 (base, required role). Extended ramp steps
  # primary-70 #2B88D8 (light hover) are documented in the Colors prose.
  primary: "#0078D4"
  primary-30: "#004578"
  primary-40: "#005A9E"
  primary-50: "#106EBE"
  primary-60: "#0078D4"
  primary-90: "#DEECF9"
  # Accent — Fluent teal. accent-40 #015A5D (teal text), accent-60 #038387 (base).
  # Extended steps accent-70 #2AA0A4 (hover) / accent-90 #E0F2F2 (tint) are in prose.
  accent-40: "#015A5D"
  accent-60: "#038387"
  # Caution — amber (LOCAL EMULATOR badge + production-warning banners).
  # caution-70 #B45309 (alt amber text) documented in prose.
  caution-50: "#F59E0B"
  caution-80: "#92400E"
  caution-90: "#FEF3C7"
  # Success — Fluent green
  success-60: "#107C10"
  success-90: "#DFF6DD"
  # Error / Danger — Fluent red
  error-60: "#D13438"
  error-80: "#A4262C"
  error-90: "#FDE7E9"
  # Neutral — Fluent gray ramp.
  neutral-10: "#201F1E"
  neutral-20: "#323130"
  neutral-40: "#605E5C"
  neutral-60: "#8A8886"
  neutral-70: "#C8C6C4"
  neutral-80: "#E1DFDD"
  neutral-85: "#EDEBE9"
  neutral-95: "#FAF9F8"
  neutral-100: "#FFFFFF"
  # Surface roles
  surface: "#FFFFFF"
  surface-alt: "#FAF9F8"
  on-surface: "#201F1E"
typography:
  display:
    fontFamily: "Segoe UI"
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  headline-lg:
    fontFamily: "Segoe UI"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.005em"
  headline-md:
    fontFamily: "Segoe UI"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.3
  headline-sm:
    fontFamily: "Segoe UI"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.4
  body-lg:
    fontFamily: "Segoe UI"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
  body-md:
    fontFamily: "Segoe UI"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "Segoe UI"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
  label-md:
    fontFamily: "Segoe UI"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.4
  label-sm:
    fontFamily: "Segoe UI"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.3
  label-caps:
    fontFamily: "Segoe UI"
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.06em"
  code-md:
    fontFamily: "Cascadia Mono"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  code-sm:
    fontFamily: "Cascadia Mono"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
rounded:
  none: 0px
  sm: 2px
  md: 4px
  lg: 8px
  xl: 12px
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
  gutter: 24px
  margin: 24px
  card: 24px
  container: 1280px
shadows:
  depth-2: "0 0.6px 1.8px rgba(0,0,0,0.10), 0 0.15px 0.45px rgba(0,0,0,0.07)"
  depth-4: "0 0.9px 2.7px rgba(0,0,0,0.11), 0 0.5px 1.6px rgba(0,0,0,0.09)"
  depth-8: "0 1.6px 3.6px rgba(0,0,0,0.13), 0 0.3px 0.9px rgba(0,0,0,0.11)"
  depth-16: "0 3.2px 7.2px rgba(0,0,0,0.13), 0 0.6px 1.8px rgba(0,0,0,0.11)"
  depth-64: "0 12.8px 28.8px rgba(0,0,0,0.22), 0 2.4px 7.2px rgba(0,0,0,0.18)"
components:
  button-primary:
    backgroundColor: "{colors.primary-60}"
    textColor: "{colors.neutral-100}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    padding: 8px 20px
    height: 32px
  button-primary-hover:
    backgroundColor: "{colors.primary-50}"
    textColor: "{colors.neutral-100}"
  button-primary-active:
    backgroundColor: "{colors.primary-40}"
    textColor: "{colors.neutral-100}"
  button-primary-disabled:
    backgroundColor: "{colors.neutral-85}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.neutral-20}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    padding: 8px 20px
    height: 32px
  button-secondary-hover:
    backgroundColor: "{colors.neutral-95}"
    textColor: "{colors.neutral-10}"
  button-secondary-active:
    backgroundColor: "{colors.neutral-85}"
    textColor: "{colors.neutral-10}"
  link:
    textColor: "{colors.primary-50}"
    typography: "{typography.body-md}"
  link-accent:
    textColor: "{colors.accent-40}"
    typography: "{typography.body-md}"
  button-destructive:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.error-60}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    padding: 8px 20px
    height: 32px
  text-disabled:
    textColor: "{colors.neutral-60}"
    typography: "{typography.body-md}"
  badge-emulator:
    backgroundColor: "{colors.caution-50}"
    textColor: "{colors.neutral-10}"
    typography: "{typography.label-caps}"
    rounded: "{rounded.md}"
    padding: 3px 8px
  banner-caution:
    backgroundColor: "{colors.caution-90}"
    textColor: "{colors.caution-80}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 12px 16px
  banner-error:
    backgroundColor: "{colors.error-90}"
    textColor: "{colors.error-80}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 12px 16px
  banner-success:
    backgroundColor: "{colors.success-90}"
    textColor: "{colors.success-60}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 12px 16px
  identifier-chip:
    backgroundColor: "{colors.neutral-95}"
    textColor: "{colors.neutral-20}"
    typography: "{typography.code-sm}"
    rounded: "{rounded.md}"
    padding: 2px 8px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: "{spacing.card}"
  signin-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    padding: 44px
    width: 440px
  canvas:
    backgroundColor: "{colors.surface-alt}"
    textColor: "{colors.on-surface}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.neutral-10}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 6px 8px
    height: 32px
  input-focus:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.neutral-10}"
  input-error:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.neutral-10}"
  input-disabled:
    backgroundColor: "{colors.neutral-95}"
  field-error-text:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.error-80}"
    typography: "{typography.body-sm}"
  topbar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.neutral-10}"
    height: 48px
    padding: 0 16px
  sidenav:
    backgroundColor: "{colors.surface-alt}"
    textColor: "{colors.neutral-20}"
    width: 240px
    padding: 8px
  sidenav-item-active:
    backgroundColor: "{colors.primary-90}"
    textColor: "{colors.primary-30}"
    typography: "{typography.label-md}"
  table-header:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.neutral-40}"
    typography: "{typography.label-sm}"
  table-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.neutral-10}"
    typography: "{typography.body-md}"
  table-row-hover:
    backgroundColor: "{colors.neutral-95}"
    textColor: "{colors.neutral-10}"
  table-row-selected:
    backgroundColor: "{colors.primary-90}"
    textColor: "{colors.primary-30}"
  divider:
    backgroundColor: "{colors.neutral-85}"
    height: 1px
  border-default:
    backgroundColor: "{colors.neutral-80}"
    height: 1px
  border-strong:
    backgroundColor: "{colors.neutral-70}"
    height: 1px
  toast:
    backgroundColor: "{colors.neutral-10}"
    textColor: "{colors.neutral-100}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 12px 16px
  status-dot-local:
    backgroundColor: "{colors.accent-60}"
    textColor: "{colors.neutral-100}"
  # Portal extensions (feature #12) — appended; reuse existing roles only.
  drawer:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.none}"
    width: 440px
    padding: "{spacing.card}"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    width: 440px
    padding: "{spacing.card}"
  dialog-scrim:
    backgroundColor: "{colors.neutral-10}"
  stat-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.display}"
    rounded: "{rounded.md}"
    padding: 16px 20px
  code-block:
    backgroundColor: "{colors.neutral-10}"
    textColor: "{colors.neutral-100}"
    typography: "{typography.code-md}"
    rounded: "{rounded.md}"
    padding: 16px 18px
  tab:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.neutral-40}"
    typography: "{typography.label-md}"
  tab-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary-30}"
    typography: "{typography.label-md}"
  pagination:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.neutral-40}"
    typography: "{typography.body-sm}"
  toggle-on:
    backgroundColor: "{colors.primary-60}"
    textColor: "{colors.neutral-100}"
  toggle-off:
    backgroundColor: "{colors.neutral-60}"
    textColor: "{colors.neutral-100}"
---

# Entra Local — Visual Identity

> **Status: defined.** Established 2026-06-22 by the designer (Murdock).
> This file is the canonical visual contract for Entra Local and follows
> Google's [DESIGN.md spec](https://github.com/google-labs-code/design.md).
> It is read by `planner` and `coder` before any UI work; **only the designer
> writes to it.** Validate edits with `npx @google/design.md lint DESIGN.md`.
>
> Canonical sections appear first, in spec order (Overview, Colors, Typography,
> Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts). Non-canonical
> prose sections (Voice, Motion, Positioning, References, Open questions) extend
> the spec to capture brand direction the standard format does not cover.

## Overview

**Aesthetic direction: Fluent-mimic.** Entra Local deliberately resembles the
real Microsoft Entra / Azure experience so that a developer's muscle memory
carries over: white surfaces, restrained Fluent depth, ~4px corners, a
Segoe-style type voice, Azure communication-blue actions. The interactive
sign-in page mimics `login.microsoftonline.com` — a centered white card on a
soft neutral background, the calling app's logo, an **account picker**, and a
"Use another account" affordance. The admin portal mimics the Azure portal
shell — a slim white top bar, a quiet side nav, dense data tables, and
copy-everywhere identifiers.

The product must **never impersonate Microsoft**. We use no Microsoft logos or
trademarks; the wordmark is our own ("Entra Local"). The one unmistakable signal
that this is *not* production is a persistent **amber "LOCAL EMULATOR" badge**
(the caution color), shown in the portal top bar and on the sign-in card,
paired with a quiet "Not for production use" note. Distinction is carried by
that badge and by caution signalling — not by inventing a separate visual
language.

Personality: **precise, trustworthy, technical, local/sandboxed, familiar.**
The UI should feel instant and dense rather than spacious and marketed — this is
a tool for app, API, QA, and CI developers, not a landing page. Favor clarity,
copyable values, and honest labelling over polish for its own sake.

## Colors

Five roles, each a small ramp. Azure blue drives action, teal accents and
"local/connected" signalling, amber carries the emulator caution, plus the two
Fluent semantics (success/error) and a full neutral gray ramp. All text/surface
pairings below meet **WCAG AA** (≥4.5:1 for normal text); the AA-safe pairing is
named explicitly for each role.

### Primary — Azure Blue (`#0078D4`)
Fluent communication blue. Primary buttons, links, active nav, focus accents,
selected states. RGB `0,120,212`.
- **Ramp:** `primary-30 #004578` · `primary-40 #005A9E` · `primary-50 #106EBE` ·
  `primary-60 #0078D4` (base) · `primary-70 #2B88D8` · `primary-90 #DEECF9` (tint).
- **AA-safe pairings:**
  - White (`#FFFFFF`) on `primary-60 #0078D4` → **4.53:1** — primary button fill.
    This is tight; reserve it for ≥14px semibold / ≥18px text and large hit areas.
  - White on `primary-50 #106EBE` → 5.26:1 (hover) and on `primary-40 #005A9E` →
    7.10:1 (pressed).
  - **Links / blue text on white** use `primary-50 #106EBE` (5.26:1), *not* the
    `#0078D4` base — base blue text on white is only 4.53:1 and reads thin at
    body sizes.
  - `primary-30 #004578` on the `primary-90 #DEECF9` tint → 8.23:1 (text on a
    selected/active nav pill).

### Accent — Fluent Teal (`#038387`)
Secondary highlights, hovers on neutral chrome, status/chart accents, and the
"connected / local" status dot. RGB `3,131,135`.
- **Ramp:** `accent-40 #015A5D` · `accent-60 #038387` (base) · `accent-70 #2AA0A4` ·
  `accent-90 #E0F2F2` (tint).
- **AA-safe pairings:**
  - White on `accent-60 #038387` → 4.56:1 (status dot, accent fill).
  - **Teal text on white** uses `accent-40 #015A5D` → 8.01:1 (base teal text on
    white is 4.56:1 — fine for large text, but `accent-40` is the safe default
    for small text and links).

### Caution — Amber (`#F59E0B`)
The **LOCAL EMULATOR** badge and all "not for production" warnings. This is the
signature signal that the product is a sandbox. RGB `245,158,11`.
- **Ramp:** `caution-50 #F59E0B` (badge fill) · `caution-70 #B45309` ·
  `caution-80 #92400E` · `caution-90 #FEF3C7` (banner tint).
- **AA-safe pairings:**
  - **Badge:** dark ink `neutral-10 #201F1E` on `caution-50 #F59E0B` → **7.66:1**.
    Never put white on amber (2.15:1 — fails). The badge always uses dark ink.
  - **Warning banner:** `caution-80 #92400E` text on the `caution-90 #FEF3C7`
    tint → 6.37:1, with a `caution-50` left border / icon.

### Success — Fluent Green (`#107C10`)
Positive confirmation (saved, healthy, seeded). RGB `16,124,16`.
- **Ramp:** `success-60 #107C10` (base) · `success-90 #DFF6DD` (tint).
- **AA-safe pairings:** white on `success-60` → 5.37:1; `success-60` text on the
  `success-90` tint → 4.69:1 (success banner / health "OK").

### Error / Danger — Fluent Red (`#D13438`)
Validation errors, destructive actions, unhealthy status. RGB `209,52,56`.
- **Ramp:** `error-60 #D13438` (base) · `error-80 #A4262C` · `error-90 #FDE7E9` (tint).
- **AA-safe pairings:** white on `error-60` → 4.93:1 (destructive button);
  `error-60` text on white → 4.93:1; inline field-error text uses
  `error-80 #A4262C` on white (6.97:1) / on the `error-90` tint → 6.15:1.

### Neutral — Fluent Grays
Ink, secondary text, muted metadata, borders, dividers, and surfaces.
- **Ink** `neutral-10 #201F1E` — primary text; 16.46:1 on white, 15.65:1 on `surface-alt`.
- **Secondary** `neutral-20 #323130` — headings/strong labels; 12.98:1 on white.
- **Muted** `neutral-40 #605E5C` — metadata, table header labels, captions;
  6.46:1 on white, 6.14:1 on `surface-alt` (AA-safe at body sizes).
- **Disabled ink** `neutral-60 #8A8886` — disabled text only (exempt from AA).
- **Borders** `neutral-80 #E1DFDD` (control/card border), `neutral-85 #EDEBE9`
  (subtle divider), `neutral-70 #C8C6C4` (stronger/hover border).
- **Surfaces** `surface #FFFFFF` (cards, top bar, inputs), `surface-alt #FAF9F8`
  (page canvas, side nav). `on-surface #201F1E` is the default text on both.
- Borders are decorative (≈1.3:1) — never rely on a border alone to convey
  state; always pair with text, icon, or fill color.

## Typography

Three families, Segoe-mimic and license-clean.

- **UI / body / display: `"Segoe UI"`**, referenced from the *system* stack only
  (never embedded as a webfont — Segoe is not ours to redistribute). The web
  fallback is **Selawik** — Microsoft's OFL, Segoe-metric-compatible font —
  **self-hosted via `@font-face` under the SIL Open Font License**, then
  `system-ui, -apple-system, sans-serif`. Effective stack:
  `"Segoe UI", "Selawik", system-ui, -apple-system, sans-serif`.
  Weights: **Semibold 600** for titles/labels, **Regular 400** for body.
- **Monospace: `"Cascadia Mono"`** (Microsoft, OFL, **self-hosted**), with
  fallback `"Cascadia Code", ui-monospace, "Cascadia Mono", Consolas, monospace`.
  Mono is **required** for all identifiers — tenant/object GUIDs, client IDs,
  secrets, tokens, scopes, redirect URIs — and for code/snippets. Identifiers
  render as copyable **mono chips** (see Components).

### Type scale
| Token | Family | Size / Weight | Use |
|---|---|---|---|
| `display` | Segoe UI | 28px / 600 | Page title, sign-in "Sign in" heading |
| `headline-lg` | Segoe UI | 24px / 600 | Section / screen heading |
| `headline-md` | Segoe UI | 20px / 600 | Card / panel heading |
| `headline-sm` | Segoe UI | 16px / 600 | Sub-heading, table caption |
| `body-lg` | Segoe UI | 16px / 400 | Lead paragraph, sign-in body |
| `body-md` | Segoe UI | 14px / 400 | Default UI body, table cells |
| `body-sm` | Segoe UI | 12px / 400 | Helper text, captions, metadata |
| `label-md` | Segoe UI | 14px / 600 | Buttons, form labels, nav |
| `label-sm` | Segoe UI | 12px / 600 | Table headers, chips |
| `label-caps` | Segoe UI | 11px / 600 · +0.06em | The LOCAL EMULATOR badge |
| `code-md` | Cascadia Mono | 13px / 400 | Code blocks, MSAL snippets |
| `code-sm` | Cascadia Mono | 12px / 400 | Identifier chips (GUIDs, IDs, tokens) |

**License note:** Segoe UI is referenced from the system font stack only — it is
*not* bundled or embedded. The bundled web fonts are Selawik and Cascadia Mono,
both under the SIL Open Font License (OFL), self-hosted from the app's own
assets. This keeps the Segoe *look* license-clean.

## Layout

A **fixed-max-width** desktop shell with a fluid single-column mobile fallback.
The base rhythm is a **4px grid** (Fluent's unit); the common step is 4 → 8 →
12 → 16 → 24 → 32. Containers cap at **1280px**.

- **Portal shell:** a 48px white top bar (wordmark + LOCAL EMULATOR badge +
  origin/tenant + health) over a 240px side nav (`surface-alt`) and a fluid main
  content area on the `surface-alt` canvas. Content sits in white cards with
  24px internal padding.
- **Sign-in:** a centered 440px white card on the `surface-alt` canvas, vertically
  and horizontally centered, with the LOCAL EMULATOR badge pinned at the top of
  the card and a "Not for production use" note in the footer.
- **Tables** are dense (32–44px rows) with a quiet `neutral-40` uppercase-ish
  header row; never zebra-striped — use hover (`neutral-95`) and 1px
  `neutral-85` row dividers.
- **Spacing tokens:** `xs 4` · `sm 8` · `md 12` · `lg 16` · `xl 24` · `xxl 32`;
  `gutter`/`margin`/`card` = 24px; `container` = 1280px.

### Breakpoints
| Name | Width | Behavior |
|---|---|---|
| `sm` | < 640px | Side nav collapses to a top hamburger; cards go full-bleed (16px gutters); tables become stacked key/value rows; sign-in card fills width minus 16px gutters. |
| `md` | 640–1024px | Side nav persists; one main column; tables scroll horizontally if needed. |
| `lg` | ≥ 1024px | Full shell; content capped at 1280px and centered. |

## Elevation & Depth

Depth is **restrained Fluent elevation** — soft, neutral, low-spread shadows
that lift surfaces just enough to establish hierarchy. The page canvas is the
tonal floor (`surface-alt`); content rises on white (`surface`) cards. Never use
colored or heavy drop shadows.

| Token | Use | Value |
|---|---|---|
| `depth-2` | Resting cards, table containers, input rest | `0 0.6px 1.8px rgba(0,0,0,.10), 0 0.15px 0.45px rgba(0,0,0,.07)` |
| `depth-4` | Hovered card, raised toolbar | `0 0.9px 2.7px rgba(0,0,0,.11), 0 0.5px 1.6px rgba(0,0,0,.09)` |
| `depth-8` | Dropdowns, popovers, the sign-in card | `0 1.6px 3.6px rgba(0,0,0,.13), 0 0.3px 0.9px rgba(0,0,0,.11)` |
| `depth-16` | Toasts, command bars | `0 3.2px 7.2px rgba(0,0,0,.13), 0 0.6px 1.8px rgba(0,0,0,.11)` |
| `depth-64` | Modal dialogs / drawers | `0 12.8px 28.8px rgba(0,0,0,.22), 0 2.4px 7.2px rgba(0,0,0,.18)` |

Where elevation isn't appropriate (e.g. the top bar), hierarchy is carried by a
1px `neutral-85` bottom border instead of a shadow.

## Shapes

**4px is the default corner radius** (`rounded.md`) — buttons, inputs, cards,
chips, badges, banners. This is the engineered-but-not-sharp Fluent feel.

| Token | Radius | Use |
|---|---|---|
| `none` | 0px | Full-bleed dividers, table edges |
| `sm` | 2px | Inline code, tight chips |
| `md` | 4px | **Default** — buttons, inputs, cards, chips, badges, banners |
| `lg` | 8px | The sign-in card, modals, large surfaces |
| `xl` | 12px | Oversized feature panels (rare) |
| `full` | 9999px | Avatars, the status dot, circular icon buttons |

Don't mix sharp (0px) and rounded corners within one surface. Avatars and the
local-status dot are the only fully-round elements.

## Components

States are defined for every interactive element: **default, hover, active,
focus, disabled, error, loading.** Focus is always a visible 2px
`primary-60 #0078D4` outline at a 1px offset (never removed). Loading shows an
inline spinner and `aria-busy="true"`; the control is disabled while busy.

### Buttons
- **Primary** (`button-primary`): filled `primary-60`, white text, `label-md`,
  4px radius, 32px tall (40px `lg`, 24px `sm`), optional 16px leading icon.
  Hover → `primary-50`; active → `primary-40`; focus → 2px `primary-60` outline
  +1px offset; disabled → `neutral-85` fill / `neutral-60` text; loading →
  spinner + label, disabled.
- **Secondary** (`button-secondary`): white fill, 1px `neutral-80` border,
  `neutral-20` text. Hover → `neutral-95` fill / `neutral-70` border; active →
  `neutral-85`; disabled → `neutral-95` fill / `neutral-60` text / `neutral-85`
  border. Use for "Use another account", "Cancel", and secondary actions.
- **Destructive**: secondary shape with `error-60` text and `error` border; on
  confirm uses `error-60` fill + white text.
- One primary button per view; everything else is secondary or a link.

### LOCAL EMULATOR badge (`badge-emulator`)
The signature component. A small pill: `caution-50 #F59E0B` fill, **dark ink
`neutral-10`** text (7.66:1), `label-caps` (11px/600, +0.06em, uppercase), 4px
radius, `3px 8px` padding, optional 12px shield/flask icon. **Text reads
"LOCAL EMULATOR".** Placement: pinned in the portal top bar (right of the
wordmark) and at the top of the sign-in card. It must be visible without
scrolling on every screen. Pair it once per surface with a quiet
"Not for production use" note in `body-sm` / `neutral-40`. Never recolor it to
blue/teal, never use white text on it, never animate it.

### Identifier chip (`identifier-chip`)
Renders any machine identifier — tenant/object GUID, client ID, secret, token,
scope, redirect URI — in **Cascadia Mono** (`code-sm`) on a `neutral-95` fill
with a 1px `neutral-85` border, 4px radius, `neutral-20` text, and a trailing
12px **copy** icon button. States: default; hover → `neutral-85` fill, copy icon
in `primary-50`; copied → icon swaps to a check + `success-60` for ~1.5s and an
`aria-live="polite"` "Copied" announcement; focus → 2px `primary-60` outline.
Long values truncate with a middle ellipsis but copy the full value. **Secrets**
render masked (`••••`) with a reveal toggle and the show-once warning.

### Cards (`card`, `signin-card`)
White (`surface`) on the `surface-alt` canvas, 4px radius (`card`) / 8px for the
sign-in card, `depth-2` (sign-in card uses `depth-8`), 24px padding (44px for
sign-in). Headings in `headline-md`. The **sign-in card** is 440px wide,
centered, and follows the `login.microsoftonline.com` pattern: app logo →
"Sign in" (`display`) → account picker list → "Use another account" → footer
note. The badge sits at the very top.

### Form fields (`input`)
White fill, 1px `neutral-80` border, 4px radius, 32px tall, `body-md` text,
`label-md` label above. Hover → `neutral-70` border; focus → 2px `primary-60`
outline +1px offset (border stays); error (`input-error`) → 1px `error-60`
border + 2px `error-60` focus ring, with `field-error-text` (`error-80`,
`body-sm`) below and `aria-describedby` + `aria-invalid="true"`; disabled →
`neutral-95` fill / `neutral-60` text. Inline validation mirrors the Admin API's
zod rules and the OAuth error table; 409/400 map to inline field errors.

### Account picker (sign-in)
A vertical list of selectable rows inside the sign-in card. Each row: 32px round
avatar (initials) + display name (`label-md`) + UPN (`body-sm`, `neutral-40`),
full-width, 8px radius hover (`neutral-95`). Active/pressed → `neutral-85`.
Keyboard: a roving-tabindex / arrow-navigable list; Enter selects. A final
"Use another account" secondary row. When `REQUIRE_PASSWORD=true`, selecting a
row reveals the password field inline with an error slot.

### Data tables (`table-header`, `table-row`)
White surface. Header row: `label-sm`, `neutral-40`, 1px `neutral-85` bottom
border, no fill. Body rows: `body-md`, `neutral-10`, 1px `neutral-85` dividers,
hover `neutral-95`; never zebra-striped. ID columns use identifier chips.
Row actions live in a trailing overflow (`…`) menu. Selected row →
`primary-90` tint. Includes loading (skeleton rows) and empty states.

### Side nav + top bar (`sidenav`, `topbar`)
**Top bar:** 48px, white, 1px `neutral-85` bottom border, holding the
"Entra Local" wordmark, the LOCAL EMULATOR badge, the emulator origin/tenant
(as identifier chips), and a health indicator. **Side nav:** 240px, `surface-alt`,
items in `label-md`/`neutral-20`; hover → `neutral-95`; **active item** →
`primary-90` fill + `primary-30` text + 2px `primary-60` left bar
(`sidenav-item-active`).

### Health / status indicator (`status-dot-local`)
A `full`-radius dot: `accent-60` (teal) = connected/local/healthy (TLS ok),
`success-60` for explicit "OK", `error-60` = unhealthy/unreachable,
`caution-50` = degraded. Always paired with a text label (`body-sm`) — color is
never the only signal.

### Banners (`banner-caution`, `banner-error`, `banner-success`)
Full-width inline message bars, 4px radius, 12–16px padding, a leading 16px icon,
and a left accent border in the role color. Caution = `caution-90` tint /
`caution-80` text (production-warning); error = `error-90` / `error-80`; success
= `success-90` / `success-60`. The persistent "Not for production use" copy uses
the caution banner or the badge's companion note.

### Toasts (`toast`)
Transient confirmation, bottom-right. Dark `neutral-10` surface, white text,
`depth-16`, 4px radius, optional leading status icon, auto-dismiss ~4s, and an
`aria-live="polite"` region. Used for "Copied", "Saved", "Seeded", "Reset".

### Empty states
Centered within the content/card: a muted 24px line icon, a `headline-sm` title
("No app registrations yet"), one line of `body-sm`/`neutral-40` guidance, and a
single primary action ("New app"). Honest, technical copy — no illustrations.

<!-- Portal extensions (feature #12) — appended subsections; existing entries unchanged. -->

### Data tables — paging, search & row actions (portal)
The dense data table (above) gains a **command row** above it (search box left/right
of a single `button-primary`, e.g. "New user"/"New app") and a **pagination footer**
(`pagination`): a 1px `neutral-85` top border, a `body-sm`/`neutral-40` range label
("1–4 of 4"), the page size, and `Prev`/`Next` secondary buttons (disabled at the
ends, mapping to the API's `top`/`skip`). Search maps to the API `?search=`. The
trailing `…` column is a `neutral-40` overflow icon button (Edit / Delete / Manage).
ID columns always render as identifier chips, never bare text.

### Drawer / side panel (`drawer`)
The create/edit surface for a single record (user, group members). A right-anchored
panel, full shell height, 440–480px wide, `surface`, `depth-64`, **sharp** left edge
(`rounded.none`) over a `neutral-10`@40% scrim. Structure: a header (`headline-md`
title + close `✕` icon button, 1px `neutral-85` bottom border), a scrolling body
(`spacing.card` padding, stacked form fields), and a footer (1px `neutral-85` top
border) with the primary action right-aligned and a `Cancel` secondary. Enters with
a 200ms decelerate slide+fade (instant under `prefers-reduced-motion`).
`role="dialog" aria-modal="true"`, focus-trapped, returns focus to the invoking row
on close, dismissible via `Esc` / scrim / Cancel. Prefer the drawer for multi-field
edits; reserve the dialog for short confirms.

### Dialog (modal) (`dialog`)
Centered confirmation/notice modal: `surface`, 8px radius (`rounded.lg`), `depth-64`,
440–480px, 24px padding, over the `neutral-10`@40% scrim (`dialog-scrim`). A
`headline-md` title, `body-md` description, optional banner, and right-aligned
actions (one primary or — for destructive confirms — an `error-60`-filled button +
`Cancel`). Used for reset, delete-user, delete-app (with a `banner-caution` cascade
warning), and the secret show-once. `aria-modal`, focus-trapped, the safe default
gets `autofocus`, `Esc`/scrim/Cancel dismiss.

### Copy-once secret dialog
A specialization of the dialog for `POST .../secrets`' one-time `secretText`. Leads
with a `banner-caution` ("Copy this secret now — shown only once, cannot be
retrieved"), then a **read-only** mono `input` (on `neutral-95`) paired with a
`button-primary` "Copy", then a small key/value block (description, `hint` chip,
`expiresAt`). A polite `aria-live` announces creation. The plaintext lives only in
component state, is never re-fetchable, and the dialog never auto-dismisses — the
user closes it deliberately. Existing secrets elsewhere render masked (`hint` chip
only), never the value.

### Code snippet block (`code-block`)
The MSAL config panel. A dark `neutral-10` surface, `neutral-100` text, `code-md`
(Cascadia Mono), 4px radius, 16–18px padding, horizontal scroll, with a translucent
**Copy** button pinned top-right that copies the full snippet (icon→check + polite
"Copied" on success). Light syntax tinting only (keys/strings/comments) — no themed
rainbow. Preceded by `tab`/`tab-active` tabs (`@azure/msal-browser` /
`@azure/msal-node`) — the active tab carries a 2px `primary-60` underline and
`primary-30` text — and a redirect-URI selector that re-templates the snippet. All
emitted identifiers (clientId, authority, knownAuthorities, redirectUri, graphBase)
are deterministic from the app + emulator config.

### Stat tiles (`stat-tile`) & endpoint rows (dashboard)
**Stat tiles:** white `card`-style tiles in a 3-up grid showing live counts
(users/groups/apps) — a `display` (28px/600) number over a `label-caps`/`neutral-40`
key. **Endpoint rows:** a key/value list (issuer, discovery, JWKS, authorize, token)
with the value in `code-sm` mono (middle-ellipsis truncated) and a trailing copy icon
button; issuer/tenant also surface as identifier chips in the top bar.

### Toggle switch (`toggle-on`/`toggle-off`)
A `full`-radius track with a white knob for booleans (`accountEnabled`,
`isConfidential`, scope/role `isEnabled`). On → `primary-60` track, knob right; off →
`neutral-60` track, knob left; 150ms transition; focus → 2px `primary-60` ring at 2px
offset. `role="switch"` + `aria-checked`; always paired with a text label (never color
alone).

## Do's and Don'ts

- **Do** keep the LOCAL EMULATOR badge visible on every screen (top bar +
  sign-in card). It is the primary not-production signal — never hide or remove it.
- **Do** use dark ink (`neutral-10`) on amber for the badge; **don't** ever put
  white text on amber (fails contrast at 2.15:1).
- **Do** render every machine identifier (GUIDs, client IDs, secrets, tokens,
  scopes, redirect URIs) in Cascadia Mono as a copyable chip. **Don't** put
  identifiers in proportional Segoe body text.
- **Do** use `primary-60 #0078D4` only for the single most important action per
  view; **don't** fill multiple competing buttons with blue.
- **Do** use `primary-50 #106EBE` for blue links/text on white and `accent-40
  #015A5D` for teal text; **don't** use the base `#0078D4`/`#038387` for small
  text on white (they sit right at the 4.5:1 edge).
- **Do** convey state with text + icon + color together; **don't** rely on a
  border or color alone (borders are ~1.3:1).
- **Do** keep a visible 2px `primary-60` focus ring on every interactive
  element; **don't** remove outlines.
- **Do** reference Segoe UI from the system stack and self-host only OFL Selawik
  + Cascadia Mono; **don't** embed a Segoe webfont, and **don't** use Microsoft
  logos, the Microsoft/Entra trademarks as our own, or imply official affiliation.
- **Do** keep motion quick and restrained (150–250ms); **don't** add scroll
  choreography or flashy transitions — a dev tool should feel instant.
- **Do** keep ~4px corners consistent; **don't** mix sharp (0px) and rounded
  corners in one surface.
- **Do** write honest, technical copy that always names this a *local emulator*;
  **don't** use marketing language or imply production readiness.

<!-- Non-canonical sections (preserved by the DESIGN.md spec) -->

## Voice

Concise, technical, direct — developer-to-developer. Second person ("you"). No
marketing fluff.

- **Tone:** precise and factual. State what a control does and what will happen.
  Prefer "Copy the client ID" over "Effortlessly grab your credentials."
- **Always honest:** never imply the product is Microsoft Entra or is
  production-grade. Surface "local emulator" / "not for production" where it
  matters (badge, banners, footer).
- **Words to use:** emulator, local, tenant, app registration, sign in, token,
  scope, client ID, redirect URI, issuer, JWKS.
- **Words to avoid:** enterprise/marketing speak ("seamless", "magical",
  "unlock", "powerful", "world-class"); anything implying production, official
  Microsoft endorsement, or real security.
- **Casing:** sentence case for headings, buttons, and labels (Fluent
  convention). The badge text "LOCAL EMULATOR" is the deliberate all-caps
  exception.

## Motion

Restrained Fluent motion — the UI should feel instant.

- **Durations:** 150ms (micro: hover, focus, chip copy), 200ms (default: menus,
  toasts, drawers), 250ms (max: dialog/sign-in card entrance). Nothing slower.
- **Easing:** Fluent decelerate `cubic-bezier(0.1, 0.9, 0.2, 1)` for entrances;
  `cubic-bezier(0.4, 0, 1, 1)` for exits; linear only for spinners.
- **Patterns:** quick fades and short (4–8px) slides. Toasts slide up + fade in;
  menus/popovers fade + 4px slide; the sign-in card fades in once. The copy
  confirmation is an instant icon swap, not an animation.
- **No** scroll-reveal, parallax, or staged choreography. Respect
  `prefers-reduced-motion`: drop slides/fades to instant.

## Positioning

- **Audience:** developers (app, API, QA, CI) building and testing MSAL-based
  apps who need a local Entra ID stand-in. They expect Microsoft-adjacent
  familiarity, exact/copyable values, and zero ceremony.
- **Should feel:** trustworthy, technical, Microsoft-*adjacent*, and clearly a
  local sandbox.
- **Differentiate from:**
  - *The real Azure / Entra portal* — we resemble it (so MSAL muscle memory
    transfers) but must never impersonate Microsoft. The amber badge + our own
    wordmark draw the line.
  - *Generic blue SaaS* — we use a *specific* Fluent blue and Fluent grays with
    real depth/shape discipline, not anonymous bootstrap blue.
  - *Purple-gradient AI aesthetic* — no gradients-as-identity, no glow, no
    novelty. Flat Fluent surfaces and honest data density.
- **Adjectives:** precise, trustworthy, technical, local/sandboxed, familiar.

## References

- Microsoft Fluent UI / Fluent 2 design language — color, elevation, shape, and
  motion model that this identity mimics.
- `login.microsoftonline.com` sign-in — the centered-card + account-picker
  pattern the sign-in page mirrors (pattern only; no Microsoft assets used).
- Azure / Entra admin portal shell — top bar + side nav + dense tables IA the
  portal mirrors.
- Microsoft Fluent communication blue `#0078D4`, Fluent neutral gray ramp, and
  Fluent semantic green/red — the palette source.
- **Selawik** (Microsoft, SIL OFL) — Segoe-metric-compatible web fallback,
  self-hosted. **Cascadia Mono/Code** (Microsoft, SIL OFL) — monospace for
  identifiers and code, self-hosted.

## Open questions

- **Wordmark / logo.** "Entra Local" ships as a text wordmark in Segoe Semibold
  for now. A dedicated logo/monogram (and an app-logo placeholder for the
  sign-in card when an app has none) is not yet designed — out of scope for this
  identity pass; revisit if branding needs a mark.
- **Dark mode.** Not defined in this pass; the emulator's two screens are
  light-only for the MVP. A Fluent dark-theme neutral/blue ramp can be added as
  an iteration if requested.
- **Icon set.** Component prose references line icons (status, copy, badge
  shield, empty states) but no icon library is pinned. Recommend a license-clean
  set (e.g. Fluent UI System Icons, MIT) at implementation time; confirm before
  the portal styling pass.
