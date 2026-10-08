# Profile: frontend

Version-2 briefs only. A frontend node is verified by a browser check declared as a structured field. Example brief: `skill/examples/v2/frontend.json`.

## Requires
- `browser_check` with a `target` and at least one step.
- `check`: a runnable command for what is static (here `python3.11 test/page_static.py`).
- `verifier`: someone who opens the page in a browser and runs the steps.

## Fields
`browser_check`: `{"target": str, "steps": [str]}`, both keys required inside the object.
- `target`: `http://` or `https://` or `file://` URL, or a path with no spaces and no `:`.
- `steps`: what the browser must show, one concrete behaviour each (an input and the exact text expected, no console errors, narrow-width layout). No empty strings.

## Check and fix
W16 (block): `frontend node has no browser check`, or the target is not a URL, `file://` or path, or the steps are empty. Fix: set `browser_check.target` to the page URL or file (e.g. `file://index.html`) and list what the browser must show in `browser_check.steps`.

## What the verifier must do
Open `target` in a real browser and perform each step in order. Report each step as passed or failed with what the page showed. The Workbench never opens the page itself.

## Worked example
Broken node: `n1` in `skill/examples/v2/frontend.json` with `browser_check` removed.

```
$ python3.11 -m workbench preflight frontend_bad.json
BLOCK W16 node n1: frontend node has no browser check
  fix: set n1.browser_check.target to the page URL or file (e.g. "file://index.html") and list what the browser must show in n1.browser_check.steps
preflight: 1 block, 0 warn -> NOT READY
```

Fixed node:

```json
"browser_check": {
  "target": "file://index.html",
  "steps": [
    "type 100 in the input: the page shows '212 F'",
    "clear the input: an error message shows and the page text has no NaN",
    "at 375px width there is no horizontal scroll"
  ]
}
```

```
$ python3.11 -m workbench preflight skill/examples/v2/frontend.json
preflight: 0 block, 0 warn -> READY
$ python3.11 -m workbench explain skill/examples/v2/frontend.json
...
n1 [frontend] browser file://index.html, 3 steps — verified by browser-reviewer: opens the page and runs every browser_check step
```
