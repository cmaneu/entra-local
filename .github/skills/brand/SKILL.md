---
name: brand
description: "Establish or evolve a project's visual identity in DESIGN.md. Use when DESIGN.md is undefined or when the user wants to redefine colors, typography, components, motion, or voice. Runs an interview-style discovery, locks decisions into DESIGN.md as they're made, and produces a brand identity that resists generic AI aesthetic."
---

# Create Branding

> **Run as the designer agent.** If you are not the `designer` (Murdock), delegate the entire brand work to it via the task/agent tool before proceeding. The designer owns `DESIGN.md` end-to-end; running brand work from another agent splits ownership and risks inconsistent identity decisions.

This skill guides the creation or evolution of a project's visual identity, captured in `DESIGN.md` at the repo root following [Google's DESIGN.md spec](https://github.com/google-labs-code/design.md). A project without a defined visual identity converges on the same generic AI aesthetic as everyone else. Decisions made up front by this skill eliminate that.

## When to use

- `DESIGN.md` shows `Status: undefined` (placeholder template) and the project needs UI work
- The user explicitly asks to establish a brand identity
- The user asks to evolve / iterate on an existing identity

## Source of truth

`DESIGN.md` at the repo root. YAML token frontmatter + markdown prose. Validate edits with:

```sh
npx @google/design.md lint DESIGN.md
```

Canonical sections (in this order): Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts.
Non-canonical extension sections used by this project: **Voice**, **Motion**, **Positioning**, **References** — preserved by the spec, carry the breadth tokens don't cover.

## Process

### 1. Gather context

Before asking the user anything:
- Read the current `DESIGN.md` to detect new identity vs. iteration on existing.
- Read `memory/decisions.md`, `specs/roadmap.md` (if present), `README.md` to understand audience, domain, and any tonal cues already implied.

### 2. Find references on designdotmd.directory

Browse [designdotmd.directory](https://designdotmd.directory/) for inspiration and concrete reference identities. It's a directory of DESIGN.md files contributed by the community, each with tokens, rationale, and visual previews.

How to use it:
- Find 2-3 published identities in adjacent (not identical) categories to what you're building. Same energy, different domain.
- Pull concrete elements: color logic (not the same hex), type pairings, component patterns.
- Show the user 2-3 candidate references and ask which direction resonates before diving into questions.
- Never copy a published identity wholesale. Use it as a starting point to anchor the conversation.

### 3. Interview the user

Ask focused questions in **small batches of 3-5 at a time**, never a wall of 20. Do not move to the next batch until the current one is answered. Cover in this order:

**a. Positioning & tone**
- Audience and what they expect from products in this category
- Competitors / references to feel different from (name them)
- 3-5 adjectives the brand should evoke (e.g. "warm, editorial, confident")
- One aesthetic direction to commit to (refined minimal, editorial magazine, brutalist, retro-futuristic, organic, luxurious, playful, industrial). No "minimal but also bold."

**b. Colors**
- 3-5 main colors max. Less is more.
- Each color has a defined role (`primary`, `secondary`, `tertiary`, `neutral`, optional `accent`).
- For each color: name, hex, RGB, role, recommended pairings (which text on which background, gradients).

**c. Typography**
- 2 families, 3 max. From Google Fonts unless the user provides a license.
- Each family has a role: body, titles, display/logo. Define type scale (h1, h2, h3, body, label).
- Avoid generic defaults (Inter, Roboto, Arial, system fonts). If the user has no preference, propose a duo that fits the aesthetic and ask to confirm.

**d. Components & motion (when applicable)**
- Buttons (primary, secondary, sizes, presence of icon)
- Section labels (uppercase + tracking + leading rule? badge? none?)
- Trust bar / social proof pattern
- Cards, badges, testimonials if relevant
- Motion language (scroll-reveal? sticky editorial layouts? statement footer? restrained / none). Durations, easing, stagger if defined.

**e. Voice & copy**
- Tone (concise / editorial / technical / warm / direct)
- Pronouns and formality
- Words to use, words to avoid

### 4. Iterate on each batch

Propose **concrete choices, not menus**. Give the user a single recommended option per question with rationale, plus 1-2 alternatives. The user accepts, swaps, or refines. Loop until the section is locked.

When the user has no opinion, make a clear recommendation. A locked decision is better than infinite optionality.

### 5. Lock each section as it's decided

Once a batch is decided, write it into `DESIGN.md` immediately. Do not wait until the end. The user can interrupt and resume across sessions.

For each lock:
1. Update the YAML frontmatter with the relevant tokens.
2. Update the corresponding prose section.
3. Run `npx @google/design.md lint DESIGN.md`. Fix any errors (broken refs, contrast failures, missing primary) before continuing.

### 6. Generate artifacts (optional)

When the identity is complete and the project has a frontend, ask whether to generate:
- `brand/brand-book.html` — visual reference of colors, typography, gradients, pairings
- `brand/ui-kit.html` — reference implementation of base components (buttons, labels, cards, trust bars, badges, footer)
- `brand/demo.html` — sample implementation of a key page (e.g. homepage) showcasing the identity in action with fake data

Build them as standalone HTML files using Tailwind via CDN, with colors and fonts from `DESIGN.md` wired through CSS variables. These are visual references, not production code.

### 7. Record decisions

Append the meaningful brand decisions (palette rationale, typography choice, aesthetic direction, references that informed the direction) to `memory/decisions.md` using the project's decision format. The detailed values live in `DESIGN.md`; the *why* lives in `memory/decisions.md`.

## Iteration mode

When called to update an existing identity (rather than create one):

1. Read the current `DESIGN.md` in full.
2. Confirm with the user which sections are in scope to change.
3. Preserve untouched sections verbatim. Update only what is in scope.
4. Run lint after each section update.
5. Append the change rationale to `memory/decisions.md`.
6. If `brand/brand-book.html` or `brand/ui-kit.html` exist, regenerate them to match.

## Rules

- **DO NOT ask 20 questions at once.** Batches of 3-5, in order: positioning → colors → typography → components → motion → voice.
- **DO NOT propose a generic palette** (purple gradient on white, blue SaaS, etc.) unless the user explicitly asks for it. Push for differentiation.
- **DO NOT use generic AI defaults** (Inter, Roboto, Arial, system fonts) unless the user insists.
- **DO NOT define more than 5 colors or 3 type families.** Constraint creates identity.
- **DO NOT leave `DESIGN.md` half-filled with TODOs** after the session. Anything unresolved goes under `## Open questions` so the next agent knows it's unresolved.
- **DO NOT skip writing to `DESIGN.md` until the end.** Lock each section as soon as it's decided.
- **DO NOT skip lint validation** after edits.
- **DO NOT copy a designdotmd.directory entry wholesale.** Use them as references to anchor direction, not as templates.
- **DO NOT design components or pages here.** This skill produces the *system*, not the screens. Per-feature design happens elsewhere.
- When the user gives no opinion, make a clear recommendation with rationale. A locked decision beats infinite optionality.
