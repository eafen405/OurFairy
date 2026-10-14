import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = "eafen405/OurFairy"
PARENT = 23
MANIFEST = ROOT / "manifest.json"
state = json.loads(MANIFEST.read_text())
tickets = state["tickets"]
by_key = {ticket["key"]: ticket for ticket in tickets}
state["approval"] = "用户已确认：按推荐拆分发布（推荐）"


def save():
    temporary = MANIFEST.with_suffix(".json.new")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(MANIFEST)


def gh(*args):
    result = subprocess.run(["gh", *args], text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result.stdout.strip()


def api(endpoint, *args):
    result = gh("api", endpoint, *args)
    return json.loads(result) if result else None


def expected_body(ticket):
    body = (ROOT / ticket["file"]).read_text()
    before = body.split("## Blocked by\n", 1)[0]
    lines = []
    for key in ticket["deps"]:
        dependency = by_key[key]
        lines.append(f'- [{dependency["title"]}]({dependency["published"]["url"]})')
    return before + "## Blocked by\n\n" + ("\n".join(lines) if lines else "None (can start immediately).") + "\n"


parent_before = api(f"repos/{REPO}/issues/{PARENT}")
state.setdefault("parent_before", {
    "title": parent_before["title"],
    "state": parent_before["state"],
    "body_sha256": hashlib.sha256(parent_before["body"].encode()).hexdigest(),
})
assert parent_before["state"] == "open"
save()

existing = api(f"repos/{REPO}/issues?state=all&per_page=100")
for ticket in tickets:
    body = expected_body(ticket)
    if "published" in ticket:
        issue = api(f'repos/{REPO}/issues/{ticket["published"]["number"]}')
    else:
        candidates = [issue for issue in existing
                      if "pull_request" not in issue
                      and issue["title"] == ticket["title"]
                      and state["parent"] in (issue.get("body") or "")]
        if len(candidates) > 1:
            raise RuntimeError(f'发现多个同名子票，停止避免误用：{ticket["title"]}')
        if candidates:
            issue = api(f'repos/{REPO}/issues/{candidates[0]["number"]}')
        else:
            (ROOT / ticket["file"]).write_text(body)
            output = gh("issue", "create", "--repo", REPO,
                        "--title", ticket["title"], "--label", "ready-for-agent",
                        "--body-file", str(ROOT / ticket["file"]))
            match = re.search(r"https://github\.com/eafen405/OurFairy/issues/(\d+)", output)
            if not match:
                raise RuntimeError(f'创建结果未返回议题地址，停止以便核对：{ticket["title"]}')
            issue = api(f"repos/{REPO}/issues/{int(match.group(1))}")
    if issue["body"] != body or issue["title"] != ticket["title"]:
        raise RuntimeError(f'票面与获准草案不一致，停止避免覆盖：{ticket["title"]}')
    if issue["state"] != "open":
        raise RuntimeError(f'目标票已经关闭，需核对并发操作：{ticket["title"]}')
    (ROOT / ticket["file"]).write_text(body)
    ticket["published"] = {"number": issue["number"], "id": issue["id"], "url": issue["html_url"]}
    save()
    print(f'票面已发布：{ticket["title"]} {issue["html_url"]}', flush=True)

children = api(f"repos/{REPO}/issues/{PARENT}/sub_issues?per_page=100")
child_ids = {issue["id"] for issue in children}
for ticket in tickets:
    published = ticket["published"]
    if published["id"] not in child_ids:
        api(f"repos/{REPO}/issues/{PARENT}/sub_issues", "--method", "POST",
            "-F", f'sub_issue_id={published["id"]}')
        child_ids.add(published["id"])
    ticket["parent_linked"] = True
    save()
    print(f'原生子议题已关联：{ticket["title"]}', flush=True)

for ticket in tickets:
    published = ticket["published"]
    blockers = api(f'repos/{REPO}/issues/{published["number"]}/dependencies/blocked_by?per_page=100')
    blocker_ids = {issue["id"] for issue in blockers}
    for key in ticket["deps"]:
        dependency = by_key[key]
        identifier = dependency["published"]["id"]
        if identifier not in blocker_ids:
            api(f'repos/{REPO}/issues/{published["number"]}/dependencies/blocked_by',
                "--method", "POST", "-F", f"issue_id={identifier}")
            blocker_ids.add(identifier)
    ticket["dependencies_linked"] = True
    save()
    print(f'原生依赖已建立：{ticket["title"]}（{len(ticket["deps"])} 条）', flush=True)

parent_after = api(f"repos/{REPO}/issues/{PARENT}")
assert parent_after["body"] == parent_before["body"]
assert parent_after["state"] == parent_before["state"]
assert parent_after["title"] == parent_before["title"]
children = api(f"repos/{REPO}/issues/{PARENT}/sub_issues?per_page=100")
children_by_number = {issue["number"]: issue for issue in children}
frontier = []
for ticket in tickets:
    published = ticket["published"]
    issue = children_by_number[published["number"]]
    assert issue["body"] == expected_body(ticket), ticket["title"]
    assert issue["state"] == "open", ticket["title"]
    assert not issue["assignees"], ticket["title"]
    assert "ready-for-agent" in {label["name"] for label in issue["labels"]}, ticket["title"]
    blockers = api(f'repos/{REPO}/issues/{published["number"]}/dependencies/blocked_by?per_page=100')
    expected_ids = {by_key[key]["published"]["id"] for key in ticket["deps"]}
    assert {item["id"] for item in blockers} == expected_ids, ticket["title"]
    if not blockers:
        frontier.append({"title": ticket["title"], "url": published["url"]})

state["status"] = "published-and-verified"
state["verification"] = {
    "tickets": len(tickets), "native_dependencies": sum(len(t["deps"]) for t in tickets),
    "all_parent_links": True, "all_ready_for_agent": True, "all_open_unassigned": True,
    "parent_body_title_state_unchanged": True, "first_frontier": frontier,
}
save()
overview = (ROOT / "README.md").read_text()
overview = overview.replace("# 首版实施票拆分草案", "# 首版实施票与任务图", 1)
overview = overview.replace("状态：待用户核对粒度、阻塞边和合并/拆分；尚未发布实施票。编号仅用于本次草案顺序。",
                            "状态：用户已确认拆分，22 张实施票与 32 条原生依赖已发布并核验。列表序号是阅读顺序，实际身份见各票链接。", 1)
overview = overview.replace("## 拟议实施票", "## 已发布实施票", 1)
for ticket in tickets:
    overview = overview.replace(f'[{"完整票面"}]({ticket["file"]})',
                                f'[GitHub 票面]({ticket["published"]["url"]}) · [本地副本]({ticket["file"]})', 1)
(ROOT / "README.md").write_text(overview)
print(json.dumps(state["verification"], ensure_ascii=False), flush=True)
