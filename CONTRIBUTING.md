# Contributing to Entra Local

First off — thank you for taking the time to contribute! Entra Local is a small, focused
project, and thoughtful contributions are very welcome.

Please read this document **before** you start working on a change. The most important rule:

> ## 🛑 Open an issue before you open a pull request
>
> **Every pull request must reference an issue that has been discussed and accepted.** Please do
> not start coding (or send an unsolicited PR) before there is an agreed issue describing the
> problem and the intended approach. PRs without a linked, accepted issue may be closed without
> review. This isn't bureaucracy — it saves you from spending effort on a change that may not fit
> the project's scope or direction.

---

## Governance: benevolent dictator

Entra Local follows a **benevolent-dictator-for-life (BDFL)** model. [@cmaneu](https://github.com/cmaneu)
is the project owner and has the **final say** on scope, design, and what gets merged. Decisions
are made in the open and discussion is encouraged, but when there's no consensus the maintainer
decides. The aims are a coherent, deliberately-small emulator and a project that's pleasant to
maintain — not feature maximalism.

What this means in practice:

- **Scope is intentionally narrow.** Entra Local emulates a small slice of Entra ID (see the
  [README](README.md#what-it-emulates--and-what-it-doesnt) and the
  [roadmap](specs/roadmap.md)). Proposals that expand the surface area need a strong developer
  use case and maintainer buy-in **before** implementation.
- **An accepted issue is the contract.** Get agreement on the *what* and the *how* in an issue
  first; the PR then implements exactly that.

---

## Before you start: security & honesty

Entra Local is **intentionally insecure** and exists only for local development (see the
[Security & limitations](README.md#security--limitations) section). When contributing:

- **Never include real users, passwords, secrets, tokens, or tenant data** in issues, PRs,
  commits, tests, or screenshots. Use the project's public, dev-only seed values.
- Don't add anything that nudges the project toward being run as a real, exposed IdP (e.g.
  "production mode", remote-by-default binding). It must stay a localhost developer tool.
- If you believe you've found a security issue **in the project tooling itself** (not the
  by-design insecurity above), please open an issue describing the concern; there's no embargo
  process for a local-only dev tool.

---

## Ways to contribute

- **Report a bug** — open an issue with steps to reproduce, expected vs. actual behavior, and
  your OS / Node version.
- **Propose a feature or change** — open an issue describing the developer scenario it unblocks
  and how it fits the emulator's scope. Check the [roadmap](specs/roadmap.md) first.
- **Improve docs or samples** — typos, clarifications, and MSAL samples are great first
  contributions (still open an issue so we can coordinate).
- **Pick up an existing issue** — comment to say you're taking it so work isn't duplicated.

---

## Development setup

Prerequisites: **Node.js ≥ 22.5** (the persistence layer uses the built-in `node:sqlite`).

```bash
npm install        # install dependencies
npm run dev        # run the server with reload (tsx watch)
```

Then browse to `https://localhost:8443/` (trust or bypass the self-signed cert — see the
[README](README.md#certificate-trust)).

### Quality gates (run these before every PR)

Your change must keep **all** of the following green:

```bash
npm run lint       # eslint + prettier --check
npm run typecheck  # tsc --noEmit across server + tests
npm run build      # compile the server + build the portal
npm test           # unit + integration tests (vitest, deterministic, in-process)
npm run test:e2e   # real-MSAL end-to-end suite (starts a real HTTPS server)
```

Optional, when your change touches packaging:

```bash
npm run test:sea     # build + smoke-test the single-file binary
npm run docker:build # build the container image
```

CI runs the same gates — a PR that's red in CI won't be merged.

---

## Project conventions

This repo leans on a few lightweight conventions; please follow them so reviews stay fast.

- **Spec-first for non-trivial features.** Substantial features are specified under `specs/` as
  `specs/<yyyy-mm-dd>_<feature>.md` before implementation, with testable acceptance criteria.
  The accepted issue should agree on the approach; large features may warrant a spec PR first.
- **Definition of Done.** A change is "done" only when behavior is implemented **and** covered by
  tests, all five gates pass, and any user-facing behavior is reflected in the README / docs.
- **Project memory is append-only.** `memory/decisions.md` and `memory/conventions.md` record
  decisions and conventions. **Add** new entries; never edit or delete existing ones. Record a
  new entry when you make an architectural decision or establish a convention.
- **Visual identity lives in `DESIGN.md`.** It is the canonical design contract and is maintained
  deliberately. Don't restyle the portal ad hoc — propose UI/visual changes in an issue and align
  with `DESIGN.md` (validate with `npx @google/design.md lint DESIGN.md`).
- **Match the surrounding code.** TypeScript, Fastify, `node:sqlite`. Keep changes surgical and
  scoped to the issue; avoid unrelated refactors in the same PR.

---

## Pull request workflow

1. **Make sure there's an accepted issue** for your change (see the top of this document).
2. **Fork** the repo and create a topic branch from `main`
   (e.g. `fix/token-expiry`, `feat/graph-groups-filter`).
3. **Implement** the change, keeping it focused on the linked issue.
4. **Run all the gates** locally (`lint`, `typecheck`, `build`, `test`, `test:e2e`) and make sure
   they pass.
5. **Open the PR** against `main`. In the description:
   - Link the issue with `Closes #<issue-number>`.
   - Summarize *what* changed and *why*, and note anything reviewers should focus on.
   - Call out any new/changed config, endpoints, or seed data.
6. **Respond to review.** The maintainer may request changes or, per the governance model,
   decline changes that fall outside the project's scope.

### Commit messages

- Write clear, imperative subject lines (e.g. `Add device-code interval to discovery`).
- Reference the issue where helpful (e.g. `Refs #123`).
- Small, logically-scoped commits are easier to review than one giant commit.

---

## Code of conduct

Be respectful and constructive. Assume good intent, keep discussions focused on the work, and
remember that maintainer time is finite. Harassment or hostile behavior isn't tolerated.

---

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE), the same license that covers the project.
