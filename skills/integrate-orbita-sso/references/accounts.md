# Authorized account resolution

## Approved first-login default

For applications that maintain local users, a successful first SSO login with a recognized assigned app role links the single active local account with the same provider-asserted email or creates a local user when none exists. This policy was explicitly approved by the owner for subsequent integrations. It is application behavior, not an automatic database feature of the SDK.

Órbita is the authority for the authenticated identity, asserted email and app-role assignment. There is no email-domain allowlist by default: a valid email from any domain is eligible when its authenticated Órbita identity has the app role and passes the remaining checks. Apply a domain restriction only when the target application's own requirements explicitly call for it; do not infer one from the organization, app URL or another app.

The v1 identity has no separate `email_verified` claim. A valid signature proves that Órbita asserted the email, not independent mailbox verification. Document that trusted Órbita identity administration is the basis for initial linking. An untrusted/self-editable email assertion is insufficient for automatic linking: use reviewed mapping or local reauthentication in that environment. If a later supported contract exposes verification status, enforce that contract explicitly rather than inventing claims or SDK options.

Granting an app role in Órbita makes the person eligible. Create/link locally during the first authorized callback; do not claim that role assignment itself pushes a user into the application. Provisioning on assignment requires a separately implemented event/webhook integration.

## Validate before any account writes

1. Atomically consume the short-lived state bound to this browser's nonce cookie, then exchange the code once on the server.
2. Use the SDK to verify RS256, trusted key source, exact app audience, claim types and expiry. Reject migration tokens, empty roles, unknown roles and multiple roles under the single-role contract. Map the one assigned role through the app's explicit catalog; never use global roles, optional attributes or an admin fallback.
3. Trim/lowercase the signed email and require a syntactically valid mailbox; malformed addresses such as extra `@` characters are invalid. Accept different domains by default. If the target app explicitly has a domain policy, enforce its exact allowed domain and reject lookalike domains; do not use loose suffix matching.
4. Require live `client.introspect(verified.accessToken)` before provisioning/linking. Deny on inactive evidence or transport failure, without falling back to a local role. Retain the SDK's provider expiry and recheck it before committing.

With SDK 1.0.1, the full handler calls `resolveUser(identity, request)` before session introspection and does not expose the access token to that hook. Use `OrbitaClient` for this persistence policy rather than assuming `resolveUser` supplies pre-write introspection or an account/session transaction. Recheck actual APIs when integrating a later version.

## Resolve and persist atomically

Use one database transaction for user resolution/creation, stable identity linking, role changes and local session or browser-grant persistence. Use suitable unique constraints and serializable isolation or equivalent locking for concurrent first logins.

- Resolve an existing link by `(configured provider origin, subject)`. Keep the local ID. Never replace the subject or relink an existing subject based on a new email.
- Query the normalized email using literal, parameterized equality. `%` and `_` in a valid mailbox are characters, not SQL pattern wildcards. Check legacy case variants; do not choose the first of several candidates.
- With an existing link, require that its active user and the unique email candidate are the same account and that the normalized email still agrees. Email drift requires reviewed reconciliation.
- With no link, link the single active matching local user, preserving ID, name, business records and historical foreign keys. If there is no candidate, create a user using the validated email, safe display name and assigned app role. Do not generate or copy passwords.
- Deny inactive local users instead of reactivating them. Deny duplicate candidates, a subject mapped to another user, or a local user bound to a different subject/provider. Never silently merge accounts or transfer history.
- Constrain provider/subject and provider/local-user mappings uniquely. Make repeated logins for the same identity idempotent. Audit automatic links using an explicit policy identifier, not a fabricated human approver; e.g. `policy:orbita-email-link-v1`. Describe any additional app-specific domain requirement in that app's policy.
- Reconcile a recognized normal provider role to the local role at login, invalidating old local authorization evidence when it changes. Preserve application invariants such as protection of the last active administrator; if a guard rejects a change, deny login rather than retain an elevated fallback. A role difference is not a reason to call `adoptRole`.
- Persist session evidence only if all preceding steps succeed. Roll back user/link/role writes when session persistence fails. Retry only bounded local uniqueness/serialization races by resolving state again; never retry the consumed authorization code.

Encrypt provider evidence at rest when storing it for introspection. Return a minimal public user projection, not an ORM record containing private fields. Keep raw tokens, secrets, codes and complete callback URLs out of logs and browser storage.

## Authorization after linking

Check the active local account, stable link, provider deadline and current provider authorization when reading the session. Introspection must reject revoked app access or changed roles; it must fail closed during provider outages. Revocation does not require deleting the business user/history.

When Órbita is the authority for a linked account, prevent old local/Moodle cookies, password login or refresh flows from bypassing SSO revocation. Preserve the existing login policy for accounts outside that linked scope. Use the framework's actual server-side invalidation mechanism; for Auth.js JWT sessions, invalidate in `jwt` by returning `null`, rather than relying on a null `session` callback that may fall back to a default session.

## Verify observable behavior

Exercise an existing user (same ID/history), a new user (one created account/link), case-insensitive equality, literal `%`/`_`, duplicate emails, inactive users, email drift and conflicting subjects. In an app without a domain restriction, prove that a valid email from a different domain with an authorized app role can link/create a user. If the target app has an explicit domain restriction, cover its accepted domain and lookalike-domain refusals separately. Reject no-role/migration/invalid-email evidence before writes. Cover provider failure, role changes, revocation, last-admin guards where applicable, concurrent first logins and rollback on session failure. Use an isolated database for destructive fixtures and report simulated-provider tests separately from a real browser login.
