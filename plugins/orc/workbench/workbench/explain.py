from workbench import brief as briefmod
from workbench import graphutil


def _mins(x):
    return str(int(x)) if float(x).is_integer() else str(x)


def _uses(nodes, items):
    out = {}
    for n in nodes:
        for item in items(n):
            out.setdefault(item, [])
            if n["id"] not in out[item]:
                out[item].append(n["id"])
    return out


def _first_line(text):
    lines = text.strip().splitlines()
    return lines[0] if lines else ""


def _plural(k, word):
    return f"{k} {word}" if k == 1 else f"{k} {word}s"


def _verification(n, b=None):
    wt = n["work_type"]
    if wt == "frontend":
        bc = n.get("browser_check")
        target = bc.get("target", "") if isinstance(bc, dict) else ""
        if not target.strip():
            what = "browser check missing"
        else:
            what = f"browser {target}, {_plural(len(bc.get('steps', [])), 'step')}"
    elif wt == "research":
        src = n.get("sources") or []
        claims = n.get("claims_check") or ""
        if len(claims) > 60:
            claims = claims[:60] + "…"
        what = (_plural(len(src), "source") if src else "no sources") + f", claims: {claims or '(none)'}"
    elif wt == "docs":
        entries = n.get("checked_against") or []
        facts = [e for e in entries if e.startswith("fact:")]
        others = [e for e in entries if not e.startswith("fact:")]
        if not entries:
            what = "checked against nothing"
        else:
            parts = []
            if others:
                parts.append(", ".join(others))
            if facts:
                parts.append(_plural(len(facts), "fact"))
            what = "checked against " + ", ".join(parts)
    else:
        what = "runnable check"
    if b is not None and briefmod.verify_mode(b, n) == "gates_only":
        g = briefmod.covering_gate(b, n["id"], graphutil.ancestors)
        return f"{n['id']} [{wt}] {what} — verified at gate {g['id']} by {g['verifier']} (gates only)" if g else f"{n['id']} [{wt}] {what} — gates only, but NO gate covers it"
    return f"{n['id']} [{wt}] {what} — verified by {n['verifier'] or '(nobody)'}"


def render(b):
    out = []

    def section(title, lines):
        out.append(title)
        out.extend(lines or ["(none)"])
        out.append("")

    section("Goal", [b["goal"]] if b["goal"] else [])
    ph = b["phase"]
    section("Phase being planned", [f"{ph['name']} — {ph['objective']}"] if ph["name"] or ph["objective"] else [])

    later = []
    for p in b["later_phases"]:
        later.append(f"{p['name']} — {p['goal']}")
        later.extend(f"  requires: {r}" for r in p["requires"])
    section("Later phases", later)

    v2 = b["workbench_brief"] == 2
    layers = graphutil.waves(b)
    if layers is None:
        section("Waves", ["cannot order: dependency cycle"])
        if v2:
            section("Verification", [_verification(n, b) for n in b["nodes"]])
        section("Critical path", ["cannot order: dependency cycle"])
    else:
        section("Waves", [f"Wave {i}: {', '.join(w)}" for i, w in enumerate(layers, 1)])
        if v2:
            section("Verification", [_verification(n, b) for n in b["nodes"]])
        path, total = graphutil.critical_path(b)
        section("Critical path", [f"{' -> '.join(path)} ({_mins(total)} min)"] if path else [])

    section("Gates", [
        f"{g['id']} [{g['kind']}] after {', '.join(g['after']) or '-'}"
        f" — verifier: {g['verifier']} — check: {_first_line(g['check'])}"
        for g in b["gates"]
    ])
    section("Open decisions", [
        f"{d['id']} ({d['reversibility']}): {d['question']}"
        for d in b["decisions"] if d["status"] == "open"
    ] or ["none"])

    nodes = b["nodes"]
    out.append("Needs your approval")
    groups = (
        ("Effects:", _uses(nodes, lambda n: [e for e in n["effects"] if e not in briefmod.LOCAL_EFFECTS])),
        ("Credentials:", _uses(nodes, lambda n: [f"{c['name']} ({c['kind']})" for c in n["credentials"]])),
        ("Tools:", _uses(nodes, lambda n: n["tools"])),
    )
    for title, uses in groups:
        out.append(title)
        if uses:
            out.extend(f"  {k} — used by {', '.join(ids)}" for k, ids in uses.items())
        else:
            out.append("  none")
    out.append("")
    return "\n".join(out)


def command(args):
    print(render(briefmod.load_brief(args.brief)))
    return 0
