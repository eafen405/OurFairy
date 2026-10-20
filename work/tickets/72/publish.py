"""Publish the issue-72 ticket split as native sub-issues of #72.

Tickets are created in dependency order so each blocked-by edge can name a real
issue id. The parent issue's title, body and state are read before and asserted
unchanged afterwards; this script never closes or edits the parent.
"""
import json
import subprocess
from pathlib import Path

REPO = "eafen405/OurFairy"
PARENT = 72
ROOT = Path(__file__).resolve().parent
TICKETS = [
    ("01-benchmark-baseline.md", []),
    ("02-projection-units.md", []),
    ("03-read-observe-shared.md", ["02-projection-units.md"]),
    ("04-page-cut.md", ["02-projection-units.md"]),
    ("05-cold-restart.md", ["03-read-observe-shared.md"]),
    ("06-multi-observer-isolation.md", ["03-read-observe-shared.md"]),
    ("07-benchmark-after.md", ["01-benchmark-baseline.md", "03-read-observe-shared.md", "04-page-cut.md"]),
    ("08-closeout.md", ["05-cold-restart.md", "06-multi-observer-isolation.md", "07-benchmark-after.md"]),
]
TITLES = {
    "01-benchmark-baseline.md": "固定负载基准与改造前同机基线",
    "02-projection-units.md": "投影单元：transcript / tasks+activity 注册到原生 registry",
    "03-read-observe-shared.md": "观察者共享与 read/observe 切换",
    "04-page-cut.md": "分页在固定截点取值",
    "05-cold-restart.md": "冷启动重建与 live 状态边界",
    "06-multi-observer-isolation.md": "多观察者共享与多会话隔离",
    "07-benchmark-after.md": "改造后基准与相对门槛",
    "08-closeout.md": "契约文档、全量验证与子票收口",
}


def gh(*args):
    result = subprocess.run(["gh", *args], text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result.stdout.strip()


def api(endpoint, *args):
    out = gh("api", endpoint, *args)
    return json.loads(out) if out else None


def body_for(file, blocked):
    text = (ROOT / file).read_text()
    head = text.split("## Blocked by", 1)[0].rstrip() + "\n"
    lines = [f'- [{TITLES[dep]}]({published[dep]["url"]})' for dep in blocked]
    return head + "\n## Blocked by\n\n" + ("\n".join(lines) if lines else "None (can start immediately).") + "\n"


parent_before = api(f"repos/{REPO}/issues/{PARENT}")
assert parent_before["state"] == "open", "parent must stay open"
assert parent_before["title"].startswith("后端投影性能"), parent_before["title"]
published = {}

for file, blocked in TICKETS:
    body = body_for(file, blocked)
    path = ROOT / file
    path.write_text(body)
    out = gh("issue", "create", "--repo", REPO, "--title", TITLES[file],
             "--label", "ready-for-agent", "--body-file", str(path))
    url = out.strip().splitlines()[-1]
    number = int(url.rstrip("/").split("/")[-1])
    published[file] = {"number": number, "url": url}
    print(f"{file} -> #{number}")

# Native blocking edges, in a second pass now that every number exists.
for file, blocked in TICKETS:
    child = api(f"repos/{REPO}/issues/{published[file]['number']}")["id"]
    for dep in blocked:
        blocker = api(f"repos/{REPO}/issues/{published[dep]['number']}")["id"]
        gh("api", "--method", "POST", f"repos/{REPO}/issues/{child}/dependencies/blocked_by",
           "-F", f"issue_id={blocker}")

parent_after = api(f"repos/{REPO}/issues/{PARENT}")
assert parent_after["state"] == parent_before["state"]
assert parent_after["title"] == parent_before["title"]
assert parent_after["body"] == parent_before["body"]
(ROOT / "published.json").write_text(json.dumps(published, indent=2, ensure_ascii=False) + "\n")
print(json.dumps(published, indent=2, ensure_ascii=False))
