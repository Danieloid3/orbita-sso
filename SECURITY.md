# Security

This package handles confidential-client credentials and provider evidence only on the server.
Protect secret configuration and shared session storage; never send raw session records to a browser.
Use a separate Orbita registration per environment and HTTPS in production.

The full handler atomically consumes browser-bound state, issues opaque HttpOnly sessions, bounds
their validity to provider expiry and checks introspection by default. Expiry-only validity is an
explicit option. Application permissions, local-account lifecycle, CORS, rate limiting and CSRF
for application mutations are deployment responsibilities.

Legacy account linking requires an explicit proof/approval adapter; matching emails alone is not
authorization. Protect unique identity constraints and revalidate approval inside the link transaction.

Report suspected vulnerabilities privately to the package maintainer through the contact on its
npm profile or repository private advisory channel once configured. Do not include live tokens,
secrets, candidate personal data or full callback URLs in a public issue.
