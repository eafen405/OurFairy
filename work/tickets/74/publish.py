"""Publish the issue-74 ticket split as native sub-issues of #74.

Tickets are created in dependency order so each blocked-by edge can name a real
issue id. The parent issue's title, body and state are read before and asserted
unchanged afterwards; this script never closes or edits the parent.
"""
import json
import subprocess
from pathlib import Path

REPO = "eafen405/OurFairy"
PARENT = 74
ROOT = Path(__file__).resolve().parent
TICKETS = [
    ("01-benchmark-entry.md", []),
    ("02-fixed-workloads.md", ["01-benchmark-entry.md"]),
    ("03-applied-state.md", ["02-fixed-workloads.md"]),
    ("04-emulator-baseline.md", ["03-applied-state.md"]),
    ("05-hotspot.md", ["04-emulator-baseline.md"]),
    ("06-closeout.md", ["05-hotspot.md"]),
]
TITLES = {
    "01-benchmark-entry.md": "测量入口入库并可干净构建",
    "02-fixed-workloads.md": "五档负载唯一化并驱动生产接收状态",
    "03-applied-state.md": "测量结果回答最新快照是否已应用并呈现",
    "04-emulator-baseline.md": "固定配置模拟器五档三轮基线（方向性参考）",
    "05-hotspot.md": "按问题判据定位热点并做受控优化",
    "06-closeout.md": "版本组合、证据与 #45 交接收口",
}


def gh(*args, body=None):
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
published = {}

for file, blocked in TICKETS:
    body = body_for(file, blocked)
    path = ROOT / file
    path.write_text(body)
    out = gh("issue", "create", "--repo", REPO, "--title", TITLES[file],
             "--label", "ready-for-agent", "--body-file", str(path))
    import re
    match = re.search(r"https://github\.com/eafen405/OurFairy/issues/(\d+)", out)
    if not match:
        raise RuntimeError(f"no issue url in output: {out}")
    number = int(match.group(1))
    issue = api(f"repos/{REPO}/issues/{number}")
    assert issue["body"] == body, f"body mismatch on #{number}"
    published[file] = {"number": number, "id": issue["id"], "url": issue["html_url"]}
    print(f"created #{number} {TITLES[file]}", flush=True)

for file, blocked in TICKETS:
    entry = published[file]
    api(f"repos/{REPO}/issues/{PARENT}/sub_issues", "--method", "POST",
        "-F", f"sub_issue_id={entry['id']}")
    print(f"linked #{entry['number']} as sub-issue of #{PARENT}", flush=True)

for file, blocked in TICKETS:
    entry = published[file]
    for dep in blocked:
        api(f"repos/{REPO}/issues/{entry['number']}/dependencies/blocked_by",
            "--method", "POST", "-F", f"issue_id={published[dep]['id']}")
    print(f"blocked-by set on #{entry['number']}: {[published[d]['number'] for d in blocked]}", flush=True)

# verify
parent_after = api(f"repos/{REPO}/issues/{PARENT}")
assert parent_after["state"] == parent_before["state"]
assert parent_after["title"] == parent_before["title"]
assert parent_after["body"] == parent_before["body"]
children = api(f"repos/{REPO}/issues/{PARENT}/sub_issues?per_page=100")
child_numbers = {issue["number"] for issue in children}
for file, blocked in TICKETS:
    entry = published[file]
    assert entry["number"] in child_numbers, entry
    deps = api(f"repos/{REPO}/issues/{entry['number']}/dependencies/blocked_by?per_page=100")
    assert {item["id"] for item in deps} == {published[d]["id"] for d in blocked}, entry

(ROOT / "published.json").write_text(json.dumps(published, ensure_ascii=False, indent=2) + "\n")
print("verified:", json.dumps({k: v["number"] for k, v in published.items()}, ensure_ascii=False))
