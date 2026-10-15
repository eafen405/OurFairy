You are executing a bounded subtask delegated by Codex.
Read and follow applicable AGENTS.md instructions before working.
Use the task's allowed edit scope and acceptance criteria. Preserve unrelated changes.
Perform this task yourself; do not delegate to other agents or external harnesses.
Return a concise report of changes, checks performed, and any unresolved blockers.
Do not commit, push, or publish unless the task explicitly authorizes it.

Task:
Implement only the simple SQLite schema addition for T8. Workspace is /home/eafen405/projects/OurFairy/.worktrees/08-group-spaces. Read AGENTS.md. You may edit ONLY backend/identity/src/store.mjs schema constants and #migrate() (not business/auth methods). Parent owns remaining code.
Current schema v2; migrate to v3 atomically, retaining v1->v2 rebuild behavior, preserving user credentials. New tables:
groups(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,owner_short_id INTEGER NOT NULL,created_by INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,deleted_at INTEGER)
group_members(id INTEGER PRIMARY KEY AUTOINCREMENT,group_id INTEGER NOT NULL,user_short_id INTEGER NOT NULL,created_by INTEGER NOT NULL,updated_by INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,deleted_at INTEGER)
Add ordinary nonunique indexes groups_by_owner(owner_short_id), group_members_by_user(user_short_id), group_members_by_group(group_id). No FOREIGN KEY or secondary UNIQUE or role table. Do not alter V1_COLUMNS/rebuild loops so they try rebuilding new tables. New/fresh files and existing v1/v2 files must end v3. Use small constant GROUP_SCHEMA separate from legacy TABLE_DDL if simplest. Do not add general migration framework. Do not run external agents. No commit. Report actual diff and simple node --check result. Do not edit tests; parent runs user-visible integration red/green.
