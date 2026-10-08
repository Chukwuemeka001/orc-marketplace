import argparse
import importlib
import json
import os
import sys

from workbench import brief

COMMANDS = ("new", "import-orc", "preflight", "graph", "explain")


MODULES = {"import-orc": "orc_import", "preflight": "preflight", "graph": "graph", "explain": "explain"}


def build_parser():
    p = argparse.ArgumentParser(prog="workbench", description="Plan and preflight work briefs.")
    sub = p.add_subparsers(dest="cmd", required=True, metavar="command")
    s = sub.add_parser("new", help="write a skeleton brief")
    s.add_argument("path")
    s.add_argument("--type", choices=("code", "frontend", "research", "docs"))
    s = sub.add_parser("import-orc", help="convert an orc state.json into a brief")
    s.add_argument("state")
    s.add_argument("-o", "--output", required=True)
    s.add_argument("--version", type=int, choices=(1, 2), default=1, help="2 = a starting version-2 brief (integrator, final gate, gates_only code)")
    s = sub.add_parser("preflight", help="check a brief for planning mistakes")
    s.add_argument("brief")
    s.add_argument("--json", action="store_true")
    s.add_argument("--strict", action="store_true")
    sub.add_parser("graph", help="print a Mermaid graph").add_argument("brief")
    sub.add_parser("explain", help="print a readable plan").add_argument("brief")
    return p


def cmd_new(args):
    if os.path.exists(args.path):
        raise brief.BadInput(f"{args.path}: already exists; refusing to overwrite")
    try:
        with open(args.path, "x", encoding="utf-8") as f:
            f.write(json.dumps(brief.skeleton(version=2, work_type=args.type), indent=2) + "\n")
    except FileExistsError:
        raise brief.BadInput(f"{args.path}: already exists; refusing to overwrite") from None
    except OSError as e:
        raise brief.BadInput(f"{args.path}: cannot write ({e.strerror or e.__class__.__name__})") from None
    return 0


def dispatch(args):
    if args.cmd == "new":
        return cmd_new(args)
    name = "workbench." + MODULES.get(args.cmd, args.cmd.replace("-", "_"))
    try:
        module = importlib.import_module(name)
    except ModuleNotFoundError as e:
        if e.name == name:
            print(f"workbench: {args.cmd}: not implemented", file=sys.stderr)
            return 2
        raise
    return module.command(args)


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        return dispatch(args)
    except brief.BadInput as e:
        print(f"workbench: {e}", file=sys.stderr)
    except Exception as e:
        msg = " ".join(str(e).split())
        print(f"workbench: internal error: {type(e).__name__}: {msg}", file=sys.stderr)
    return 2
