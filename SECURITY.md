# Security Policy

## Supported versions

Fixes land in the latest release on npm
(`@freibergergarcia/phone-a-friend`). Older versions do not receive backports;
upgrade with `npm install -g @freibergergarcia/phone-a-friend`.

## Reporting a vulnerability

Report vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/freibergergarcia/phone-a-friend/security/advisories/new).
Do not open a public issue, pull request or discussion with exploit details.

Include the PaF version, operating system, host and backend CLI versions, the
command shape, and the smallest reproduction you have. Redact credentials,
private prompts and repository contents.

This is a single-maintainer project, so handling is best-effort: expect an
acknowledgement within a week. Confirmed issues are fixed in a new release and
disclosed through a GitHub security advisory once the release is available.

## Scope

In scope:

- A relay or review running with more access than the requested `--sandbox`
  where PaF claims to enforce it, for example Claude tool lists, pi tool
  allowlists, or Codex sandbox flags on start and resume.
- Bypasses of the recursion and depth guards (`PHONE_A_FRIEND_DEPTH`,
  `PHONE_A_FRIEND_HOST`, `PI_CODING_AGENT`).
- Shell or argument injection through prompts, labels, paths or configuration.
- Installer or uninstaller writes, removals or symlinks outside the documented
  host directories, or removal of files PaF does not own.
- Credentials or other unrequested local data leaking into relay payloads, task
  records, session stores or logs.

Out of scope:

- Vulnerabilities in the backend CLIs or model providers themselves; report
  those to the respective vendor.
- Limits PaF documents as not enforced: Gemini Plan Mode is best-effort, pi's
  sandbox is a tool allowlist rather than OS isolation, agentic sandbox modes are
  Claude tool policies, and `danger-full-access` grants full access by design.
- Content a caller deliberately passes with `--prompt`, `--context-file`,
  `--context-text` or `--include-diff`.
