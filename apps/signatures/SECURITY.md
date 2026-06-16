# Security Policy

## Supported Versions

Security fixes target the latest published `@hasna/signatures` release and the `main`
branch.

## Reporting A Vulnerability

Report vulnerabilities privately to security@hasna.com. Include:

- affected version or commit
- reproduction steps
- impact
- whether credentials, documents, or signer data are exposed

Please do not open public issues for vulnerabilities involving secrets, document access,
signature evidence, provider credentials, or signing links.

## Deployment Notes

The REST server should be treated as a trusted local/private service unless you put it
behind authentication, TLS, authorization, and a restrictive file access policy. Signing
links and completion certificates are evidence artifacts and should be handled as private
documents.
