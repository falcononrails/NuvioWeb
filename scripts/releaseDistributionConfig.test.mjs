import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function readRepositoryFile(path) {
  return readFile(new URL(path, root), "utf8");
}

function metadataTagBlocks(workflow) {
  return [...workflow.matchAll(/id: (?:frontend|trakt|debrid|external-return)-meta[\s\S]*?tags: \|\r?\n((?:\s+type=.*\r?\n)+)/g)].map((match) =>
    match[1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

test("GHCR publishing separates web development and release channels consistently", async () => {
  const workflow = await readRepositoryFile(".github/workflows/publish-ghcr.yml");

  assert.match(workflow, /branches:\s*\n\s*- web/);
  assert.match(workflow, /tags:\s*\n\s*- "v\*"/);
  assert.doesNotMatch(workflow, /branches:\s*\n\s*- main/);
  assert.doesNotMatch(workflow, /branches:\s*\n\s*- desktop/);
  assert.doesNotMatch(workflow, /type=raw,value=web/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/web'/);
  const tagBlocks = metadataTagBlocks(workflow);
  const expectedTags = [
    "type=raw,value=nightly,enable=${{ github.ref == 'refs/heads/web' }}",
    "type=raw,value=latest",
    "type=raw,value=desktop",
    "type=raw,value=stable,enable=${{ startsWith(github.ref, 'refs/tags/v') }}",
    "type=semver,pattern={{version}},enable=${{ startsWith(github.ref, 'refs/tags/v') }}",
    "type=sha,format=short,prefix=sha-",
  ];

  assert.equal(tagBlocks.length, 4);
  assert.deepEqual(tagBlocks, [expectedTags, expectedTags, expectedTags, expectedTags]);
  assert.match(workflow, /steps\.frontend-meta\.outputs\.tags/);
  assert.match(workflow, /steps\.trakt-meta\.outputs\.tags/);
  assert.match(workflow, /steps\.debrid-meta\.outputs\.tags/);
  assert.match(workflow, /steps\.external-return-meta\.outputs\.tags/);
});

test("Compose builds this fork and keeps conversion behind the same-origin proxy", async () => {
  const [compose, nginx, playback] = await Promise.all([
    readRepositoryFile("docker-compose.yml"), readRepositoryFile("nginx/default.conf"),
    readRepositoryFile("services/playback-bridge/Dockerfile")
  ]);
  assert.doesNotMatch(compose, /ghcr\.io\/alphasquare404/);
  assert.match(compose, /build: \./);
  for (const service of ["playback", "trakt-auth", "debrid-api", "external-return"])
    assert.ok(compose.includes(`dockerfile: services/${service}-bridge/Dockerfile`));
  assert.equal((compose.match(/ports:/g) || []).length, 1, "Only the frontend publishes a port");
  assert.match(compose, /read_only: true/);
  assert.match(compose, /NUVIO_ORIGIN:/);
  assert.match(playback, /COPY services\/playback-bridge\/server\.mjs/);
  assert.match(nginx, /location \^~ \/api\/playback\//);
  assert.match(nginx, /proxy_read_timeout 65s/);
});

test("Environment configuration retains hosted defaults and server-only Trakt values", async () => {
  const [environmentTemplate, environmentDocs] = await Promise.all([
    readRepositoryFile(".env.example"),
    readRepositoryFile("docs/environment.md"),
  ]);

  assert.match(environmentTemplate, /NUVIO_SUPABASE_URL=https:\/\/api\.nuvio\.tv/);
  assert.match(environmentTemplate, /NUVIO_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1Ni/);
  assert.match(environmentTemplate, /NUVIO_SUPABASE_FALLBACK_URL=https:\/\/api-two\.nuvioapp\.space/);
  assert.match(environmentTemplate, /TRAKT_CLIENT_SECRET=/);
  assert.match(environmentTemplate, /Server-only Trakt bridge values/);
  assert.doesNotMatch(environmentTemplate, /service[_-]?role/i);
  assert.match(environmentDocs, /Frontend-only self-hosting \(recommended\)/);
  assert.match(environmentDocs, /Full self-hosting \(advanced\)/);
  assert.match(environmentDocs, /TRAKT_CLIENT_SECRET.*Server-only/s);
});
