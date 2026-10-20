# Group file spaces

The group row is the product's own row for shared file groups. It mounts the
`groups`, `group_create` and `group_members` tools and contributes the roots of
a session owner's current groups to the spaces row. Identity keeps owning the
group records and membership transactions; the spaces row keeps owning the
scope calculation and the file/script providers.

Disabling the `groups` row removes those three tools and the group roots. The
private and public spaces, the shared environment, and confined scripts keep
working, because none of them is contributed by this row.

## What the row contributes

`apply` reads `ctx.ourfairySpaces` for the space root and the owner, and
`ctx.identity` for the business store. It registers one contributor through
`ctx.ourfairySpaces.contributeExtraRoots`, so the spaces row stays the only
code that decides which paths an operation may reach. The contributor is
evaluated at every file or process operation; it reads current SQLite
membership rather than caching a member's roots at tool-registration time.

Every known session owner gets `groups`, which lists their current group IDs,
owner/member short numbers and file roots. Only Phaethon gets
`group_create(name, ownerShortId)`. Creation joins the designated owner,
without granting Phaethon membership automatically. Current group owners get
`group_members(groupId, userShortId, action)`, where the numeric action is 1
(add) or 2 (remove). Assigning a new group to an already-live owner makes that
tool visible in their live sessions immediately. Group names need not be
unique; tools address stable numeric group IDs.

Membership changes recheck the exact target group's current owner and active
identities inside the same immediate transaction as the write. Duplicate
add/remove is harmless and re-add revives the same member record. The
designated owner remains a member; owner transfer and group deletion are out of
scope. Errors return readable native tool failures.

Removing a member blocks subsequent group operations even in an existing live
session; if its cwd was in that group, the next prompt restores the private
root (the spaces row's working-directory provider owns that recovery).
Already-running processes keep their granted OS mounts until they end.
