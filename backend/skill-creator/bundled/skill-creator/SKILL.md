---
name: skill-creator
description: Create or revise a reusable Fairy skill from a workflow that has actually worked. Use when the user asks to save a procedure as a skill, install a skill from an address, or revise an existing skill so later sessions can reuse it without redesigning it.
user-invocable: false
---

# Skill Creator

A skill is a reusable procedure packaged as a folder. It is not a transcript
summary, a knowledge base, or a record of one-off facts.

## When to use it

Load this skill when the user explicitly asks to save the current procedure as
a skill, or when a workflow succeeded and is likely to repeat. Never create one from
a casual conversation, unfinished attempt, or imagined workflow.

## Workflow or fact

- Reusable **procedure** (steps, inputs, outputs, tools, checks) → skill.
- Stable **fact or preference** about one user → memory, not a skill.
- One-off result, mood, incidental failure, narrative → neither.

Do not write the same content to both memory and a skill: a workflow belongs to
the skill; a durable user fact belongs to memory.

## Package shape

```
<name>/
  SKILL.md              # required: frontmatter plus the workflow body
  references/           # optional: detail loaded only when needed
  scripts/              # optional: reusable executable assets
```

`SKILL.md` starts with frontmatter:

```
---
name: kebab-case-name
description: When to use this skill, in one or two sentences.
whenToUse: A longer applicability note, optional.
not-applicable: When this skill must not be used, optional.
---

# Workflow
```

Frontmatter is a **flat** map of single-line `key: value` entries; nested maps,
lists, block scalars, anchors and tags are refused.

Rules checked by the backend:

- `name` is lower-case kebab-case (`^[a-z0-9]+(?:-[a-z0-9]+)*$`).
- `description` is non-empty, at most 500 Unicode characters, and says *when*
  to use the skill.
- The body after the frontmatter is at most 7700 Unicode characters; move long
  detail into `references/`.
- Every path is relative to the skill folder; never absolute host paths, `..`,
  symlinks or paths outside it. Network access is available.
- `user-invocable: false` is the runtime's choice; do not add a second
  activation path. Optional `license` is one line.

## Create through skill_manage

Call `skill_manage` with `action: "create"` and this payload:

```
scope: 1                     // personal, owned by the caller
focus: {kind: "turn"}        // current/latest turn, {kind:"turn",turn:N}, or {kind:"task",text:"..."}
files: [{path, content, executable?}]   // the complete package, including SKILL.md
scenarios: [{name, command, description?, uses?, timeoutMs?}]   // at least one
evidence: [{kind: "session"|"test"|"observation", ref, note?}]  // required for a revision
```

- `focus` bounds the material you read: the current turn, a numbered turn only
  when the user names one, or `task` when the latest turn is the right range;
  the backend records it as provenance.
- `files` is the complete package. You cannot choose where it lands; the
  backend stages and hashes it in an isolated candidate area.
- `scope: 2` needs the user's current turn to explicitly ask to share it; the
  backend records it as consent. An address install uses `address` instead of
  `files`.
- A name with an approved skill is refused for a plain create; revise with
  `parentVersionId` instead of a second identity.
- Never submit a licence; the package's own frontmatter or `LICENSE` file is
  the only licence recorded.

## Scenarios and evidence

- Define one to three representative closed-loop commands run from the package
  copy: read what the workflow needs, run the script or check, print a result.
  A static read of `SKILL.md` is not effect verification.
- `uses` names the package-relative files each scenario depends on; the backend
  uses it for verification reuse, so name them accurately.
- The backend runs the scenarios for real in a disposable confined directory and
  records the command, exit code, timeout, environment and output. You may not
  claim a verification result you did not receive.
- Cite evidence for what you could not execute: a session observation, a test
  that covers it, or a stated user preference. Uncited one-off details do not
  belong in the package.

## Revisions, rollback and growth

An approved skill changes only through a revision. Call `skill_manage` with
`action: "create"`, `parentVersionId` set to the skill's **current approved
version** and a non-empty `targetBenefit` (at most 500 characters). The package
is a complete rewrite, not a patch: write only the current workflow, never a
revision log, an old/new comparison, or a "what changed" section; the
review material and version history carry that story.

Create a revision only for a proven reason:

- a verification scenario failed and the new package fixes it;
- a repeated real scenario is now covered;
- the same behaviour is provable with a shorter core body.

With no such benefit, create nothing. A revision without `targetBenefit` is
refused (the backend records it), and it must cite at least one `evidence`
entry; a new skill's focus/turn is its provenance.

The backend reuses a parent scenario's recorded run only when its name, command
and every `uses` hash are unchanged; the rest rerun, so name them accurately.

### Growth confirmation

Core-body length is the Unicode character count of `SKILL.md` after the
frontmatter. A revision above **110%** of the parent's length is abnormal
growth; up to and including exactly 110% needs no extra step. Above it:

1. `skill_manage inspect` shows the old/new characters and percentage and asks
   the user to reply `确认增长` in a separate turn.
2. Wait for the user's own message; do not write it yourself or infer consent
   from "looks good".
3. `skill_manage list` reports `growthConfirmMessageId` after the user replied;
   pass that id to `skill_manage review` with `decision: "approve"`.

A boolean, a made-up id, another session's message or a message before the
display is refused. A new draft is a new hash and needs fresh inspect and
confirmation; an earlier approval or verification never carries over.

### Rollback

`skill_manage rollback` with the id of an approved **historical** (superseded)
version copies that clean package into a new pending candidate and verifies it
again. Review it like any other candidate. Rollback never moves the current
version directly, and a version switch keeps the user's enable preference.
Personal skills are revised and rolled back by their owner, common ones only by
Phaethon.

## Review before use

Every skill package is a candidate until its owner approves it in conversation:

1. `skill_manage create` returns the candidate identity, status and next
   actions. Nothing enters the model catalog yet.
2. `skill_manage inspect` returns the review package and a deterministic
   display: identity and hash, core-body change, applicability and benefit,
   package changes, the real executed/unexecuted records, and how to expand
   with `expand: "skill"` or `expand: "files"`.
3. Present it and wait for the user's decision: approve, request changes or
   reject. Only they decide.
4. `skill_manage review` records it. A change request means a new draft with a
   new hash and fresh verification; an old approval and report never carry
   over. A rejected draft stays settled.

Never claim approval yourself, never approve for the user, and never hand-write
files into a version area or choose an owner or reviewer. Personal skills belong
to their author and default to enabled after approval. Never promote one user's
private material without their explicit request in the current turn.
