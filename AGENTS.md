# Project Guidelines

## Shared Memory

The project maintains shared memory in `memory/`:

- `memory/decisions.md` — Architectural and design decisions
- `memory/conventions.md` — Established project conventions

### Reading
Before making architectural decisions or proposing changes, check existing decisions and conventions for prior context.

### Writing
When a new decision is made or convention established:
1. Read the current file
2. Append the new entry at the end
3. Do not modify or remove existing entries

**Decision format:**
```
### <Decision Title>
- **Date**: YYYY-MM-DD
- **Context**: What prompted this decision
- **Decision**: What was decided
- **Rationale**: Why this choice
- **Alternatives**: What else was considered
```

**Convention format:**
```
### <Convention Name>
<Clear description with example if helpful>
```

## Visual Identity

`DESIGN.md` at the repo root is the canonical visual contract for the project. It follows Google's [DESIGN.md spec](https://github.com/google-labs-code/design.md) — YAML token frontmatter plus markdown prose, with non-canonical extension sections (Voice, Motion, Positioning, References).

### Reading
Before any UI work, read `DESIGN.md`. If `Status: undefined`, no visual identity has been established — the `designer` agent (Murdock) must establish it before non-trivial UI work proceeds.

### Writing
Only the `designer` agent writes to `DESIGN.md`. Other agents flag gaps back to the designer instead of editing the file directly. Validate edits with `npx @google/design.md lint DESIGN.md`.
