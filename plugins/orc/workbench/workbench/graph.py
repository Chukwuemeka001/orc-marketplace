from workbench import brief as briefmod


def _label(text):
    return text[:40].replace('"', "'")


def render(b):
    lines = ["flowchart TD"]
    for n in b["nodes"]:
        label = f"{n['id']}: {_label(n['objective'])}"
        shape = f'[["{label}"]]' if n["role"] == "integrator" else f'["{label}"]'
        lines.append(f"    {n['id']}{shape}")
    for g in b["gates"]:
        lines.append(f'    {g["id"]}{{{{"{g["id"]}: {g["kind"]}"}}}}')
    for n in b["nodes"]:
        lines.extend(f"    {d} --> {n['id']}" for d in n["depends_on"])
    for g in b["gates"]:
        lines.extend(f"    {a} --> {g['id']}" for a in g["after"])
    return "\n".join(lines)


def command(args):
    print(render(briefmod.load_brief(args.brief)))
    return 0
