---
name: roadmap
description: "Create or iterate on the project roadmap at specs/roadmap.md. Use when starting a new project, scoping an MVP, or adjusting priorities based on progress, QA findings, or new requirements. Runs an interview-style discovery, validates an intermediate summary with the user, then locks the roadmap."
---

# Create Roadmap

> **Run as the product-manager agent.** If you are not the `product-manager` (Face), delegate the entire roadmap work to it via the task/agent tool before proceeding. The PM owns `specs/roadmap.md` end-to-end; running roadmap work from another agent splits ownership and risks inconsistent product direction.

This skill guides the creation or iteration of the project roadmap. A roadmap without a clear MVP cut, dependencies, and rationale produces scope creep and rework. This skill enforces a structured discovery, then locks decisions into `specs/roadmap.md`.

## When to use

- The project has no `specs/roadmap.md` and a high-level idea or vision exists
- The user explicitly asks to create a roadmap
- The user asks to evolve / reprioritize an existing roadmap (after shipped features, QA findings, or pivots)

## Source of truth

`specs/roadmap.md`. Product-level only — features, value, dependencies, ordering, scope boundaries. **No implementation details** — those live in per-feature specs at `specs/<yyyy-mm-dd>_<feature>.md`.

## Process

### 1. Preconditions check

Before asking the user anything:
- Read `specs/roadmap.md` if it exists.
  - If present **and** populated → enter **Iteration mode** (skip to the bottom of this skill).
  - If missing or placeholder → enter **Initial creation mode** (continue below).
- Read `memory/decisions.md` for any prior product-level decisions.
- If `DESIGN.md` exists, read its Positioning section for audience/differentiation context (don't ask the user twice).
- Search the codebase briefly to see what already exists (don't assume greenfield if there is shipped code).

### 2. Framing interview (one question at a time)

For new roadmaps, ask the user **one question at a time** and wait for each answer before asking the next. Sequential pacing produces clearer answers than a wall of questions.

In order:

1. **Idea & vision** — What are we building? Mention they can describe features, target audience, technology preferences, and any other relevant details. Mention they can paste from a file if they prefer.
2. **Audience** — Who is this for? If not obvious from the idea. Skip if already covered.
3. **Constraints** — Any specific constraints? Tech stack restrictions, deadlines, compliance, accessibility, libraries to use/avoid. If none, assume defaults.
4. **MVP intent** — What is the smallest version that delivers core value? What would you happily ship first? If the user can't answer, propose a candidate based on the idea.

If the project is well-defined from a pitch the user paste in step 1, you may skip later questions when the answer is already covered. Don't ask redundant questions.

### 3. Decompose & propose (propose-and-iterate)

This phase is faster when the AI proposes and the user refines. Don't ask the user to enumerate every feature — derive them from the framing.

1. Break the idea into discrete features. For each:
   - Name and one-line description
   - User value: what problem does it solve
   - UI flag: yes/no — whether the feature has user-facing UI (triggers designer involvement during planning)
   - Dependencies: which features must come first
   - Scope: what's included, what's explicitly excluded
2. Group features into iterations:
   - **Iteration 1 (MVP)**: minimum set to deliver core value
   - **Iteration 2+**: incremental additions ordered by value and dependency
   - **Deferred**: explicitly out of scope for now, with rationale
3. Identify **potential challenges** for the riskiest features, each with a **mitigation strategy**.
4. List any **open decisions** the user hasn't committed to (e.g., monetization model, auth provider, hosting choice). Don't block the roadmap on these — surface them so the planner can resolve them later.

### 4. Intermediate summary → user validation

Before writing the final file, present an intermediate summary using the template below and ask the user:

> "Does this match what you want to build? Any features to add, remove, reorder, or move between iterations?"

Loop until the user is satisfied. Make concrete edits between rounds, not abstract acknowledgments.

```md
# Roadmap Proposal: <Project Name>

## Goal
<One-line vision>

## Audience
<Target users>

## Iteration 1 (MVP)
| # | Feature | Value | UI | Depends on |
|---|---------|-------|----|------------|
| 1 | <Name> | <Why it matters> | ✓ / – | – |

## Iteration 2
| # | Feature | Value | UI | Depends on |
|---|---------|-------|----|------------|

## Deferred
- <Feature> — <Why deferred>

## Challenges & Mitigation
| Challenge | Mitigation |
|-----------|------------|

## Open Decisions
- <Decision> — <Why it's open, when it needs to be resolved>
```

### 5. Adversarial review

Once the user accepts the intermediate summary, the PM agent delegates the proposed roadmap to the `reviewer` agent for adversarial review (orchestrator runs the standard 2-parallel + consolidation protocol if available; otherwise self-review).

The reviewer challenges:
- Is the MVP cut truly minimal? Could it be smaller?
- Are dependencies correct? Are any features blocked by missing prerequisites?
- Are there features that overlap and should be merged or split?
- Are challenges adequately covered, or are there missing risks?
- Are open decisions specific enough to be resolvable later?

Resolve all findings autonomously, documenting rationale.

### 6. Lock the roadmap

Write `specs/roadmap.md` using the final format below. Update `memory/decisions.md` with any product-level decisions made (palette of audience, MVP scope rationale, deferred-feature reasoning).

```md
# Roadmap: <Project Name>

## Goal
<High-level project vision>

## Audience
<Target users>

## Iteration 1 (MVP)
| # | Feature | Description | UI | Dependencies | Status |
|---|---------|-------------|----|--------------|--------|
| 1 | <Name> | <One-line description> | ✓ / – | – | ⬜ |

## Iteration 2
| # | Feature | Description | UI | Dependencies | Status |
|---|---------|-------------|----|--------------|--------|

## Deferred
| Feature | Rationale |
|---------|-----------|

## Challenges & Mitigation
| Challenge | Mitigation |
|-----------|------------|

## Open Decisions
| Decision | Resolve by |
|----------|------------|

## Product Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|
```

Status markers: ⬜ (not started), 🔄 (in progress), ✅ (complete).

## Iteration mode

When invoked with an existing populated `specs/roadmap.md`:

1. Read the current roadmap in full.
2. Read recent specs in `specs/` and QA logs in `qa/` to understand what shipped and what surfaced.
3. Ask the user **what triggered the iteration**:
   - A pivot in direction?
   - QA / production findings?
   - New requirements?
   - Reprioritization based on user feedback?
4. Propose specific changes (don't rewrite from scratch). For each change, state the rationale.
5. **Mark completed features as `✅` — do NOT remove them.** History matters.
6. Show the diff (added, removed, reordered, status-updated) and ask for confirmation.
7. Send the updated roadmap through adversarial review.
8. Apply the changes and update `memory/decisions.md` with any new product-level decisions.

## Rules

- **DO NOT include implementation details** — that's the planner's job. Features are scoped at the product level (what + why), not the code level (how).
- **DO NOT ask the user to enumerate every feature.** Derive them from the framing, then iterate with them.
- **DO NOT batch the framing questions.** One at a time, in order.
- **DO NOT skip the intermediate summary step.** User must validate before the file is locked.
- **DO NOT skip the adversarial review.**
- **DO NOT leave features vaguely scoped** — each needs clear boundaries (in / out / dependencies).
- **DO NOT create features that overlap in scope** — split or merge them.
- **DO NOT remove completed features** during iteration. Mark them as ✅.
- **DO NOT bloat the MVP.** Push back when the user includes "nice-to-haves" in Iteration 1. The MVP cut is the most valuable decision in the document.
- Keep iterations small and deliverable. Prefer shipping often over shipping big.
- When the user has no opinion, make a clear recommendation with rationale. A locked decision beats infinite optionality.
