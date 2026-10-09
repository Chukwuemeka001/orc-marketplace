# orc — orchestrate a project inside Claude Code

A Claude Code mod. You describe what you want; orc interviews you, shows you its understanding and a plan with the
rules it recommends, and starts nothing until you approve both. Then your session orchestrates the work: builders in
their own clones of your repository, a check on every return, independent verifiers, merge only on acceptance.

```bash
claude plugin marketplace add Chukwuemeka001/orc-marketplace
```
```bash
claude plugin install orc@orc
```

Then start a new session in a folder for the work and type `/orc begin <what you want>`.

Requirements, quickstart, modes, commands, configuration and limits: [plugins/orc/README.md](plugins/orc/README.md).
Changes by version: [plugins/orc/CHANGELOG.md](plugins/orc/CHANGELOG.md).

Needs Claude Code with mods: terminal v2.1.287 or later, or the Desktop app's Code tab from v2.1.286. Tested on macOS.
