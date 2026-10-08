# Profile: research

Version-2 briefs only. A research node declares its sources and how each claim cites one. Example brief: `skill/examples/v2/research.json`.

## Requires
- `sources`: at least one.
- `claims_check`: says how a claim cites its sources.
- `check`: a command that fails if a claim lacks a citation (here every bullet must end with `[src: URL]`).
- `effects` includes `network` if the builder fetches sources, and `policy.allowed_effects` grants it (W02).

## Fields
- `sources`: `[str]`, URLs or file paths the node draws on.
- `claims_check`: `str`, a rule that either contains one of the node's sources verbatim or contains `cite` or `[src` (any case). Example: `every bullet ends with [src: <source>]`.

## Check and fix
W17 (block): `research node declares no sources`; `claims_check is empty`; or `claims_check does not say how claims cite its sources`. Fix: list `sources` and say in `claims_check` how each claim cites one (e.g. `every bullet ends with [src: <source>]`).

## What the verifier must do
Open every cited source and confirm it states the claim it is attached to. A claim with no citation, or a source that does not say it, is a defect to send back.

## Worked example
Broken node: `n1` in `skill/examples/v2/research.json` with `claims_check` set to `be careful`.

```
$ python3.11 -m workbench preflight research_bad.json
BLOCK W17 node n1: claims_check does not say how claims cite its sources
  fix: list n1.sources and say in n1.claims_check how each claim cites one (e.g. "every bullet ends with [src: <source>]")
preflight: 1 block, 0 warn -> NOT READY
```

Fixed node:

```json
"sources": ["https://semver.org/spec/v2.0.0.html"],
"claims_check": "every bullet ends with [src: https://semver.org/spec/v2.0.0.html]"
```

```
$ python3.11 -m workbench preflight skill/examples/v2/research.json
preflight: 0 block, 0 warn -> READY
$ python3.11 -m workbench explain skill/examples/v2/research.json
...
n1 [research] 1 source, claims: every bullet ends with [src: https://semver.org/spec/v2.0.0.… — verified by research-reviewer: opens every cited source and confirms it states the bullet it is attached to
```

`explain` cuts `claims_check` to 60 characters.
