---
name: amp22-release
description: Prepare and publish an AMP22 release when the user explicitly requests one. Review every commit and PR since the last published release, write feature-focused bullet notes with macOS and Windows unsigned-installation disclosures, refresh README and genuine screenshots, and confirm the version before publishing.
---

# AMP22 release

Run this skill only when the user explicitly requests a release. Preparing code,
merging PRs, and running ordinary builds do not authorize publishing.

## Review the release range

1. Read `AGENTS.md`, `README.md`, `.github/PULL_REQUEST_TEMPLATE.md`,
   `.github/workflows/build.yml`, `scripts/release-version.js`, and
   `scripts/mac-release-notice.js`. Inspect the worktree status; preserve unrelated
   work. Use the current worktree, never the main checkout.
2. Use `gh release list` and `gh release view` to identify the most recent
   published stable release and its exact tag/commit. Fetch missing remote tags
   and refs before comparing. Do not use `package.json` as the last-release
   baseline: it can lag behind automatically numbered releases. If no release
   exists, review the history intended for the initial release.
3. Establish the intended release commit on `master`. Review **every commit**
   in `<last-tag>..<release-commit>` with `git log` and the corresponding diffs.
   Retrieve every included merged PR's title, body, and relevant discussion with
   `gh`; include direct commits and squash commits. Determine inclusion from
   commit ancestry, not just PR dates. Exclude changes already in the last release,
   unmerged PRs, and changes outside the intended release commit.
4. Prepare a comprehensive, deduplicated bullet-point list of **new features,
   improvements, and fixes**, grouped where useful for readers. Explain user
   benefits, controls, and important limitations rather than just copying PR
   titles. Include relevant maintenance improvements without confusing them with
   new app features. Link the included PRs and the full comparison. Verify claims
   against the code and evidence; do not claim unavailable data, perfect film
   alignment, verified tracking, or platform checks that were not performed.

## Confirm the version

If the user supplied a version, validate stable `MAJOR.MINOR.PATCH` syntax and
confirm it is newer than all published stable tags. Otherwise use `ask_user`
before bumping, tagging, or publishing. Suggest a version with a short rationale:
patch for compatible fixes/refinements, minor for meaningful compatible features,
major for breaking changes. Base the recommendation on the actual release range.
Offer the recommended version first, with "(Recommended)", and reasonable
alternatives. Never silently accept the workflow's automatic patch as the user's
choice.

After confirmation, use `npm version <version> --no-git-tag-version --ignore-scripts`
to update `package.json` and `package-lock.json` together. Verify
`node scripts/release-version.js` prints exactly the chosen version. Never publish
a different version or reuse an existing tag for new code.

## Documentation and installation disclosures

- Update the relevant README features, controls, workflows, settings, and platform
  instructions in place; do not append a release changelog to the README.
- Audit the screenshots affected by **all changes in the release range**. Capture
  refreshed images from the actual running release app with representative real
  game data and film. Use an isolated profile, `A22_USER_DATA`, `A22_DEV_SCRIPT`,
  `A22_HEADLESS=1`, and `capturePage` with `stayHidden`/`stayAwake` to avoid taking
  over the desktop. Ask where test film is if none is configured or available.
  Reuse genuine imported/cached data only with permission; do not alter the user's
  real profile or read another checkout.
- Keep focused, legible images in `docs/screenshots/`, with stable filenames and
  accurate README captions and repository-relative links. Review the actual
  images for private paths, credentials, unrelated desktop content, and mismatched
  claims. Do not fabricate controls, film, annotations, results, or completed
  exports. Report missing film/data as a blocker, not a mock screenshot. Unaffected
  images need not be replaced. Explain when screenshots are not applicable.
- Include **both** installation disclosures in the README and release body.
  `node scripts/mac-release-notice.js <notes-file>` adds the shared notices without
  duplicating them:
  - macOS: Apple Silicon `arm64` versus Intel `x64` DMG, drag AMP22 to Applications,
    quit before upgrading. Free ad-hoc signing is **not** Apple Developer ID
    signing or notarization and does not establish Apple trust. Describe
    Gatekeeper blocking and the app-only quarantine command from the shared notice,
    only for a trusted official download. Never disable Gatekeeper globally or
    suggest blindly adding `sudo`.
  - Windows PC: use the x64 `.exe` installer; no trusted code-signing certificate,
    so SmartScreen may report an unrecognized app/unknown publisher. Only for a
    trusted official GitHub download, use **More info -> Run anyway** if offered.
    If policy prevents that, stop and contact the administrator; never disable
    SmartScreen, antivirus, or organizational security controls.
- Save the curated release body in the session artifacts folder until publication.
  Include the feature/improvement bullets, both notices, and comparison/PR links.
  Do not overwrite an existing release's curated notes with generated PR titles.

## Validate and publish

1. Run the documented tests relevant to changes made during preparation, plus
   release/version tests. Run native workflows when needed for affected screenshots
   and controls. Restore dependencies only after a missing-dependency failure or
   a manifest change. Check `git diff --check`, version/lockfile consistency,
   README image links, screenshot contents, and the exact release-note range.
2. Persist preparation changes on the feature branch. If a preparation PR is
   needed, inspect and preserve the complete PR template, fill the documentation
   checklist accurately, and include exact validation commands **and results**.
   Do not merge without the user's authorization. If publishing is blocked by
   unmerged preparation changes or failing CI, state the blocker and obtain the
   required decision rather than releasing stale `master`.
3. Before dispatch, confirm preparation changes are on remote `master`, its SHA
   matches the reviewed release, no conflicting release run is active, and the
   chosen tag does not already exist. Run
   `gh workflow run build.yml --repo apulianas/AMP22 --ref master` only under the
   user's explicit release request. Never enable push/merge-triggered releases.
   Other-branch dispatches only build artifacts; they do not publish.
4. Track the exact resulting workflow run and wait for all required jobs. Failure
   is a release blocker; inspect logs and fix the root cause. Do not report success
   from dispatch alone or rerun a published release blindly: replacing assets
   resets download counts.
5. After successful publication, replace the generated release body with the
   verified curated notes using `gh release edit <tag> --notes-file <notes-file>`.
   Preserve existing manual additions if retrying after partial completion.
6. Verify the published stable release's exact tag, target commit, body, and assets:
   matching-version Apple Silicon DMG, Intel DMG, Windows x64 installer, and
   `AMP22-NFL-Pro-Extension.zip`. Confirm both installation disclosures and the
   full feature/improvement bullets survived publication. Link the actual release
   URL in the final handoff; plainly disclose any incomplete validation.
