import json
import os

from workbench import brief


def _dict(v):
    return v if isinstance(v, dict) else {}


def _list(v):
    return v if isinstance(v, list) else []


def convert(state, path, version=1):
    u = _dict(_dict(state).get("understanding"))
    plan = _dict(u.get("plan"))
    onodes = plan.get("nodes")
    if not isinstance(onodes, list) or not onodes:
        raise brief.BadInput(f"{path}: no orc gate-2 plan (understanding.plan.nodes missing)")
    pol = _dict(u.get("executionPolicy"))
    attempts = pol.get("maxAttemptsPerNode", 1)
    retries = max(attempts - 1, 0) if isinstance(attempts, (int, float)) else 0
    agents = pol.get("maxAgents", 1)
    minutes = pol.get("maxDurationMinutes", 0)
    effects = _list(pol.get("allowedEffects"))
    reviewers = [r for r in _list(_dict(u.get("team")).get("roles"))
                 if isinstance(r, dict) and r.get("kind") == "reviewer"]
    est = round(minutes / len(onodes), 1) if isinstance(minutes, (int, float)) else 0

    def verifier(nid):
        for r in reviewers:
            if nid in _list(r.get("nodeIds")) and isinstance(r.get("id"), str):
                return r["id"]
        return ""

    nodes = []
    for n in onodes:
        n = _dict(n)
        nodes.append({
            "id": n.get("id"),
            "role": "builder",
            "work_type": "code",
            "objective": n.get("objective", ""),
            "inputs": [],
            "outputs": [],
            "paths": n.get("resourceKeys", []),
            "depends_on": n.get("dependsOn", []),
            "check": "\n".join(x for x in _list(n.get("acceptanceChecks")) if isinstance(x, str)),
            "verifier": verifier(n.get("id")),
            "effects": effects,
            "tools": [],
            "credentials": [],
            "criteria": n.get("criterionIds", []),
            "estimate_minutes": est,
        })
    criteria = [{"id": c.get("id"), "text": c.get("description")}
                for c in _list(_dict(u.get("finalPicture")).get("criteria")) if isinstance(c, dict)]
    out = {
        "workbench_brief": 1,
        "goal": _dict(u.get("mission")).get("statement", ""),
        "phase": {"name": "", "objective": ""},
        "later_phases": [],
        "criteria": criteria,
        "decisions": [],
        "policy": {
            "retry_budget_per_node": retries,
            "max_parallel": agents,
            "ping": "failures_only",
            "caps": {"max_agents": agents, "max_retries_per_node": retries, "max_minutes": minutes},
            "allowed_effects": effects,
        },
        "nodes": nodes,
        "gates": [],
    }
    if version == 2:
        out = _as_v2(out, u, reviewers)
    return brief.validate(out, path)


def _as_v2(out, u, reviewers):
    """A starting brief, not a finished one: orc's approved plan plus what the Workbench needs to run it unattended —
    a phase named after the mission, an integrator that makes every node's check pass together, a final gate after it,
    and gates_only verification for code (each code node merges on its own check; the final gate's independent verifier
    covers all of them). Preflight then lists what is still missing."""
    nodes = out["nodes"]
    ids = {n["id"] for n in nodes}
    iid = "integrate" if "integrate" not in ids else "integrate-all"
    reviewer = reviewers[0]["id"] if reviewers and isinstance(reviewers[0].get("id"), str) else "final-reviewer"
    statement = out["goal"]
    e2e = "bash ops/integration/check.sh"
    out["workbench_brief"] = 2
    out["phase"] = {"name": "build", "objective": statement[:200]}
    out["policy"]["verify"] = {"code": "gates_only"}
    integrator_inputs = [p for n in nodes for p in n["paths"]]
    nodes.append({
        "id": iid,
        "role": "integrator",
        "work_type": "code",
        "objective": "Integrate the work of every node: write or update ops/integration/check.sh, the end-to-end check of the mission's criteria at HEAD, and make it and every node's check pass together. Report defects in other nodes' work; do not fix them.",
        "inputs": integrator_inputs,
        "outputs": ["ops/integration/check.sh"],
        "paths": ["ops/integration/"],
        "depends_on": sorted(ids),
        "check": "\n".join(dict.fromkeys([ln for n in nodes for ln in n["check"].splitlines() if ln.strip()] + [e2e])),
        "verifier": reviewer,
        "effects": out["policy"]["allowed_effects"] or ["local_read", "local_write"],
        "tools": [],
        "credentials": [],
        "criteria": [c["id"] for c in out["criteria"] if c.get("id")],
        "estimate_minutes": max((n["estimate_minutes"] for n in nodes), default=0),
    })
    out["gates"] = [{"id": "final", "kind": "final", "after": [iid], "check": e2e, "verifier": reviewer}]
    for n in nodes:
        if not n["verifier"]:
            n["verifier"] = reviewer
    # The time cap covers the critical path with every retry: spread it over the longest chain.
    deps = {n["id"]: n["depends_on"] for n in nodes}
    memo = {}
    def depth(i, seen=()):
        if i in memo:
            return memo[i]
        if i in seen:
            return 1
        memo[i] = 1 + max((depth(d, seen + (i,)) for d in deps.get(i, []) if d in deps), default=0)
        return memo[i]
    chain = max((depth(i) for i in deps), default=1)
    cap = out["policy"]["caps"]["max_minutes"] or 0
    retries = out["policy"]["retry_budget_per_node"]
    if isinstance(cap, (int, float)) and cap > 0:
        est = max(1, int(cap // (chain * (1 + retries))))
        for n in nodes:
            n["estimate_minutes"] = est
    # orc's approved constraints are hard decisions already taken; its recommended rules are easy-to-change ones.
    decisions = []
    for i, text in enumerate(_list(_dict(u.get("finalPicture")).get("constraints")), 1):
        if isinstance(text, str) and text.strip():
            decisions.append({"id": f"d{i}", "question": "approved constraint", "choice": text.strip(), "reversibility": "hard", "status": "decided"})
    for o in _list(u.get("options")):
        o = _dict(o)
        if isinstance(o.get("field"), str):
            decisions.append({"id": f"d{len(decisions) + 1}", "question": o["field"], "choice": str(o.get("chosen", "")), "reversibility": "easy", "status": "decided"})
    out["decisions"] = decisions
    return out


def command(args):
    state = brief.load_json(args.state)
    out = convert(state, args.state, getattr(args, 'version', 1) or 1)
    parent = os.path.dirname(args.output)
    try:
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(json.dumps(out, indent=2) + "\n")
    except OSError as e:
        raise brief.BadInput(f"{args.output}: cannot write ({e.strerror or e.__class__.__name__})") from None
    print(f"imported {len(out['nodes'])} nodes from {args.state} -> {args.output}")
    return 0
