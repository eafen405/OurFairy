"""Publish the issue-71 ticket split as native sub-issues of #71.

Tickets are created in dependency order so each blocked-by edge can name a real
issue id. The parent issue's title, body and state are read before and asserted
unchanged afterwards; this script never closes or edits the parent.
"""
import json
import re
import subprocess
from pathlib import Path

REPO = "eafen405/OurFairy"
PARENT = 71
ROOT = Path(__file__).resolve().parent
TICKETS = [
    ("01-pdf-native-subprocess.md", [], "PDF worker 改由原生 subprocess 服务启动"),
    ("02-native-rows-retry-spill.md", [], "挂载原生重试与 spill 行"),
    ("03-spill-retrievable.md", ["02-native-rows-retry-spill.md"], "被 spill 的结果仍可用 read/grep 取回"),
    ("04-dsh-history-seam.md", [], "在 dsh fork 暴露 Host 可调用的历史/跟随接缝"),
    ("05-product-history-adapter.md", ["04-dsh-history-seam.md"], "产品历史/跟随适配原生接缝"),
    ("06-upgrade-review-and-retained.md",
     ["01-pdf-native-subprocess.md", "02-native-rows-retry-spill.md",
      "04-dsh-history-seam.md", "05-product-history-adapter.md"],
     "升级依赖记录与明确保留的产品实现"),
    ("07-closeout.md",
     ["01-pdf-native-subprocess.md", "02-native-rows-retry-spill.md", "03-spill-retrievable.md",
      "04-dsh-history-seam.md", "05-product-history-adapter.md", "06-upgrade-review-and-retained.md"],
     "版本组合、证据与 #71 交接收口"),
]
TITLES = {file: title for file, _, title in TICKETS}


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
published = {}

for file, blocked, title in TICKETS:
    body = body_for(file, blocked)
    path = ROOT / file
    path.write_text(body)
    out = gh("issue", "create", "--repo", REPO, "--title", title,
             "--label", "ready-for-agent", "--body-file", str(path))
    match = re.search(r"https://github\.com/eafen405/OurFairy/issues/(\d+)", out)
    if not match:
        raise RuntimeError(f"no issue url in output: {out}")
    number = int(match.group(1))
    issue = api(f"repos/{REPO}/issues/{number}")
    assert issue["body"] == body, f"body mismatch on #{number}"
    published[file] = {"number": number, "id": issue["id"], "url": issue["html_url"]}
    print(f"created #{number} {title}", flush=True)

for file, _, _ in TICKETS:
    entry = published[file]
    api(f"repos/{REPO}/issues/{PARENT}/sub_issues", "--method", "POST",
        "-F", f"sub_issue_id={entry['id']}")
    print(f"linked #{entry['number']} as sub-issue of #{PARENT}", flush=True)

for file, blocked, _ in TICKETS:
    entry = published[file]
    for dep in blocked:
        api(f"repos/{REPO}/issues/{entry['number']}/dependencies/blocked_by",
            "--method", "POST", "-F", f"issue_id={published[dep]['id']}")
    if blocked:
        print(f"#{entry['number']} blocked by {[published[dep]['number'] for dep in blocked]}", flush=True)

parent_after = api(f"repos/{REPO}/issues/{PARENT}")
assert parent_after["state"] == parent_before["state"]
assert parent_after["title"] == parent_before["title"]
assert parent_after["body"] == parent_before["body"]
(ROOT / "published.json").write_text(json.dumps(published, ensure_ascii=False, indent=2) + "\n")
print("parent unchanged", flush=True)
