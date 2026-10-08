# Profile: docs

Version-2 briefs only. A docs node names what it is checked against. Example brief: `skill/examples/v2/docs.json`.

## Requires
- `checked_against`: at least one entry.
- `check`: a command that runs or compares the documented examples.
- `verifier`: a reviewer who compares each statement and number with the real behaviour.

## Fields
`checked_against`: `[str]`, source files or facts. An entry starting `fact:` is a fact (`fact: slugify('Hello, World!') == 'hello-world'`); any other entry is listed as a file.

## Check and fix
W18 (block): `docs node lists nothing it is checked against`. Fix: list the source files or facts the node is checked against in `checked_against`.

## What the verifier must do
Run each documented example, compare its output with the text, and compare every number and claim with the files and facts in `checked_against`. Report each mismatch with the line in the docs.

## Worked example
Broken node: `n1` in `skill/examples/v2/docs.json` with `checked_against` removed.

```
$ python3.11 -m workbench preflight docs_bad.json
BLOCK W18 node n1: docs node lists nothing it is checked against
  fix: list the source files or facts n1 is checked against in n1.checked_against (e.g. "src/slug.py", "fact: slugify('Hello, World!') == 'hello-world'")
preflight: 1 block, 0 warn -> NOT READY
```

Fixed node:

```json
"checked_against": ["src/slug.py", "fact: slugify('Hello, World!') == 'hello-world'"]
```

```
$ python3.11 -m workbench preflight skill/examples/v2/docs.json
preflight: 0 block, 0 warn -> READY
$ python3.11 -m workbench explain skill/examples/v2/docs.json
...
n1 [docs] checked against src/slug.py, 1 fact — verified by docs-reviewer: runs each README example and compares the output with the text
```
