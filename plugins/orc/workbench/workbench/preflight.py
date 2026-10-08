import json

from workbench import brief as briefmod
from workbench import checks


def command(args):
    b = briefmod.load_brief(args.brief)
    findings = checks.run_checks(b, args.brief)
    nblock = sum(1 for f in findings if f["severity"] == "block")
    nwarn = len(findings) - nblock
    ready = nblock == 0 and not (args.strict and nwarn)
    if args.json:
        print(json.dumps({"ready": ready, "findings": findings}, indent=2))
    else:
        for f in findings:
            print(f"{f['severity'].upper():<5} {f['id']} {f['where']}: {f['message']}")
            print(f"  fix: {f['fix']}")
        print(f"preflight: {nblock} block, {nwarn} warn -> {'READY' if ready else 'NOT READY'}")
    return 0 if ready else 1
