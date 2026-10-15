# Stage publication

Reviewed source did not change after the fixed two-axis review.

## External repositories

- dsh exact reviewed `173e155a85305db378dd92b1fa057ac6e6dea86e` normally pushed from clean detached T10 worktree with `git push git@github.com:eafen405/deepseek-harness.git HEAD:product/ourfairy-v1`. Pre-push `typecheck` ran the normal full host build and client project, passed in 19.74s, hook total 19.88s. Tool output confirmed `d3fe98f969..173e155a85 HEAD -> product/ourfairy-v1`. No hook bypass.
- Android `b0911d34bdbe6ee8f559167ede41da95a9f082f8` normally pushed with `git push git@github.com:eafen405/rikkahub.git product/ourfairy-v1`; output `e58352f2..b0911d34 product/ourfairy-v1 -> product/ourfairy-v1`.

HTTPS dsh push failed to connect after 133442ms, and its separate ls-remote failed GnuTLS -110. Android's task-owned stalled HTTPS push was interrupted before normal same-repository SSH retry. No remote, proxy, credential or force-push setting was changed.

A publication-preparation `--no-ff` merge unnecessarily created local-only `0095f586` on the retained T10 ticket branch. That attempt was interrupted (exit130); the clean worktree was detached at exact reviewed `173e155a`, and `git diff 0095f586 HEAD` confirmed identical source before normal publication. No reset, branch deletion or force push. Remote verification below confirms the published exact combination.

Independent SSH ls-remote verified:

```
173e155a85305db378dd92b1fa057ac6e6dea86e refs/heads/product/ourfairy-v1 (dsh)
b0911d34bdbe6ee8f559167ede41da95a9f082f8 refs/heads/product/ourfairy-v1 (rikkahub)
```

## OurFairy and tracker

Normal `git push origin integration/ourfairy-v1` succeeded, output
`2014466..1833809 integration/ourfairy-v1 -> integration/ourfairy-v1`.
Independent `git ls-remote origin refs/heads/integration/ourfairy-v1` returned
`183380976f0df2c9f61efcfb85ddf26ae6c2c5b4`. Lead subsequently closed #33/#35
and updated parent #23; exact links are in `../../notes/stage-t10-t12-handoff.md`.
Final closeout commit adds cleanup/preservation evidence only and is normally
pushed and independently verified after this record. External tips remain exact.
