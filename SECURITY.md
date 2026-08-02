# Security policy

## Reporting a vulnerability

Please do not report security vulnerabilities in public issues. Report them
privately through the repository's GitHub Security Advisories page.

Include the affected version, reproduction steps, impact, and any suggested
mitigation.

We will acknowledge reports as soon as practical and coordinate disclosure
after a fix is available.

## Scope

The compiler writes generated output inside the selected project root. It reads
the `.ai/` workspace and adapter packages supplied by the project. Do not run
untrusted adapters or manifests in a privileged environment.
