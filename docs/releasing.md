# Automated Windows releases

PRs must increase the stable version in package.json and both root entries in package-lock.json, with a matching CHANGELOG heading. The **Release Windows / Verify release** check tests the app, runs the Electron runtime smoke check, builds/syncs mobile, builds the Windows NSIS installer from a real `npm ci`, verifies packaged runtime dependencies and UI assets, and checks latest.yml against the installer. Only merges to main publish; PRs never receive publishing credentials.

After merge the workflow downloads that run's verified artifact, mints a short-lived GitHub App token scoped to the public distribution repo, creates a draft public release, uploads exactly three files, verifies GitHub's SHA256 digests, tags the private source commit, promotes the release, updates the public download link, and verifies the live updater metadata. No local agent or developer packages or uploads release files.

## One-time activation

1. Resolve the GitHub account billing/spending restriction that currently prevents runners from starting.
2. Register a GitHub App owned by gilfila, with **Contents: read and write** and no other optional repository permissions. Disable webhooks. Install it only on **anyBot-updates**. It does not need access to the private source repo.
3. In the private **anyBot** repo, add Actions variable `RELEASE_APP_CLIENT_ID` and Actions secret `RELEASE_APP_PRIVATE_KEY` (the generated PEM key). Enter the key directly into GitHub; do not commit it, put it into the app, or paste it into chat. The workflow uses its built-in token solely for the private source tag.
4. Configure main's ruleset to require **Verify release**, require a PR, and require the branch to be up to date. Keep feature PR versions unique; two PRs both proposing the same version cannot ship unchanged.
5. Merge the workflow PR, then inspect its **Release Windows** run. Until a successful publish run verifies the live feed, automation is configured but not operational. `workflow_dispatch` on main supports recovery after fixing credentials or billing.

## Boundaries and recovery

- The public repo is deliberately not a git mirror. Its only tracked file is README.md. Public release tags point to that public README history; private source tags point to the exact source commit.
- GitHub always adds “Source code (zip)” and “Source code (tar.gz)” to its release UI. Those are archives of the public README, not the private app. GitHub does not offer an asset setting to remove them. Share the public repo's README download link, which goes straight to the installer. Removing those labels from the actual release UI requires a different download front end/host.
- Public assets are only the NSIS installer, `.exe.blockmap`, and `latest.yml`. Build provenance/hashes stay in the private Actions artifact; there is no public source zip, unpacked app, debug log, test data, or private audit attachment.
- Electron necessarily includes executable JavaScript in its installer; a private git repository and ASAR packaging do not make distributed client code unrecoverable. Keep secrets and genuinely private server logic outside the app.
- Builds from superseded main commits cannot promote a release. Older versions cannot downgrade Latest. Existing tags or versions belonging to a different source commit are rejected. Never reuse or move a published version.
- Failed uploads remain drafts and do not change the live update feed. Retrying the same commit can replace unpublished draft assets. A published release is never overwritten: if a rebuilt installer differs, use a new patch version. If publishing succeeded but a later download-page/feed check failed, inspect the existing release before retrying; do not delete the live release.
- The public README is allowlisted before publication; any unexpected tracked file halts publishing for review. Credential tokens exist only in the publishing job, after all builds finish.

Official references: [GitHub release archives](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases), [GitHub App authentication in Actions](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow).
