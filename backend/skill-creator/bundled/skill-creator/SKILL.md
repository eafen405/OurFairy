---
name: skill-creator
description: Create or revise a reusable Fairy skill from a workflow that has actually worked. Use when the user asks to save a procedure as a skill, install a skill from an address, or revise an existing skill so later sessions can reuse it without redesigning it.
user-invocable: false
---

# Skill Creator

A skill is a reusable procedure packaged as a folder. It is not a transcript
summary, a knowledge base, or a place to record one-off facts.

## Workflow or fact

- Reusable **procedure** (ordered steps, inputs, outputs, tools, checks) → skill.
- Stable **fact or preference** about one user → memory, not a skill.
- One-off result, passing mood, incidental failure, or a conversation narrative → neither.

Do not write the same content to both memory and a skill. When the material is a
procedure, keep the stable facts it needs in the skill's own instructions and
leave unrelated user facts out.

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
---
```

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

## Workflow

1. **Extract the actual work.** Read the current task's steps, tool calls,
   corrections and input/output shapes. Do not invent steps that were not used.
2. **State applicability.** Write when the skill applies, what it needs before
   starting, and when it must not be used. The description carries the routing
   signal; the body carries the procedure.
3. **Write the shortest complete procedure.** Keep commands, file formats,
   decision points and failure handling. Remove chatter, greetings, one-off
   paths, unrelated private information, and narrative about how the skill was
   produced. A reader must be able to follow the current workflow without
   earlier revisions.
4. **Package supporting material separately.** Long references, examples and
   scripts go into their own files. Reference them relatively; describe the
   input and output of a script rather than pasting its whole source into the
   body.
5. **Check the package hygiene.** No secrets, no author-machine absolute paths,
   no symlinks, no non-regular files. Executable scripts keep an executable bit
   only when they are meant to be run.

## Verify before proposing

- Define at least one representative scenario that exercises the workflow end
  to end, and run it for real in a disposable directory.
- Record what was executed, the exact command, its exit code and an output
  summary; separately mark anything not executed. A static read of the skill is
  not effect verification.
- A revision must name a concrete benefit: a verified failure it fixes, a new
  repeated scenario it covers, or a shorter body with comparable regression
  results. If there is no benefit, keep the current version.
- Never claim a verification result you did not observe.

## Review before use

Every new skill, revision or externally sourced package is a candidate until a
human reviews it. Use the `skill_manage` tool for list, inspect, create, review,
archive and restore; its result names the next allowed action. Do not hand-write
files into the version area, do not choose an owner or reviewer, and do not
install a host plugin or run untrusted setup while preparing a candidate.

Personal skills belong to their author and default to enabled after approval.
Common skills affect every user, require Phaethon's approval, and default to
disabled for each user. Never promote one user's private material into a common
candidate without that user's explicit request in the current turn.
