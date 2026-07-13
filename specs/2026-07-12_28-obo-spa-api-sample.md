# Feature #28 — OBO SPA/API sample

**Status:** ✅ Implemented  
**Dependency:** #27

`samples/obo-spa-api/` demonstrates:

`@azure/msal-browser` SPA (`:5174`, app `…0008`) → confidential Express middle tier (`:4001`, app
`…0009`) → Entra Local Graph `/me`.

The SPA requests `api://…0009/access_as_user`. The API validates signature, issuer, audience, and
scope, then uses real `@azure/msal-node` `acquireTokenOnBehalfOf` for `User.Read`. It calls local
Graph and returns only the profile and safe incoming/downstream claim summaries.

The fixed registrations, scope ID, secret ID, and development-only secret are additive/idempotent
seed data. The standalone npm workspace includes environment templates, lockfile, README, optional
emulator Compose file, build/run scripts, and Playwright smoke. CI builds and starts all tiers,
drives interactive sign-in, verifies the complete claim transition and Graph response, covers
401/403 paths, checks documentation, and tears down all processes.
