import json

EFFECTS = ("local_read", "local_write", "network", "publication", "messaging", "spend", "client_data")
LOCAL_EFFECTS = {"local_read", "local_write"}
VERIFY_MODES = ("per_node", "gates_only")
WORK_TYPES = ("code", "frontend", "research", "docs")
PROFILE_FIELDS = {"frontend": ["browser_check"], "research": ["sources", "claims_check"], "docs": ["checked_against"], "code": []}


class BadInput(Exception):
    pass


def load_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise BadInput(f"{path}: file not found") from None
    except json.JSONDecodeError as e:
        raise BadInput(f"{path}: not valid JSON ({e.msg} at line {e.lineno} column {e.colno})") from None
    except (OSError, UnicodeDecodeError) as e:
        raise BadInput(f"{path}: cannot read ({e.__class__.__name__})") from None


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _strs(v):
    return isinstance(v, list) and all(isinstance(x, str) for x in v)


def validate(data, path):
    def bad(where, problem):
        raise BadInput(f"{path}: {where} {problem}")

    def obj(v, where):
        if not isinstance(v, dict):
            bad(where, "must be an object")
        return v

    def get(d, key, where):
        if key not in d:
            bad(f"{where}.{key}" if where else key, "is missing")
        return d[key]

    def string(d, key, where):
        v = get(d, key, where)
        if not isinstance(v, str):
            bad(f"{where}.{key}" if where else key, "must be a string")

    def strlist(d, key, where):
        v = get(d, key, where)
        if not _strs(v):
            bad(f"{where}.{key}", "must be a list of strings")

    def enum(d, key, where, allowed):
        v = get(d, key, where)
        if not isinstance(v, str) or v not in allowed:
            bad(f"{where}.{key}", "must be one of " + ", ".join(allowed))

    def items(d, key):
        v = get(d, key, "")
        if not isinstance(v, list):
            bad(key, "must be a list")
        return v

    def effects(v, where):
        if not isinstance(v, list) or not all(isinstance(x, str) and x in EFFECTS for x in v):
            bad(where, "must be a list of effects (" + ", ".join(EFFECTS) + ")")

    def unique(seq, key, where):
        seen = set()
        for i, x in enumerate(seq):
            if x[key] in seen:
                bad(f"{where}[{i}].{key}", f"duplicates id {x[key]!r}")
            seen.add(x[key])

    obj(data, "brief")
    v = get(data, "workbench_brief", "")
    if not _int(v) or v not in (1, 2):
        bad("workbench_brief", "must be 1 or 2")
    string(data, "goal", "")

    phase = obj(get(data, "phase", ""), "phase")
    string(phase, "name", "phase")
    string(phase, "objective", "phase")

    for i, lp in enumerate(items(data, "later_phases")):
        w = f"later_phases[{i}]"
        obj(lp, w)
        string(lp, "name", w)
        string(lp, "goal", w)
        strlist(lp, "requires", w)

    for i, c in enumerate(items(data, "criteria")):
        w = f"criteria[{i}]"
        obj(c, w)
        string(c, "id", w)
        string(c, "text", w)

    for i, d in enumerate(items(data, "decisions")):
        w = f"decisions[{i}]"
        obj(d, w)
        for k in ("id", "question", "choice"):
            string(d, k, w)
        enum(d, "reversibility", w, ("hard", "easy"))
        enum(d, "status", w, ("decided", "open"))

    pol = obj(get(data, "policy", ""), "policy")
    for k in ("retry_budget_per_node", "max_parallel"):
        if not _int(get(pol, k, "policy")):
            bad(f"policy.{k}", "must be an integer")
    enum(pol, "ping", "policy", ("every_node", "failures_only", "phase_end"))
    caps = obj(get(pol, "caps", "policy"), "policy.caps")
    for k in ("max_agents", "max_retries_per_node"):
        if not _int(get(caps, k, "policy.caps")):
            bad(f"policy.caps.{k}", "must be an integer")
    if not _num(get(caps, "max_minutes", "policy.caps")):
        bad("policy.caps.max_minutes", "must be a number")
    if "allowed_effects" in pol:
        effects(pol["allowed_effects"], "policy.allowed_effects")

    version = v
    if version == 2 and "verify" in pol:
        pv = pol["verify"]
        if isinstance(pv, str):
            if pv not in VERIFY_MODES:
                bad("policy.verify", "must be per_node, gates_only, or a map from work type to one of them")
        elif isinstance(pv, dict):
            for k, m in pv.items():
                if k not in WORK_TYPES or m not in VERIFY_MODES:
                    bad(f"policy.verify.{k}", "must map a work type (" + ", ".join(WORK_TYPES) + ") to per_node or gates_only")
        else:
            bad("policy.verify", "must be per_node, gates_only, or a map from work type to one of them")
    nodes = items(data, "nodes")
    for i, n in enumerate(nodes):
        w = f"nodes[{i}]"
        obj(n, w)
        string(n, "id", w)
        enum(n, "role", w, ("builder", "integrator"))
        enum(n, "work_type", w, ("code", "frontend", "research", "docs"))
        for k in ("objective", "check", "verifier"):
            string(n, k, w)
        for k in ("inputs", "outputs", "paths", "depends_on", "tools", "criteria"):
            strlist(n, k, w)
        effects(get(n, "effects", w), f"{w}.effects")
        creds = get(n, "credentials", w)
        if not isinstance(creds, list):
            bad(f"{w}.credentials", "must be a list")
        for j, c in enumerate(creds):
            cw = f"{w}.credentials[{j}]"
            obj(c, cw)
            string(c, "name", cw)
            enum(c, "kind", cw, ("env", "file"))
        if not _num(get(n, "estimate_minutes", w)) or n["estimate_minutes"] < 0:
            bad(f"{w}.estimate_minutes", "must be a number >= 0")
        if version == 2:
            if "browser_check" in n:
                bc = n["browser_check"]
                if not (isinstance(bc, dict) and isinstance(bc.get("target"), str) and _strs(bc.get("steps"))):
                    bad(f"{w}.browser_check", "must be an object with target (a string) and steps (a list of strings)")
            for k in ("sources", "checked_against"):
                if k in n and not _strs(n[k]):
                    bad(f"{w}.{k}", "must be a list of strings")
            if "claims_check" in n and not isinstance(n["claims_check"], str):
                bad(f"{w}.claims_check", "must be a string")
            if "verify" in n and n["verify"] not in VERIFY_MODES:
                bad(f"{w}.verify", "must be per_node or gates_only")
    unique(nodes, "id", "nodes")

    gates = items(data, "gates")
    for i, g in enumerate(gates):
        w = f"gates[{i}]"
        obj(g, w)
        string(g, "id", w)
        enum(g, "kind", w, ("checkpoint", "final"))
        strlist(g, "after", w)
        string(g, "check", w)
        string(g, "verifier", w)
    unique(gates, "id", "gates")
    return data


def verify_mode(b, n):
    """How a node is verified: per_node (its own verifier before it merges) or gates_only (it merges on its check and
    a gate's independent verifier covers it). Version-1 briefs are always per_node. The node's own `verify` wins, then
    policy.verify for its work type (a map) or for everything (a string)."""
    if b.get("workbench_brief") != 2:
        return "per_node"
    if n.get("verify") in VERIFY_MODES:
        return n["verify"]
    pv = (b.get("policy") or {}).get("verify")
    if isinstance(pv, dict):
        return pv.get(n.get("work_type"), "per_node")
    if pv in VERIFY_MODES:
        return pv
    return "per_node"


def covering_gate(b, node_id, ancestors):
    """The first gate whose `after` list includes the node or something that depends on it."""
    for g in b.get("gates", []):
        if node_id in g["after"] or any(node_id in ancestors(b, a) for a in g["after"]):
            return g
    return None


def load_brief(path):
    return validate(load_json(path), path)


def skeleton(version=1, work_type=None):
    b = {
        "workbench_brief": version,
        "goal": "",
        "phase": {"name": "", "objective": ""},
        "later_phases": [],
        "criteria": [],
        "decisions": [],
        "policy": {
            "retry_budget_per_node": 2,
            "max_parallel": 2,
            "ping": "failures_only",
            "caps": {"max_agents": 3, "max_retries_per_node": 3, "max_minutes": 120},
            "allowed_effects": ["local_read", "local_write"],
        },
        "nodes": [],
        "gates": [],
    }
    if work_type is not None:
        node = {
            "id": "n1",
            "role": "builder",
            "work_type": work_type,
            "objective": "",
            "inputs": [],
            "outputs": [],
            "paths": [],
            "depends_on": [],
            "tools": [],
            "criteria": [],
            "effects": [],
            "credentials": [],
            "check": "",
            "verifier": "",
            "estimate_minutes": 0,
        }
        extra = {"browser_check": {"target": "", "steps": []}, "sources": [], "claims_check": "", "checked_against": []}
        for k in PROFILE_FIELDS[work_type]:
            node[k] = extra[k]
        b["nodes"].append(node)
    return b
