## What does this PR do?

<!-- One short paragraph. Link the issue it closes: "Closes #123". -->

## Type of change

- [ ] Bug fix (no behaviour change for unrelated inputs)
- [ ] New feature
- [ ] Performance improvement
- [ ] Documentation / tooling only
- [ ] Breaking change (file output or public API)

## Verification

- [ ] `npm test` passes (269+ tests)
- [ ] `npm run verify:corpus:download` reports **0 differing files**
- [ ] `npm run verify:psd` passes
- [ ] New or updated tests cover the change (a fix should fail before, pass after)
- [ ] Pixel comparisons use raw planes (`get_data(hdr, split=True)`), not `composite()`/`numpy()`

## Notes for the reviewer

<!-- Anything non-obvious: format details, trade-offs, follow-up work, screenshots. -->

## Checklist

- [ ] `src/` remains dependency-free (no `node_modules`, DOM or Electron imports)
- [ ] Commit messages follow Conventional Commits
- [ ] Diff is focused; no unrelated reformatting
