"""Publish the issue-73 ticket split as native sub-issues of #73.

Tickets are created in dependency order so each blocked-by edge can name a real
issue id. The parent issue's title, body and state are read before and asserted
unchanged afterwards; this script never closes or edits the parent.
"""
import json
import re
import subprocess
from pathlib import Path

REPO = "eafen405/OurFairy"
PARENT = 73
ROOT = Path(__file__).resolve().parent
TICKETS = [
    ("01-bundle-package-authority.md", []),
    ("08-ecosystem-boundary-doc.md", []),
    ("02-upstream-compatibility.md", ["01-bundle-package-authority.md"]),
    ("03-delivery-row.md", ["01-bundle-package-authority.md"]),
    ("04-groups-row.md", ["01-bundle-package-authority.md"]),
    ("05-scoped-provider-rows.md", ["01-bundle-package-authority.md"]),
    ("06-config-contracts-and-row-liveness.md", ["05-scoped-provider-rows.md"]),
    ("07-single-model-authority.md", ["06-config-contracts-and-row-liveness.md"]),
    ("09-bundle-only-acceptance.md", ["02-upstream-compatibility.md", "03-delivery-row.md", "04-groups-row.md",
                                      "05-scoped-provider-rows.md", "06-config-contracts-and-row-liveness.md",
                                      "07-single-model-authority.md"]),
    ("10-row-addressability-tests.md", ["03-delivery-row.md", "04-groups-row.md", "05-scoped-provider-rows.md",
                                        "06-config-contracts-and-row-liveness.md"]),
    ("11-closeout.md", ["09-bundle-only-acceptance.md", "10-row-addressability-tests.md"]),
]
TITLES = {
    "01-bundle-package-authority.md": "bundle 成为产品包集合的唯一权威",
    "02-upstream-compatibility.md": "产品包声明明确的 dsh 兼容范围并由 doctor 校验",
    "03-delivery-row.md": "投递成为独立产品行并只向 chat 请求窄运行时",
    "04-groups-row.md": "群组工具成为独立产品行",
    "05-scoped-provider-rows.md": "文件系统、sandbox、bash、工作目录 scoped provider 各自成行",
    "06-config-contracts-and-row-liveness.md": "产品行声明 Config 并在加载期以行名和字段失败",
    "07-single-model-authority.md": "共享模型初始声明只保留在 bundle",
    "08-ecosystem-boundary-doc.md": "并行传输例外与保留产品实现的书面边界",
    "09-bundle-only-acceptance.md": "只声明 bundle 的 profile 可安装并启动",
    "10-row-addressability-tests.md": "行可寻址与配置契约的 overlay 验收",
    "11-closeout.md": "版本组合、证据与两轴评审收口",
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
published = {}

for file, blocked in TICKETS:
    body = body_for(file, blocked)
    path = ROOT / file
    path.write_text(body)
    out = gh("issue", "create", "--repo", REPO, "--title", TITLES[file],
             "--label", "ready-for-agent", "--body-file", str(path))
    match = re.search(r"https://github\.com/eafen405/OurFairy/issues/(\d+)", out)
    if not match:
        raise RuntimeError(f"no issue url in output: {out}")
    number = int(match.group(1))
    issue = api(f"repos/{REPO}/issues/{number}")
    assert issue["body"] == body, f"body mismatch on #{number}"
    published[file] = {"number": number, "id": issue["id"], "url": issue["html_url"]}
    print(f"created #{number} {TITLES[file]}", flush=True)

for file, _blocked in TICKETS:
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
