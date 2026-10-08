import os
import re
import shlex
import shutil

from workbench import brief, graphutil
from workbench.brief import LOCAL_EFFECTS, PROFILE_FIELDS

BUILTINS = {"cd", "test", "[", "export", "set", "for", "if"}
LEAD = re.compile(r"^(cd\s+\S+\s*(&&|;)|;)\s*")
ENVSET = re.compile(r"^[A-Za-z_]\w*=\S*$")
PIPE = re.compile(r"(?<!\|)\|(?!\|)")
TARGET = re.compile(r"^(https?|file)://\S+$")
CITE = ("cite", "[src")
LATE_KEYS = ("nodes", "paths", "checks", "check", "files")


def _num(x):
    return str(int(x)) if float(x) == int(x) else f"{x:g}"


def _norm(p):
    p = p.strip()
    while p.startswith("./"):
        p = p[2:]
    return p


def _covers(a, b):
    a, b = _norm(a), _norm(b)
    if not a or not b:
        return False
    if a == b:
        return True
    d = a if a.endswith("/") else a + "/"
    return b.startswith(d)


def _overlap(a, b):
    return _covers(a, b) or _covers(b, a)


def _lines(text):
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def _tokens(line):
    try:
        return shlex.split(line)
    except ValueError:
        return line.split()


def _is_test_file(tok):
    base = os.path.basename(tok.strip("\"'"))
    if not os.path.splitext(base)[1]:
        return False
    return base.startswith("test_") or ".test." in base or "_test." in base


def _strip_subst(line):
    """Replace each $(...) (nested, quote-aware enough for checks) and `...` span with the word SUBST, so that splitting a
    line into words never cuts through a command substitution (D=$(mktemp -d) would otherwise yield the word "-d)")."""
    out, i, n = [], 0, len(line)
    while i < n:
        if line.startswith("$(", i):
            depth, j = 1, i + 2
            while j < n and depth:
                if line.startswith("$(", j):
                    depth += 1
                    j += 2
                    continue
                if line[j] == "(":
                    depth += 1
                elif line[j] == ")":
                    depth -= 1
                j += 1
            out.append("SUBST")
            i = j
        elif line[i] == "`":
            j = line.find("`", i + 1)
            out.append("SUBST")
            i = n if j < 0 else j + 1
        else:
            out.append(line[i])
            i += 1
    return "".join(out)


OPERATORS = {"&&", "||", ";", "|", "&"}


def _judge_line(line, base_dir, produced):
    rest = line
    if line in ("true", ":", "exit 0"):
        return f"`{line}` proves nothing"
    if line == "echo" or line.startswith("echo "):
        m = PIPE.search(line)
        if not m:
            return f"`{line}` proves nothing"
        rest = line[m.end():].strip()
    rest = _strip_subst(rest)
    while True:
        m = LEAD.match(rest)
        if not m:
            break
        rest = rest[m.end():]
    toks = _tokens(rest)
    # skip leading assignments (D=SUBST, D=SUBST;) and the operators that follow them (D=$(...) && cmd)
    while toks and (ENVSET.match(toks[0].rstrip(";")) or toks[0] in OPERATORS):
        toks = toks[1:]
    if not toks:
        return f"`{line}` has no command"
    first = toks[0]
    if not (shutil.which(first) or first in BUILTINS or first.startswith(("./", "/", "~", "bin/"))):
        return f"`{line}` starts with `{first}`, which is not a command on PATH"
    for t in _tokens(line):
        if _is_test_file(t):
            path = t.strip("\"'")
            if any(_covers(p, path) for p in produced):
                continue
            if os.path.exists(os.path.join(base_dir, os.path.expanduser(path))):
                continue
            return f"`{line}` runs {path}, which no node lists in outputs or paths and which does not exist"
    return None


def _check_findings(owner, field, text, base_dir, produced):
    """Yield (message, fix) for one check string."""
    lines = _lines(text)
    if not lines:
        return [(f"{field} is empty", f'set {owner}.{field} to a runnable command that fails when the work is wrong, e.g. "python3.11 -m unittest tests.test_x"')]
    out = []
    for ln in lines:
        why = _judge_line(ln, base_dir, produced)
        if why:
            out.append((f"{field} cannot run or proves nothing: {why}",
                        f'replace that line of {owner}.{field} with a real command (e.g. "python3.11 tests/test_x.py") and list the test file in a node\'s outputs'))
    return out


class _Ctx:
    def __init__(self, brief, brief_path):
        self.b = brief
        self.base_dir = os.path.dirname(os.path.abspath(brief_path))
        self.nodes = brief["nodes"]
        self.gates = brief["gates"]
        self.ids = {n["id"] for n in self.nodes}
        self.out = []
        self.anc = {n["id"]: graphutil.ancestors(brief, n["id"]) for n in self.nodes}

    def add(self, cid, sev, where, message, fix):
        self.out.append({"id": cid, "severity": sev, "where": where, "message": message, "fix": fix})


def w01(c):
    ns = c.nodes
    for i, a in enumerate(ns):
        for b in ns[i + 1:]:
            if a["id"] in c.anc[b["id"]] or b["id"] in c.anc[a["id"]]:
                continue
            hit = next(((pa, pb) for pa in a["paths"] for pb in b["paths"] if _overlap(pa, pb)), None)
            if not hit:
                continue
            pa, pb = hit
            extra = "" if pa == pb else f" ({pb})"
            c.add("W01", "block", f"node {a['id']}",
                  f"writes {pa}, also written by {b['id']}{extra} with no dependency",
                  f'add "{a["id"]}" to {b["id"]}.depends_on, or split the path between them')


def w02(c):
    pol = c.b["policy"]
    allowed = pol.get("allowed_effects", ["local_read", "local_write"])
    used = set()
    for n in c.nodes:
        for e in dict.fromkeys(n["effects"]):
            used.add(e)
            if e not in allowed:
                c.add("W02", "block", f"node {n['id']}", f"uses effect {e}, which the policy does not grant",
                      f'add "{e}" to policy.allowed_effects, or remove "{e}" from {n["id"]}.effects')
    if "allowed_effects" in pol:
        for e in dict.fromkeys(pol["allowed_effects"]):
            if e not in LOCAL_EFFECTS and e not in used:
                c.add("W02", "warn", "policy", f"grants effect {e}, which no node uses",
                      f'remove "{e}" from policy.allowed_effects')


def w03(c):
    produced = [p for n in c.nodes for p in n["outputs"] + n["paths"]]
    for n in c.nodes:
        for m, f in _check_findings(f"{n['id']}", "check", n["check"], c.base_dir, produced):
            c.add("W03", "block", f"node {n['id']}", m, f)
    for g in c.gates:
        for m, f in _check_findings(f"{g['id']}", "check", g["check"], c.base_dir, produced):
            c.add("W03", "block", f"gate {g['id']}", m, f)


def w04(c):
    for n in c.nodes:
        v = n["verifier"].strip()
        if not v:
            c.add("W04", "block", f"node {n['id']}", "has no verifier",
                  f'set {n["id"]}.verifier to a reviewer other than the builder, e.g. "reviewer"')
        elif v.lower() in (n["id"].lower(), "self", "builder"):
            c.add("W04", "block", f"node {n['id']}", f'is verified by "{n["verifier"]}", its own builder',
                  f'set {n["id"]}.verifier to an independent reviewer, e.g. "reviewer"')
    for g in c.gates:
        if not g["verifier"].strip():
            c.add("W04", "block", f"gate {g['id']}", "has no verifier",
                  f'set {g["id"]}.verifier to an independent reviewer, e.g. "gate-reviewer"')


def w05(c):
    listed = {x for n in c.nodes for x in n["criteria"]}
    known = {k["id"] for k in c.b["criteria"]}
    for k in c.b["criteria"]:
        if k["id"] not in listed:
            c.add("W05", "block", f"criterion {k['id']}", "is covered by no node",
                  f'add "{k["id"]}" to the criteria list of the node that delivers it')
    first = c.b["criteria"][0]["id"] if c.b["criteria"] else "c1"
    for n in c.nodes:
        cr = n["criteria"]
        if not cr:
            c.add("W05", "warn", f"node {n['id']}", "covers no criterion",
                  f'add a criterion id such as "{first}" to {n["id"]}.criteria, or drop the node')
        elif not any(x in known for x in cr):
            c.add("W05", "warn", f"node {n['id']}", "lists only unknown criterion ids: " + ", ".join(cr),
                  f'replace {n["id"]}.criteria with ids from the brief criteria, e.g. "{first}"')


def w06(c):
    for lp in c.b["later_phases"]:
        n = 0
        found = False
        for k in LATE_KEYS:
            if k in lp:
                found = True
                v = lp[k]
                n += len(v) if isinstance(v, (list, dict, str)) and v else 0
        if found:
            c.add("W06", "warn", f'phase "{lp["name"]}"',
                  f"lists {n} {'file' if n == 1 else 'files'} for a phase that depends on unlearned work",
                  'replace its files and checks with a "requires" list')


def w07(c):
    if not any(n["role"] == "integrator" for n in c.nodes):
        c.add("W07", "block", "brief", "has no integrator node",
              'add a node with role "integrator" that depends on the builders and combines their outputs')
    finals = [g for g in c.gates if g["kind"] == "final"]
    if not finals:
        c.add("W07", "block", "brief", "has no final gate",
              'add a gate with kind "final", after the integrator, with its own check and an independent verifier')
    # An integrator's check already runs on the combined result, so a final gate may re-run it; re-running only
    # builders' checks proves nothing end to end.
    node_lines = {ln for n in c.nodes if n["role"] != "integrator" for ln in _lines(n["check"])}
    for g in finals:
        ls = _lines(g["check"])
        if not ls:
            c.add("W07", "block", f"gate {g['id']}", "final gate has an empty check",
                  f'set {g["id"]}.check to a command that tests the combined result, not one node')
        elif all(ln in node_lines for ln in ls):
            c.add("W07", "block", f"gate {g['id']}", "final gate only re-runs per-node checks",
                  f'change {g["id"]}.check to an end-to-end command on the integrated result')


def w08(c):
    for b in c.nodes:
        for a in c.nodes:
            if a is b or a["id"] in c.anc[b["id"]]:
                continue
            shared = next((i for i in b["inputs"] if i and i in a["outputs"]), None)
            if shared:
                c.add("W08", "block", f"node {b['id']}", f"takes input {shared}, which {a['id']} outputs, with no dependency",
                      f'add "{a["id"]}" to {b["id"]}.depends_on')


def w09(c):
    cyc = graphutil.find_cycle(c.b)
    if cyc:
        c.add("W09", "block", "brief", "dependency cycle " + " -> ".join(cyc),
              f'remove "{cyc[-1]}" from {cyc[-2]}.depends_on')
    for owner, ref in graphutil.unknown_refs(c.b):
        if owner in c.ids:
            c.add("W09", "block", f"node {owner}", f"depends_on names unknown id {ref}",
                  f'remove "{ref}" from {owner}.depends_on, or add a node with id "{ref}"')
        else:
            c.add("W09", "block", f"gate {owner}", f"after names unknown id {ref}",
                  f'remove "{ref}" from {owner}.after, or add a node with id "{ref}"')


def _reach(c, gate):
    gates = {g["id"]: g for g in c.gates}
    seen, todo, nodes = set(), list(gate["after"]), set()
    while todo:
        x = todo.pop()
        if x in seen:
            continue
        seen.add(x)
        if x in c.ids:
            nodes.add(x)
        elif x in gates:
            todo.extend(gates[x]["after"])
    return nodes


def w10(c):
    finals = [g for g in c.gates if g["kind"] == "final"]
    if not finals:
        c.add("W10", "block", "brief", "the brief has no final gate, so nothing verifies the integrated result",
              'add a gate with kind "final" whose after lists the integrator')
    builders = [n for n in c.nodes if n["role"] == "builder"]
    integrators = [n for n in c.nodes if n["role"] == "integrator"]
    for i in integrators:
        if len(integrators) == 1:
            group = builders
        else:
            ins = {x for x in i["inputs"] if x}
            group = [b for b in builders if ins & set(b["outputs"])]
        for b in group:
            if b["id"] not in c.anc[i["id"]]:
                c.add("W10", "block", f"node {i['id']}", f"does not depend on builder {b['id']} whose work it integrates",
                      f'add "{b["id"]}" to {i["id"]}.depends_on')
    for g in finals:
        reached = _reach(c, g)
        for i in integrators:
            if i["id"] not in reached:
                c.add("W10", "block", f"gate {g['id']}", f"final gate does not come after integrator {i['id']}",
                      f'add "{i["id"]}" to {g["id"]}.after')


def w11(c):
    for n in c.nodes:
        for t in dict.fromkeys(n["tools"]):
            if t and shutil.which(t) is None:
                c.add("W11", "block", f"node {n['id']}", f"tool {t} is not on PATH",
                      f'install {t} or put it on PATH, or remove "{t}" from {n["id"]}.tools')


def w12(c):
    for n in c.nodes:
        for cr in n["credentials"]:
            name = cr["name"]
            if cr["kind"] == "env":
                if name in os.environ:
                    continue
                c.add("W12", "block", f"node {n['id']}", f"credential {name} (env) is not set",
                      f"set the environment variable {name} before the run, or remove it from {n['id']}.credentials")
            elif not os.path.exists(os.path.expanduser(name)):
                c.add("W12", "block", f"node {n['id']}", f"credential {name} (file) does not exist",
                      f"create the file {name}, or correct the name in {n['id']}.credentials")


def w13(c):
    pol = c.b["policy"]
    caps = pol["caps"]
    if pol["max_parallel"] > caps["max_agents"]:
        c.add("W13", "block", "policy", f"max_parallel {pol['max_parallel']} > caps.max_agents {caps['max_agents']}",
              f"set policy.max_parallel to {caps['max_agents']} or less, or raise policy.caps.max_agents to {pol['max_parallel']}")
    if pol["retry_budget_per_node"] > caps["max_retries_per_node"]:
        c.add("W13", "block", "policy",
              f"retry_budget_per_node {pol['retry_budget_per_node']} > caps.max_retries_per_node {caps['max_retries_per_node']}",
              f"set policy.retry_budget_per_node to {caps['max_retries_per_node']} or less, or raise policy.caps.max_retries_per_node to {pol['retry_budget_per_node']}")
    path, minutes = graphutil.critical_path(c.b)
    mult = 1 + pol["retry_budget_per_node"]
    total = minutes * mult
    if total > caps["max_minutes"]:
        c.add("W13", "block", "policy",
              f"critical path {_num(minutes)} min x (1 + {pol['retry_budget_per_node']} retries) = {_num(total)} min > caps.max_minutes {_num(caps['max_minutes'])}",
              f"set policy.caps.max_minutes to {_num(total)} or more, or cut estimate_minutes on the critical path ({' -> '.join(path)})")


def w14(c):
    ph = c.b["phase"]
    if not ph["objective"].strip():
        name = ph["name"].strip()
        c.add("W14", "block", f'phase "{name}"' if name else "phase", "no phase planned",
              "write the phase name and objective: set phase.name and phase.objective")
    outputs = {o for n in c.nodes for o in n["outputs"]}
    decided = {d["id"] for d in c.b["decisions"] if d["status"] == "decided"}
    for lp in c.b["later_phases"]:
        for r in lp["requires"]:
            if r not in outputs and r not in decided:
                c.add("W14", "block", f'phase "{lp["name"]}"', f'requires "{r}", which no current node outputs and no decided decision provides',
                      f'add "{r}" to a node\'s outputs, or record and decide a decision with id "{r}"')


def w15(c):
    ds = c.b["decisions"]
    if not ds:
        c.add("W15", "block", "brief", "no decisions recorded",
              "list the hard-to-change decisions (data formats, interfaces, storage, permissions) in decisions, each with reversibility and status")
    for d in ds:
        if d["reversibility"] == "hard" and d["status"] == "open":
            c.add("W15", "block", f"decision {d['id']}", "is hard to reverse and still open",
                  f'decide it now: set decisions {d["id"]}.choice and change its status to "decided"')


def _target_ok(t):
    t = t.strip()
    return bool(TARGET.match(t)) or bool(t and not re.search(r"[\s:]", t))


def w16(c):
    for n in c.nodes:
        if n["work_type"] != "frontend":
            continue
        i, where = n["id"], f"node {n['id']}"
        bc = n.get("browser_check")
        if not isinstance(bc, dict):
            c.add("W16", "block", where, "frontend node has no browser check",
                  f'set {i}.browser_check.target to the page URL or file (e.g. "file://index.html") and list what the browser must show in {i}.browser_check.steps')
            continue
        t = bc.get("target")
        t = t if isinstance(t, str) else ""
        if not _target_ok(t):
            c.add("W16", "block", where, f'browser_check.target "{t}" is not a URL, file:// or path',
                  f'set {i}.browser_check.target to the page URL or file (e.g. "http://localhost:8000/" or "file://index.html")')
        steps = bc.get("steps")
        steps = steps if isinstance(steps, list) else []
        if not steps:
            c.add("W16", "block", where, "browser_check.steps is empty",
                  f'list what the browser must show in {i}.browser_check.steps (e.g. "heading reads Hello", "no console errors")')
        elif any(not isinstance(x, str) or not x.strip() for x in steps):
            c.add("W16", "block", where, "browser_check.steps contains an empty step",
                  f'give every entry of {i}.browser_check.steps text (e.g. "click Save, the list shows 1 row"), or delete the empty one')


def w17(c):
    for n in c.nodes:
        if n["work_type"] != "research":
            continue
        i, where = n["id"], f"node {n['id']}"
        srcs = n.get("sources")
        srcs = [x for x in srcs if isinstance(x, str) and x.strip()] if isinstance(srcs, list) else []
        cc = n.get("claims_check")
        cc = cc if isinstance(cc, str) else ""
        if not srcs:
            c.add("W17", "block", where, "research node declares no sources",
                  f'list the sources {i} draws on in {i}.sources (e.g. "https://docs.python.org/3/library/json.html")')
        if not cc.strip():
            c.add("W17", "block", where, "claims_check is empty",
                  f'list {i}.sources and say in {i}.claims_check how each claim cites one (e.g. "every bullet ends with [src: <source>]")')
        elif not (any(s in cc for s in srcs) or any(w in cc.lower() for w in CITE)):
            c.add("W17", "block", where, "claims_check does not say how claims cite its sources",
                  f'list {i}.sources and say in {i}.claims_check how each claim cites one (e.g. "every bullet ends with [src: <source>]")')


def w18(c):
    for n in c.nodes:
        if n["work_type"] != "docs":
            continue
        ca = n.get("checked_against")
        if not (isinstance(ca, list) and any(isinstance(x, str) and x.strip() for x in ca)):
            i = n["id"]
            c.add("W18", "block", f"node {i}", "docs node lists nothing it is checked against",
                  f'list the source files or facts {i} is checked against in {i}.checked_against (e.g. "src/slug.py", "fact: slugify(\'Hello, World!\') == \'hello-world\'")')


def w19(c):
    for n in c.nodes:
        for t, keys in PROFILE_FIELDS.items():
            if t == n["work_type"]:
                continue
            for k in keys:
                if k in n:
                    c.add("W19", "warn", f"node {n['id']}", f"carries {k}, a {t} field, but is a {n['work_type']} node",
                          f'remove {n["id"]}.{k}, or set {n["id"]}.work_type to "{t}"')


CHECKS = (w01, w02, w03, w04, w05, w06, w07, w08, w09, w10, w11, w12, w13, w14, w15)
FILE_TEST = re.compile(r"""(?:\btest|\[)\s+-[efdsr]\s+("[^"]+"|'[^']+'|[^\s;&|)\]]+)""")


def _repo_root(start):
    """The nearest folder at or above `start` holding .git (briefs often live in ops/); `start` if there is none."""
    d = start
    while True:
        if os.path.isdir(os.path.join(d, ".git")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return start
        d = parent


def w20(c):
    """A check that tests for a file (test -f/-e/-d/-s/-r X, [ -f X ]) no node produces and that does not exist can
    never pass: the node would fail every retry. Variables, absolute paths and negated tests are not judged."""
    root = _repo_root(c.base_dir)
    produced = [p for n in c.nodes for p in list(n.get("outputs") or []) + list(n.get("paths") or [])]
    owners = [(n["id"], f"node {n['id']}", n.get("check") or "") for n in c.nodes]
    owners += [(g["id"], f"gate {g['id']}", g.get("check") or "") for g in c.gates]
    for owner, where, text in owners:
        for m in FILE_TEST.finditer(text):
            raw = m.group(1).strip("\"'")
            if not raw or raw.startswith(("/", "~")) or "$" in raw:
                continue
            path = _norm(raw)
            if any(_covers(x, path) for x in produced):
                continue
            if os.path.exists(os.path.join(root, path)) or os.path.exists(os.path.join(c.base_dir, path)):
                continue
            c.add("W20", "block", where,
                  f"check tests for {path}, which no node outputs or may change and which does not exist",
                  f"add {path} to the outputs and paths of the node that should create it, or remove that test from {owner}'s check")


def w21(c):
    """Front-end, research and docs work set to gates_only: their profiles need a per-node check (a browser check,
    claims tied to sources, a review against the facts) that a gate's general verifier will not do."""
    for n in c.nodes:
        if n["work_type"] != "code" and brief.verify_mode(c.b, n) == "gates_only":
            i = n["id"]
            c.add("W21", "warn", f"node {i}", f"{n['work_type']} node is verified at the gates only; its profile check needs a per-node verifier",
                  f'set {i}.verify to "per_node" (or policy.verify.{n["work_type"]} to "per_node")')


def w22(c):
    """A gates_only node that no gate covers would never be verified independently."""
    for n in c.nodes:
        if brief.verify_mode(c.b, n) == "gates_only" and brief.covering_gate(c.b, n["id"], graphutil.ancestors) is None:
            i = n["id"]
            c.add("W22", "block", f"node {i}", "is verified at the gates only, but no gate covers it",
                  f'add {i} (or a node that depends on it) to a gate\'s after list, or set {i}.verify to "per_node"')


PROFILE_CHECKS = (w16, w17, w18, w19, w20, w21, w22)


def run_checks(brief, brief_path):
    c = _Ctx(brief, brief_path)
    for fn in CHECKS:
        fn(c)
    if brief["workbench_brief"] == 2:
        for fn in PROFILE_CHECKS:
            fn(c)
    return c.out
