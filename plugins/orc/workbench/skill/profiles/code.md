# Profile: code

Brief version 1 or 2. The code profile has no extra fields; it is verified by a runnable check. Example brief: `skill/examples/v2/code.json`.

## Requires
- `check`: a command that exits non-zero when the code is wrong, e.g. `python3.11 -m unittest tests.test_duration`. Not prose, not `true`, not `echo ...`.
- The test file the check runs is in the node's `outputs` and `paths`.
- `verifier`: someone other than the builder.

## Fields
None beyond the v1 node keys. A profile field on a code node (`browser_check`, `sources`, `claims_check`, `checked_against`) only draws W19, a warning.

## Check and fix
- W03 (block): the check cannot run or proves nothing. Fix: replace that line of `check` with a real command and list the test file in a node's `outputs`.
- W04 (block): the verifier is empty or is the builder. Fix: set `verifier` to an independent reviewer.

## What the verifier must do
Run the check, read the tests, and confirm they would fail if the code were wrong. Send back the named defect, not a general complaint.

## Worked example
Broken node (`n1` in `skill/examples/v2/code.json` with `check` set to `tests cover c1` and `verifier` set to `n1`):

```
$ python3.11 -m workbench preflight code_bad.json
BLOCK W03 node n1: check cannot run or proves nothing: `tests cover c1` starts with `tests`, which is not a command on PATH
  fix: replace that line of n1.check with a real command (e.g. "python3.11 tests/test_x.py") and list the test file in a node's outputs
BLOCK W04 node n1: is verified by "n1", its own builder
  fix: set n1.verifier to an independent reviewer, e.g. "reviewer"
preflight: 2 block, 0 warn -> NOT READY
```

Fixed: `"check": "python3.11 -m unittest tests.test_duration"`, `"verifier": "code-reviewer"`.

```
$ python3.11 -m workbench preflight skill/examples/v2/code.json
preflight: 0 block, 0 warn -> READY
$ python3.11 -m workbench explain skill/examples/v2/code.json
...
n1 [code] runnable check — verified by code-reviewer
```
