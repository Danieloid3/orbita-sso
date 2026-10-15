# Exceptional account reconciliation and legacy role adoption

Normal first login uses [the approved automatic account policy](accounts.md): a currently authorized normal app-role token links the unique active matching email account or creates a user. There is no default email-domain restriction. It does not require provider migration mode, a CLI approval or role adoption.

Use an administrator-reviewed unique mapping between local ID and Órbita subject for exceptional reconciliation, email changes, conflicting links or environments without trusted provider email assertions. Resolve conflicts through reviewed application tooling; never overwrite a stable link automatically. Retain IDs and historical foreign keys; do not copy passwords.

For the separate legacy-role adoption workflow, the administrator must explicitly enable the provider's per-app migration/JIT policy. Keep it disabled for normal provisioning. The callback must contain a signed `migration: true, roles: []` token. Ordinary app-role tokens cannot be used to override Órbita assignments through adoption; their recognized assigned role is handled by normal account resolution.

Configure this optional adapter:

```ts
interface MigrationAdapter<U> {
  findAccount(identity, request): Promise<{accountId: string, role: string} | null>;
  authorizeLink(account, identity, request): Promise<boolean>;
  linkAccount(accountId: string, identity): Promise<U>;
}
```

`findAccount` locates one active legacy candidate and maps its local role to a known app catalog key. Reject duplicate emails and already-conflicting links. `authorizeLink` requires proven local-account ownership or an approved mapping linked to both IDs. Never just return true because emails match. Reauthentication proof belongs to the app's existing authentication boundary, not a browser-supplied boolean.

The SDK adopts the single role, generates a **new** authorization flow, and records the approved account ID, subject and expected role in server-side state. No local user is linked and no session exists until the second callback verifies the same subject with exactly the adopted role and a nonmigration token. It then calls `linkAccount`.

`linkAccount` rechecks active status, approval and unique links within one transaction. Be idempotent for the same mapping; reject attempts to overwrite another subject. Return only a public user projection with string ID. Do not grant a default role or relax conflict handling after an error.

Missing account/proof, an unknown role, another subject in the second callback or repeated migration token all deny access. The SDK permits only one adoption attempt per flow and never loops automatically. If adoption succeeded but the second callback was lost, use the previously approved mapping to complete linkage administratively or in a carefully checked `resolveUser` recovery path; do not resubmit a normal token to adopt-role.

Map local role constants explicitly to stable catalog keys, for example `OWNER -> owner` and `MEMBER -> member`. The current provider assigns one app role per person. Multiple legacy roles require a reviewed migration decision, not an automatic choice of the most privileged role. A different role in an ordinary token or a pending administrative review must never trigger adoption or a fallback grant.

If the existing application owns cookies/JWT/refresh tokens, use `OrbitaClient` to preserve that session contract or migrate every guard to the full handler. If a separate API in another language owns verification and sessions, preserve that authenticated boundary. An npm dependency cannot replace another runtime's token verification or make unsigned JSON trustworthy.

Validate candidate/proof refusal, successful adoption then reauthorization, role/subject mismatch, approval revoked before link, inactive local account, concurrent unique constraints and interrupted adoption recovery. Turn off the provider JIT policy after migration is complete. Report simulated tests separately from real user migration.
