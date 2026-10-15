---
name: integrate-orbita-sso
description: Integrate server-side JavaScript or TypeScript applications with Orbita SSO using orbita-sso, including app roles, automatic account linking/provisioning, sessions and an official-logo login button. Use for new integrations or replacing hand-written Orbita SSO clients; Python integrations require a separate implementation.
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

- **App without persistent local users:** use `createOrbitaSso` with its route/session handler. Its default user is a public subject/name/email projection; it does not insert a user into the application's database.
- **App with persistent local users:** implement the authorized first-login policy in [account resolution](references/accounts.md). Prefer `OrbitaClient` when account/link/session persistence must be atomic and live introspection must precede writes; do not assume the full handler's `resolveUser` hook provides the access token or that ordering.
- **Existing Node auth:** prefer `OrbitaClient` when preserving JWT/refresh cookies and guards. If replacing them with SDK sessions, update every consumer of the old session contract, not just the callback.
- **Node Request/Response server:** call `sso.handle(request)` before the existing router; `null` passes through. This is still server-only and not an edge-runtime guarantee.
- **JavaScript frontend + API in another language:** keep the trusted boundary. This package does not replace that API's token verification or make unsigned identity JSON trustworthy.

Read [the integration reference](references/integration.md) for the actual API, defaults and recipes. Read [account resolution](references/accounts.md) for local account linking/provisioning and [the login button reference](references/login-button.md) for every login UI. Read [the migration reference](references/migration.md) only for exceptional reviewed links or explicit adoption of legacy roles; it is not the normal first-login flow.

## Implement

1. Install `orbita-sso` with the existing package manager. Express and `pg` are needed only for their corresponding adapters. Respect the lockfile.
2. Use the supplied environment's Órbita client registration and callback allowlist. If registration/secret is missing, prepare the integration using configuration placeholders and identify what the administrator must provide; do not invent credentials or claim live validation.
3. Supply the **full app-owned role catalog** from its constants or database. `await sso.initialize()` automatically publishes it to Órbita. This creates/updates roles, not user assignments. Do not infer local roles from global Órbita roles or assign an administrator fallback.
   The current provider issues exactly one app role per normal identity. Use the SDK's default `roleMode: 'single'`; the catalog may still contain several possible roles. Role changes and pending administrative reviews are provider decisions, not migration or default-role fallbacks.
4. Use shared state/session stores in production. Integrate the SDK SQL through the app's migration system or implement its interfaces. Do not run production DDL as a side effect of setup.
5. Mount login/callback/session/logout routes. For apps with local users, the approved default is: a server-verified, currently authorized normal token with one recognized app role and a valid provider-asserted email links the unique active matching account or creates it on first login. Do not impose an email-domain allowlist by default. Apply a domain restriction only when the target application's own requirements explicitly call for it; do not infer one from another app. Preserve existing IDs/history and persist the stable provider/subject link. Follow [account resolution](references/accounts.md) for conflicts, transactions and role reconciliation. A role assignment makes a person eligible; it does not itself create a local account before login.
6. Render a localized **Órbita button with the official logo** using [the supplied asset and UI rules](references/login-button.md). In a login with credentials, place it below the credential submit button, as approved by the owner. Use a full browser navigation to the server login route.
7. Configure exact public URLs, redirects and frontend origins. Handle CSRF/CORS deliberately for separate-origin apps; never trust forwarded-host headers to invent callback or post-login URLs.

## Preserve the protocol

- Require discovery contract `1.0`, trusted origin and RS256. v1 JWTs have no required `iss`, `iat` or `nbf`; do not add invented claim requirements or weaken exact audience validation.
- Keep code exchange and client secret in the server. Codes are one-use; restart authorization if the exchange outcome is uncertain instead of retrying the code.
- Browser state must be random, tied to the browser, short-lived and **atomically consumed once** across replicas. Memory stores are for explicit development only.
- Limit local sessions AND refresh flows to the verified provider deadline. Do not turn the SDK's 30-minute provider evidence into a multi-day local login.
- Default introspection checks revocations on every session read and fails closed on transport failure. Choosing expiry-only validity is a deliberate product decision, not an outage fallback.
- Identity links use the configured provider origin and stable subject IDs. The approved auto-link policy trusts the email asserted by Órbita only together with a verified normal token, explicit app role and live introspection. Domain/email alone or browser-supplied fields never authorize linking. Domain restrictions are application-specific, not a shared SSO default. Contract v1 has no `email_verified`; document this provider-trust assumption without claiming independent mailbox verification or inventing a required claim.
- Adoption only accepts `migration: true` with `roles: []` and requires reauthorization with the approved subject/role before granting access. A mismatch in that adoption flow is a conflict. Normal assigned-role changes follow account reconciliation; they never trigger adoption.
- Return safe errors; do not log secrets, tokens, authorization codes, complete callback URLs or request/response bodies containing them.

## Validate and report

Run the app's relevant checks and controlled tests for login/callback, duplicate/wrong/expired state, signature/audience/roles, identity conflicts, session expiry, revocation, outages and logout CSRF. For local users, cover existing/new accounts, valid emails from different domains when no restriction exists, any explicitly configured domain policy, literal email matching, inactive/duplicate/conflicting accounts, concurrent logins, rollback and role reconciliation. Verify the visible logo button, placement, keyboard/touch access, locale and real browser navigation. When migration is enabled, prove that missing authorization cannot link accounts and the second callback must match subject and role.

Use the actual target Órbita environment only within the user's authorized integration scope. Distinguish package tests, mocked app integration and a real browser login. Do not claim deployment, npm publication, role assignment or account migration happened just because local code is ready.

Deliver the integration points, environment names without secret values, database migrations, public routes, account trust policy, role sync policy, branded login UI, validation evidence and any remaining administrator configuration. Publishing this skill or package is separate from integrating an application unless requested.
