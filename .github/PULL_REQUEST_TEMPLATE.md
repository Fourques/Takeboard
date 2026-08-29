## User outcome

<!-- What creator journey improves? What remains deliberately unchanged? -->

## Evidence

- [ ] Narrow unit/integration tests added or updated
- [ ] Relevant Playwright journey added or updated
- [ ] `pnpm verify` passes
- [ ] `pnpm test:e2e` passes for user-facing behavior
- [ ] Screenshots attached for layout or interaction changes

## Safety and compatibility

- [ ] No credentials, cookies, tokens, private prompts/media or absolute user paths are exposed
- [ ] Cancellation/deletion/restore behavior is idempotent where applicable
- [ ] Imported Workflow execution still requires explicit trust and content-hash validation
- [ ] Data/schema changes include migration, backup and failure-path coverage
- [ ] Unknown progress remains visibly indeterminate

## Documentation

- [ ] README/changelog/user docs updated, or no public behavior changed
- [ ] `docs/decisions.md` updated for product, security, persistence or architecture decisions
