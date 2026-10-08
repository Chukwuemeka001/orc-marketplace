def _deps(brief):
    ids = {n["id"] for n in brief["nodes"]}
    return {n["id"]: [d for d in n["depends_on"] if d in ids] for n in brief["nodes"]}


def unknown_refs(brief):
    ids = {n["id"] for n in brief["nodes"]}
    out = [(n["id"], d) for n in brief["nodes"] for d in n["depends_on"] if d not in ids]
    known = ids | {g["id"] for g in brief["gates"]}
    out += [(g["id"], a) for g in brief["gates"] for a in g["after"] if a not in known]
    return out


def find_cycle(brief):
    deps = _deps(brief)
    state = {}
    stack = []

    def visit(n):
        state[n] = 1
        stack.append(n)
        for d in deps[n]:
            if state.get(d) == 1:
                return stack[stack.index(d):] + [d]
            if d not in state:
                found = visit(d)
                if found:
                    return found
        stack.pop()
        state[n] = 2
        return None

    for n in deps:
        if n not in state:
            found = visit(n)
            if found:
                return found
    return None


def ancestors(brief, node_id):
    deps = _deps(brief)
    seen = set()
    todo = list(deps.get(node_id, []))
    while todo:
        n = todo.pop()
        if n not in seen:
            seen.add(n)
            todo.extend(deps.get(n, []))
    return seen


def waves(brief):
    deps = _deps(brief)
    left = {n: set(d) for n, d in deps.items()}
    out = []
    while left:
        ready = sorted(n for n, d in left.items() if not d)
        if not ready:
            return None
        out.append(ready)
        for n in ready:
            del left[n]
        for d in left.values():
            d.difference_update(ready)
    return out


def critical_path(brief):
    layers = waves(brief)
    if not layers:
        return [], 0
    deps = _deps(brief)
    minutes = {n["id"]: n["estimate_minutes"] for n in brief["nodes"]}
    best = {}
    prev = {}
    for layer in layers:
        for n in layer:
            p = max(deps[n], key=lambda d: (best[d], d), default=None)
            prev[n] = p
            best[n] = minutes[n] + (best[p] if p is not None else 0)
    end = max(sorted(best), key=lambda n: best[n])
    path = []
    while end is not None:
        path.append(end)
        end = prev[end]
    path.reverse()
    return path, best[path[-1]]
