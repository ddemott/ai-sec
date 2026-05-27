# Branch Checklist

Use this checklist when starting and finishing work on a feature branch.

## When Starting a Branch

- [ ] Branch created using `npm run create-branch <type>/<name>` (or the script directly)
- [ ] Branch name follows convention (`feat/`, `fix/`, `test/`, `refactor/`, `docs/`, `chore/`)
- [ ] GitHub Issue created (or existing issue linked) if the work is non-trivial
- [ ] Initial quality gates run:
  - [ ] `npm run verify:claude-md`
  - [ ] `npm run build`
  - [ ] `npm test` (or targeted tests)
- [ ] Local tracking started (this checklist, issue, or `docs/TODO.md` entry)

## While Developing

- [ ] Code follows existing patterns in the module
- [ ] `npm run checks` passes frequently
- [ ] Relevant unit tests written/updated with 5W comments
- [ ] Relevant E2E tests written/updated (use `--grep` for targeted runs)
- [ ] Documentation updated as changes are made (not saved for the end)
- [ ] No `.only` or `.skip` introduced in tests

## Before Considering the Work "Done"

- [ ] All code is linted and formatted (`npm run lint && npm run format:check`)
- [ ] TypeScript is clean (root + dashboard)
- [ ] Full build succeeds (`npm run build` + dashboard build)
- [ ] Relevant unit tests pass
- [ ] Relevant E2E tests pass (targeted)
- [ ] All new or modified tests have proper 5W diagnostic comments
- [ ] Documentation updated:
  - [ ] `CLAUDE.md` (if new patterns, directories, commands, or principles)
  - [ ] `docs/TODO.md` / `RESOLVED.md`
  - [ ] Other relevant `*.md` files
- [ ] `npm run verify:claude-md` passes
- [ ] No test `.only` / `.skip` leftovers
- [ ] No secrets, large binaries, or unintended files staged
- [ ] Pre-PR checklist completed (`npm run pre-pr`)

## Before Committing / Pushing

- [ ] Use the `commit-code` process (tell your agent "commit" or "commit code")
- [ ] Commit message follows Conventional Commits style
- [ ] Pushed to the feature branch
- [ ] Pull Request opened with the proper template filled out

---

**Remember**: This checklist exists to protect future-you (and the project). Skipping steps creates technical debt and painful debugging later.