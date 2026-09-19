import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { readAppMetadata } from "./appMetadata.mjs";

test("application metadata supplies the independent fork version and repository identity", async () => {
  const metadata = await readAppMetadata();

  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(metadata.version, packageJson.version);
  assert.equal(metadata.identity.version, packageJson.version);
  assert.equal(metadata.identity.upstreamVersion, "0.3.35");
  assert.equal(metadata.identity.maintainer, "falcononrails");
  assert.equal(metadata.identity.sourceRepositoryUrl, "https://github.com/falcononrails/NuvioWeb");
  assert.equal(metadata.identity.issuesUrl, "https://github.com/falcononrails/NuvioWeb/issues");
  assert.equal(
    metadata.identity.latestReleaseUrl,
    "https://api.github.com/repos/falcononrails/NuvioWeb/releases/latest"
  );
});


test("build channel and revision reach About without changing the package version", async () => {
  const previousChannel = process.env.NUVIO_RELEASE_CHANNEL;
  const previousRevision = process.env.NUVIO_BUILD_REVISION;
  try {
    for (const channel of ["nightly", "beta", "stable", "development"]) {
      process.env.NUVIO_RELEASE_CHANNEL = channel;
      process.env.NUVIO_BUILD_REVISION = "a".repeat(40);
      const { identity } = await readAppMetadata();
      assert.equal(identity.channel, channel);
      assert.equal(identity.revision, "a".repeat(40));
    }
    process.env.NUVIO_RELEASE_CHANNEL = "invalid";
    process.env.NUVIO_BUILD_REVISION = "not-a-commit";
    const { identity } = await readAppMetadata();
    assert.equal(identity.channel, "development");
    assert.equal(identity.revision, "");
  } finally {
    if (previousChannel === undefined) delete process.env.NUVIO_RELEASE_CHANNEL;
    else process.env.NUVIO_RELEASE_CHANNEL = previousChannel;
    if (previousRevision === undefined) delete process.env.NUVIO_BUILD_REVISION;
    else process.env.NUVIO_BUILD_REVISION = previousRevision;
  }
});
