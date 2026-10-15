---
name: integrate-orbita-sso
description: Integrate server-side JavaScript or TypeScript applications with Orbita SSO using the orbita-sso npm package, including automatic role catalog sync, browser callbacks, sessions and approved legacy-account migration. Use for new integrations or replacing hand-written Orbita SSO clients; Python integrations require a separate implementation.
license: MIT
metadata:
  package: orbita-sso
  package-url: https://www.npmjs.com/package/orbita-sso
  package-major: "1"
  contract: "orbita-sso-client-1.0"
---

# Integrate Órbita SSO

Connect the application using `orbita-sso` rather than duplicating its discovery, token exchange or signature-verification code. This skill targets Node.js 22+, JavaScript ESM and TypeScript. It is portable procedural guidance; it needs the agent's ordinary repository and command tools, not a specific connector.

## Dependency and download

The dependency is **[`orbita-sso` on npm](https://www.npmjs.com/package/orbita-sso)**. Install a compatible 1.x release in the application's server:

```sh
npm install orbita-sso@^1
```

Respect the application's existing package manager and lockfile. Add `express` or `pg` only when the corresponding adapter is used. Do not install this confidential-client SDK into a browser-only application.

Source and tutorial: [WhiteRabbitCoder/orbita-sso](https://github.com/WhiteRabbitCoder/orbita-sso). [Public registry metadata](https://registry.npmjs.org/orbita-sso) contains each version's `dist.tarball` download link. Use `npm view orbita-sso@1 dist.tarball` for compatible 1.x releases; prefer installing the npm dependency normally.

## Inspect and choose the integration boundary

Read the app's instructions, server entry, existing auth/session guards, role catalog, users schema, package manager and runtime. Determine which server owns the callback and secret. Never put the confidential client in a SPA, browser bundle or public env variable.

- **New app:** use `createOrbitaSso` with its route/session handler. Default user is the Órbita subject/name/email; local business tables are optional.
- **Existing Node auth:** prefer `OrbitaClient` when preserving JWT/refresh cookies and guards. If replacing them with SDK sessions, update every consumer of the old session contract, not just the callback.
- **Node Request/Response server:** call `sso.handle(request)` before the existing router; `null` passes through. This is still server-only and not an edge-runtime guarantee.
- **JavaScript frontend + API in another language:** keep the trusted boundary. This package does not replace that API's token verification or make unsigned identity JSON trustworthy.

Read [the integration reference](references/integration.md) for the actual API, defaults and recipes. Read [the migration reference](references/migration.md) only when existing accounts must be linked or roles adopted.

## Implement

1. Install `orbita-sso` with the existing package manager. Express and `pg` are needed only for their corresponding adapters. Respect the lockfile.
2. Use the supplied environment's Órbita client registration and callback allowlist. If registration/secret is missing, prepare the integration using configuration placeholders and identify what the administrator must provide; do not invent credentials or claim live validation.
3. Supply the **full app-owned role catalog** from its constants or database. `await sso.initialize()` automatically publishes it to Órbita. This creates/updates roles, not user assignments. Do not infer local roles from global Órbita roles or assign an administrator fallback.
   The current provider issues exactly one app role per normal identity. Use the SDK's default `roleMode: 'single'`; the catalog may still contain several possible roles. Role changes and pending administrative reviews are provider decisions, not migration or default-role fallbacks.
4. Use shared state/session stores in production. Integrate the SDK SQL through the app's migration system or implement its interfaces. Do not run production DDL as a side effect of setup.
5. Mount login/callback/session/logout routes, add the login link, connect local users if needed, and protect server routes with session and role checks.
6. Configure exact public URLs, redirects and frontend origins. Handle CSRF/CORS deliberately for separate-origin apps; never trust forwarded-host headers to invent callback or post-login URLs.

## Preserve the protocol

- Require discovery contract `1.0`, trusted origin and RS256. v1 JWTs have no required `iss`, `iat` or `nbf`; do not add invented claim requirements or weaken exact audience validation.
- Keep code exchange and client secret in the server. Codes are one-use; restart authorization if the exchange outcome is uncertain instead of retrying the code.
- Browser state must be random, tied to the browser, short-lived and **atomically consumed once** across replicas. Memory stores are for explicit development only.
- Limit local sessions AND refresh flows to the verified provider deadline. Do not turn the SDK's 30-minute provider evidence into a multi-day local login.
- Default introspection checks revocations on every session read and fails closed on transport failure. Choosing expiry-only validity is a deliberate product decision, not an outage fallback.
- Identity links use stable subject IDs. An email match can identify a migration candidate; it does not prove ownership or authorize linking.
- Adoption only accepts `migration: true` with `roles: []`. Ordinary tokens with a different role are conflicts, not adoption candidates. Reauthorize before granting access.
- Return safe errors; do not log secrets, tokens, authorization codes, complete callback URLs or request/response bodies containing them.

## Validate and report

Run the app's relevant checks and controlled tests for login/callback, duplicate/wrong/expired state, signature/audience/roles, identity conflicts, session expiry, revocation, outages and logout CSRF. When migration is enabled, prove that missing authorization cannot link accounts and the second callback must match subject and role.

Use the actual target Órbita environment only within the user's authorized integration scope. Distinguish package tests, mocked app integration and a real browser login. Do not claim deployment, npm publication, role assignment or account migration happened just because local code is ready.

Deliver the integration points, environment names without secret values, database migrations, public routes, role sync policy, validation evidence and any remaining administrator configuration. Publishing this skill or package is separate from integrating an application unless requested.
