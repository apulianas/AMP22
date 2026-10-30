# Pull requests and documentation

- Keep `README.md` aligned with user-visible changes in the same pull request. Update the relevant features, usage instructions, controls, settings, and platform notes rather than appending a separate change log.
- For changes to visible UI or workflows, refresh the affected screenshots in `docs/screenshots/` and their README captions. Add a screenshot when a new major feature is not represented; do not replace unrelated screenshots.
- Capture the actual running AMP22 app using representative game data. Do not fabricate controls, results, film alignment, or completed exports for screenshots. If suitable film or data is unavailable, state the blocker rather than presenting a mock as a working feature.
- Use clear, stable screenshot filenames and repository-relative README image links. Keep images focused and legible, and exclude personal file paths, credentials, and unrelated desktop content.
- Internal-only changes do not require new screenshots. Mark the documentation or screenshot checklist items not applicable with a short reason when no user-facing behavior or appearance changes.
- Before opening or updating a PR, check that README feature descriptions and screenshots match the branch and complete the PR template's documentation checklist.
