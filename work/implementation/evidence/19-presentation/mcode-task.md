You are executing a bounded subtask delegated by Codex.
Read and follow applicable AGENTS.md instructions before working.
Use the task's allowed edit scope and acceptance criteria. Preserve unrelated changes.
Perform this task yourself; do not delegate to other agents or external harnesses.
Return a concise report of changes, checks performed, and any unresolved blockers.
Do not commit, push, or publish unless the task explicitly authorizes it.

Task:
请只在当前 /tmp/t19-synthetic 目录工作，不要读取或访问其他目录、仓库或任何用户文件。任务完全合成：编写 workload.md，包含中文长回复的可重复工作负载模板：标题、跨段引用式链接与位于末尾的定义、Kotlin代码块、3列表格、LaTeX块公式、最后一段停止/错误后仍应保留的文本。长度约4KB，用虚构数据。再写 generate.py（Python标准库），用固定模板生成 long-single.md（模板重复64次），history.json（200条稳定id文本消息），burst.json（同一文本按128个字符累积形成完整快照，每条version递增，末条相同text且terminal=true）。不要引入依赖，不要git命令。运行生成器并确认输出数量，结果写RESULT.md。不要访问cwd之外路径。
