<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/logo-light.svg">
    <img alt="phone-a-friend" src="assets/logo-dark.svg" width="480">
  </picture>

  <p><em>When your AI needs a second opinion.</em></p>

  [![CI](https://github.com/freibergergarcia/phone-a-friend/actions/workflows/ci.yml/badge.svg)](https://github.com/freibergergarcia/phone-a-friend/actions/workflows/ci.yml)
  [![License: MIT](https://img.shields.io/github/license/freibergergarcia/phone-a-friend)](LICENSE)
  ![Python 3.10+](https://img.shields.io/badge/python-%E2%89%A53.10-blue)
  [![Website](https://img.shields.io/badge/website-phone--a--friend-blue)](https://freibergergarcia.github.io/phone-a-friend/)

</div>

`phone-a-friend` is a CLI relay that lets AI coding agents collaborate. Claude delegates tasks — code reviews, file edits, analysis, refactoring — to a backend AI (Codex or Gemini) and brings the results back into the current session.

```
  Claude ──> phone-a-friend ──> Codex / Gemini          (one-shot relay)
  Claude ──> phone-a-team ──> iterate with backend(s)   (iterative refinement)
```

## Quick Start

**Prerequisites:** Python 3.10+ and at least one backend CLI:

```bash
npm install -g @openai/codex       # Codex
npm install -g @google/gemini-cli  # Gemini (or both)
```

**Install & use:**

```bash
git clone https://github.com/freibergergarcia/phone-a-friend.git
cd phone-a-friend
./phone-a-friend install --claude
```

Then from Claude Code:

```
/phone-a-friend Ask codex to review the error handling in relay.py
/phone-a-team Refactor the backend registry for extensibility
```

## Documentation

Full usage guide, examples, CLI reference, and configuration details:

**[freibergergarcia.github.io/phone-a-friend](https://freibergergarcia.github.io/phone-a-friend/)**

## Contributing

All changes go through pull requests — no direct pushes to `main`.

1. **Branch off main** using a prefix: `feature/`, `fix/`, `improve/`, or `chore/`
2. **Open a PR** against `main`
3. **CI must pass** before merge
4. PRs are **squash-merged** (one commit per change, clean linear history)
5. Head branches are auto-deleted after merge

## Tests

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

## License

MIT. See `LICENSE`.
