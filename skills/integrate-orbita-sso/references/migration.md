# Account migration

The safe default is an administrator-reviewed unique mapping between local ID and Órbita subject, with role assignment in Órbita. Link beforehand and let `resolveUser` resolve by subject. Retain IDs and historical foreign keys; do not copy passwords.

For JIT role adoption, the administrator must enable the provider's per-app migration/JIT policy. The callback must contain a signed `migration: true, roles: []` token. Ordinary app-role tokens cannot be used to override Órbita assignments.

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

TeamUp's local `ADMIN/STAFF/CODER/TL_*` values map to `admin/staff/coder/tl_*` catalog keys and use single-role mode. The inspected legacy integration tries adoption on some ordinary tokens with different roles; this is incompatible with the provider's migration-token requirement. Treat those cases as conflict/review.

Talent Match resolves multiple roles by priority `admin > ta_leader > recruiter` in its Python API, rejects automatic linking by email, and has a JavaScript BFF. Preserve those boundaries unless a separate architecture migration is requested. The npm package alone cannot replace that Python session contract.

Validate candidate/proof refusal, successful adoption then reauthorization, role/subject mismatch, approval revoked before link, inactive local account, concurrent unique constraints and interrupted adoption recovery. Turn off the provider JIT policy after migration is complete. Report simulated tests separately from real user migration.
