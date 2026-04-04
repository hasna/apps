# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do not open a public GitHub issue** for security vulnerabilities.

Please send details privately:

1. **Email**: Send to the maintainer directly via GitHub.
2. **GitHub Security Advisories**: Use the [Security Advisories](https://github.com/hasna/knowledge/security/advisories/new) feature to report privately.

Include in your report:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

## Response Timeline

- **Acknowledgment**: within 48 hours
- **Initial assessment**: within 5 days
- **Fix timeline**: depends on severity; critical issues are addressed immediately

## Scope

This project stores data in a local JSON file (`~/.open-knowledge/db.json` by default). Security considerations:

- Store file permissions should be restricted to the owner
- No network access or remote code execution
- No authentication (local CLI tool)
- Encryption of the store file is not currently implemented
