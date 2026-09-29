# Automated Windows releases

PRs must increase the stable version in package.json and both root entries in package-lock.json, with a matching CHANGELOG heading. The **Release Windows / Verify release** check tests the app, runs the Electron runtime smoke check, builds/syncs mobile, builds the Windows NSIS installer from a real `npm ci`, verifies packaged runtime dependencies and UI assets, and checks latest.yml against the installer. Only merges to main publish; PRs never receive publishing credentials.

After merge the workflow downloads that run's verified artifact and publishes it in two places:

- **`gilfila/anyBot` (the source repo), the update feed from 0.3.23 on**, written with the workflow's own token.
- **`gilfila/anyBot-updates`, a mirror for installs older than 0.3.23** (their built-in feed), written with a short-lived GitHub App token scoped to that repo.

For each, it creates a draft release, uploads exactly three files (four on the source repo when the build made a signed phone app), and verifies GitHub's SHA256 digests. Only then does it tag the source commit, recheck that main hasn't moved, promote both releases, update the mirror's download README, and verify both live updater feeds. No local agent or developer packages or uploads release files.

## One-time activation

1. ~~Resolve the GitHub account billing/spending restriction that prevented runners from starting.~~ Done 2026-09-23: the source repo is public, so Actions minutes are free.
2. Register a GitHub App owned by gilfila, with **Contents: read and write** and no other optional repository permissions. Disable webhooks. Install it only on **anyBot-updates**. It does not need access to the source repo.
3. In the **anyBot** source repo, add Actions variable `RELEASE_APP_CLIENT_ID` and Actions secret `RELEASE_APP_PRIVATE_KEY` (the generated PEM key). Enter the key directly into GitHub; do not commit it, put it into the app, or paste it into chat. The workflow uses its built-in token for the source repo's own release and tag.
4. Configure main's ruleset to require **Verify release**, require a PR, and require the branch to be up to date. Keep feature PR versions unique; two PRs both proposing the same version cannot ship unchanged.
5. Merge the workflow PR, then inspect its **Release Windows** run. Done: automated publishing has worked since 0.3.12 (its CHANGELOG entry records the first run's fixes). `workflow_dispatch` on main supports recovery after fixing credentials.

## Boundaries and recovery

- The mirror (`anyBot-updates`) is deliberately not a git mirror. Its only tracked file is README.md, and its release tags point to that README history; source tags point to the exact source commit.
- GitHub always adds “Source code (zip)” and “Source code (tar.gz)” to every release. On `gilfila/anyBot` they are the real (public) source; on the mirror they are archives of its README. GitHub offers no setting to remove them. The link to share with users is https://github.com/gilfila/anyBot/releases/latest, the download page and update feed since 0.3.23; the mirror's README link keeps working for older installs.
- Release assets are only the NSIS installer, `.exe.blockmap`, and `latest.yml`, plus `AnyBot-phone.apk` on `gilfila/anyBot` when the phone signing secrets are set. Build provenance/hashes stay in the Actions artifact (version, source commit, and SHA-256 hashes only); there is no unpacked app, debug log, test data, or audit attachment.
- Electron necessarily includes executable JavaScript in its installer; ASAR packaging does not make distributed client code unrecoverable, and the source repo is public. Keep secrets and genuinely private server logic outside the app.
- Builds from superseded main commits cannot promote a release. Older versions cannot downgrade Latest. Existing tags or versions belonging to a different source commit are rejected. Never reuse or move a published version.
- Failed uploads remain drafts and do not change the live update feed. Retrying the same commit can replace unpublished draft assets. A published release is never overwritten: if a rebuilt installer differs, use a new patch version. If publishing succeeded but a later download-page/feed check failed, inspect the existing release before retrying; do not delete the live release.
- The public README is allowlisted before publication; any unexpected tracked file halts publishing for review. Credential tokens exist only in the publishing job, after all builds finish.

Official references: [GitHub release archives](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases), [GitHub App authentication in Actions](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow).
