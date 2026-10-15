# Standards axis notes, #24–#26

## Scope and method

Exact diff commands and complete commit lists: `/tmp/ourfairy-stage-review/scope.md` (read in full). Reviewed code at pinned OurFairy `de2ded1afa13a6a42816fbdd3682bdcc7be10760`, dsh `2f084be06e75cd56c2a7ac9a31e155db9f4deee0`, rikkahub `ffc88e306b0f55cf52c3592ac93151be0492b864`. Used saved diff inventory and `git show` / pinned `git diff` for source inspection. Current uncommitted AGENTS.md was read solely as the user-provided applicable rule, not judged as a change. Existing dsh uncommitted files were excluded.

Read standards: OurFairy AGENTS.md, work/implementation/CONVENTIONS.md, GLOSSARY.md; code-review SKILL.md; dsh root AGENTS.md, CONTRIBUTING.md, packages/AGENTS.md, packages/client/AGENTS.md, scripts/AGENTS.md, docs/AGENTS.md; rikkahub AGENTS.md. Inspected changed identity store/routes/plugin, launcher/combo/probe/composition, Android identity/session/navigation/forms, dsh connection admission and principal scope, owner/header codecs/persistence, delivered messages and affected consumer narrowings. Large generated persistence catalog/schema and evidence logs were not treated as independent architecture justification.

## Confirmed findings

See `standards.md` for independent report. Its first two findings come directly from current user-provided database standards; the transaction mechanism already present gives a small fix for prohibited uniqueness constraints. Preserve uniqueness behavior and related-user checks at the operation, not by removing guarantees.

ToolRuntime at the fixed dsh commit has public operations such as register/restrict/guard/get/execute and a private view/wireSchemas; it has none of the seven accessor names tried by collectTools. Existing probe documentation already identifies external model-double requests as authoritative tool catalog evidence. Therefore deleting the speculative loop does not weaken the relevant acceptance evidence and does not require adding a public Tools enumeration API.

## Deliberately not findings

- No demand for a new repository, generic auth framework, multi-role hierarchy, cache mechanism, or domain wrappers solely for hypothetical scale.
- Existing required durability validation and principal revocation/disposal were not dismissed as overdefense.
- Did not claim the compatible owner header extension inherently needs a format bump: existing discriminators may refuse unsupported input safely, as the repository policy allows.
- Did not turn absent future #27/#28/#43 UI capabilities into Standards defects.
- No broad test suite run; conclusions are static source/rule evidence, independent of the Spec axis and runtime verification.
