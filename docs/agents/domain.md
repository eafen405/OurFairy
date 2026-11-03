# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY-MAP.md`** at the repo root: points at one glossary per context — root `GLOSSARY.md` (product-wide),
  `android/GLOSSARY.md` (terms only true for the client), `docs/glossary/external-senses.md` and
  `docs/glossary/memory.md`. Read the ones relevant to the topic; the root glossary alone does not cover a
  context's own terms.
- **`docs/adr/`**: read the ADRs that touch the area you're about to work in. This repo keeps them under
  `docs/adr/`, with no per-context ADR directory; a context-scoped decision is an ordinary ADR that names its
  context.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo (most repos) — one glossary at the root:

```
/
├── GLOSSARY.md
└── docs/adr/
    └── 000N-<decision>.md
```

Multi-context repo (presence of `GLOSSARY-MAP.md` at the root) — this repo:

```
/
├── GLOSSARY-MAP.md                    ← one entry per context
├── GLOSSARY.md                        ← product-wide vocabulary
├── android/
│   └── GLOSSARY.md                    ← terms only true for the client
├── docs/
│   ├── adr/                           ← decisions that span contexts
│   │   ├── 0001-upstream-extension-policy.md
│   │   └── 0002-physical-memory-deletion.md
│   └── glossary/
│       ├── external-senses.md         ← what Fairy reads outside the app
│       └── memory.md                  ← what Fairy keeps across sessions
└── backend/                           ← product code
```

A context's glossary sits where that context lives; a new context adds its own glossary file and registers it in
`GLOSSARY-MAP.md` rather than appending terms to the root `GLOSSARY.md`.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
