# Releases

`package.json` is the version source for the app and About; `npm version` updates the lockfile with it. The build receives its channel and commit from CI. Website pushes stay on the nightly channel. A tag publishes a separate beta or stable checkpoint without replacing the hosted nightly site.

## Publish

1. Update the package version, for example `npm version 0.2.0-beta.2 --no-git-tag-version --ignore-scripts`.
2. Optionally write user-facing notes in `docs/releases/v0.2.0-beta.2.md`. Without that file, GitHub generates the change list.
3. Commit and push to `nightly`. Wait for the nightly checks to pass.
4. Tag that same checked commit and push the tag:

```sh
git tag -a v0.2.0-beta.2 -m "NuvioWeb v0.2.0-beta.2"
git push origin v0.2.0-beta.2
```

Use the remote for your own fork (`personal` in checkouts where `origin` is upstream). Pick the next version deliberately; the examples are not an automatic version increment.

The publishing workflow rejects a tag that differs from `package.json`, runs tests and lint, builds and health-checks the whole Compose stack, then publishes all five images. It then starts the version-pinned Compose bundle from the published images without a registry login. Only after those checks succeed does it create the GitHub release and attach the bundle and checksum. Existing release notes and assets are not overwritten on reruns.

Tags containing a prerelease suffix, such as `v0.2.0-beta.2`, produce a GitHub pre-release and an exact Docker tag `0.2.0-beta.2`. They do not update `stable` or `latest`. A tag such as `v0.2.0` also updates those stable aliases. Nightly pushes publish `nightly`; all builds include a full-commit `sha-...` image tag.

The five GHCR packages must be public for anonymous self-hosting. Check package visibility when adding a service; repository visibility alone should not be assumed to make a package public. Published images currently target `linux/amd64`; ARM64 remains available through a source build.

Once published, keep release tags fixed. Fixes get a new version. Browser codec/source restrictions and the playback service's resource limits still apply to numbered releases.
