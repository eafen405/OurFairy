---
name: skill-creator
description: Create or revise a reusable Fairy skill from a workflow that has actually worked. Use when the user asks to save a procedure as a skill, install a skill from an address, or revise an existing skill so later sessions can reuse it without redesigning it.
user-invocable: false
---

# Skill Creator

A skill is a reusable procedure packaged as a folder. It is not a transcript
summary, a knowledge base, or a place to record one-off facts.

## When to use it

Load this skill when the user explicitly asks to save the current procedure as
a skill, or when a workflow has been completed successfully and is likely to be
repeated. Explicit creation is one successful exchange, not a repetition
threshold: the user's request is enough. Do not create a skill from a casual
conversation, an unfinished attempt, or a workflow you only imagined.

## Workflow or fact

- Reusable **procedure** (ordered steps, inputs, outputs, tools, checks) → skill.
- Stable **fact or preference** about one user → memory, not a skill.
- One-off result, passing mood, incidental failure, or a conversation narrative → neither.

Do not write the same content to both memory and a skill. When the material is a
procedure, keep the stable facts it needs in the skill's own instructions and
leave unrelated user facts out. A workflow belongs to the skill; a durable fact
the user stated belongs to memory.

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

Frontmatter is a **flat** map of single-line `key: value` entries. Quoted
scalars and `true`/`false` are accepted. Nested maps or lists, block scalars,
anchors and tags are refused rather than silently misread, so keep every entry
on its own line.

Rules checked by the backend:

- `name` is lower-case kebab-case and matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- `description` is non-empty, at most 500 Unicode characters, and says *when* to
  use the skill rather than restating the workflow.
- The body after the frontmatter is at most 8000 Unicode characters. Move long
  detail into `references/` and point at the file from the body.
- Every path is relative to the skill folder. Never use absolute host paths,
  `..`, symlinks, or paths outside the package. Network access is available.
- `user-invocable: false` is the runtime's choice for product skills; do not add
  a second activation path.
- Optional `license` names the package licence in one line.

## Create through skill_manage

Call `skill_manage` with `action: "create"` and this payload:

```
scope: 1                     // personal, owned by the calling user
focus: {kind: "turn"}        // current/latest turn, {kind:"turn",turn:N}, or {kind:"task",text:"..."}
files: [{path, content, executable?}]   // the complete package, including SKILL.md
scenarios: [{name, command, description?, uses?, timeoutMs?}]   // at least one
evidence: [{kind: "session"|"test"|"observation", ref, note?}]  // optional
license: "..."               // optional, when the package carries none
```

- `focus` bounds the material you read. Use the current turn by default; use a
  numbered turn only when the user names one; use `task` when the user restates
  the goal and the latest turn is the right range. The backend records the
  resolved range as provenance.
- `files` must contain the complete package. You cannot choose where it lands;
  the backend stages it in an isolated candidate area and computes the manifest
  hash itself.
- Only personal creation is available through this tool. Shared creation and
  installation from an address are later capabilities; do not pretend one
  succeeded.
- A name that already has an approved skill is refused for a plain create. Use
  a revision with `parentVersionId` instead of inventing a second identity.

## Scenarios and evidence

- Define one to three representative closed-loop commands, run from the package
  copy: read the files the workflow needs, execute the script or check, and
  print a result. A static read of `SKILL.md` is not effect verification.
- `uses` names the package-relative files each scenario depends on. The backend
  uses it for verification reuse, so name them accurately.
- The backend runs the scenarios for real in a disposable confined directory and
  records the command, exit code, timeout, environment and bounded output. You
  never author those facts, and you may not claim a verification result you did
  not receive.
- Cite evidence for content you could not execute: a session observation, a
  test that covers it, or a stated user preference. Uncited one-off details do
  not belong in the package.

## Revisions, rollback and growth

An approved skill changes only through a revision. Call `skill_manage` with
`action: "create"`, `parentVersionId` set to the skill's **current approved
version** and a non-empty `targetBenefit` (at most 500 characters). The package
is a complete rewrite, not a patch: write only the current workflow, never a
revision log, an old-versus-new comparison, or a "what changed" section. The
review material and the version history carry that story; the skill body does
not.

Create a revision only for a proven reason:

- a verification scenario failed in the current version and the new package
  fixes it;
- a repeated real scenario is now covered;
- the same behaviour is provable with a shorter core body (a simplification
  whose regression results are comparable is a valid benefit).

If there is no such benefit, keep the current version and create nothing. A
revision without `targetBenefit` is refused, and the backend records the benefit
in the review material.

The backend reuses a parent scenario's recorded run only when its name, command
and every `uses` file hash are unchanged; the rest rerun in the disposable
environment. Name `uses` accurately so a safe result is reused instead of
re-run.

### Growth confirmation

Core-body length is the Unicode character count of `SKILL.md` after the
frontmatter. A revision above **110%** of the parent's length is abnormal
growth. Up to and including exactly 110% no extra step is needed; above it, the
user must decide separately:

1. `skill_manage inspect` shows the old/new characters and the percentage and
   instructs the user to reply `确认增长` in a separate turn.
2. Wait for the user's own message. Do not write it yourself and do not infer
   consent from "looks good".
3. `skill_manage list` reports `growthConfirmMessageId` for that candidate after
   the user replied. Pass that id to `skill_manage review` with
   `decision: "approve"`.

A boolean, a made-up id, another session's message or a message sent before the
inspect display is refused. A new draft is a new hash and needs a fresh inspect
and a fresh confirmation; an earlier approval or verification never carries
over.

### Rollback

`skill_manage rollback` with the id of an approved **historical** (superseded)
version copies that clean package into a new pending candidate and verifies it
again. Review it like any other candidate. Rollback never moves the current
version directly, and a version switch always keeps the user's enable
preference.

## Review before use

Every skill package is a candidate until its owner approves it in conversation:

1. `skill_manage create` returns the candidate identity, status and next
   actions. Nothing enters the model catalog yet.
2. `skill_manage inspect` returns the review package and a deterministic
   display: identity and hash, core-body change, applicability and benefit,
   package changes and the real executed/unexecuted records, and how to expand
   the full text with `expand: "skill"` or `expand: "files"`.
3. Present the display to the user and wait for their decision. They may
   approve, request changes or reject; only they decide.
4. `skill_manage review` records that decision. A change request means a new
   draft with a new hash and a fresh verification; an old approval and an old
   report never carry over. A rejected draft stays settled.

Never claim approval yourself, never approve on the user's behalf, and never
hand-write files into a version area or choose an owner or reviewer. Personal
skills belong to their author and default to enabled after approval. If a later
deployment offers shared skills, never promote one user's private material
without that user's explicit request in the current turn.
