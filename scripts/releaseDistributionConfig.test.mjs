import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function readRepositoryFile(path) {
  return readFile(new URL(path, root), "utf8");
}

test("publishing includes all fork services and keeps beta and nightly out of stable", async () => {
  const workflow = await readRepositoryFile(".github/workflows/publish-ghcr.yml");
  assert.match(workflow, /branches: \[nightly\]/);
  assert.doesNotMatch(workflow, /ghcr\.io\/alphasquare404|refs\/heads\/web|value=desktop/);
  assert.match(workflow, /images: ghcr\.io\/falcononrails\/\$\{\{ matrix.image \}\}/);
  for (const suffix of ["", "-playback-bridge", "-trakt-auth-bridge", "-debrid-api-bridge", "-external-return-bridge"]) {
    assert.ok(workflow.split(/\r?\n/).some(line => line.trim() === `- image: nuvioweb${suffix}`));
  }
  for (const tag of ["stable", "latest"]) {
    const rule = workflow.split("\n").find(line => line.includes(`type=raw,value=${tag},`));
    assert.ok(rule.includes("startsWith(github.ref, 'refs/tags/v') && !contains(github.ref_name, '-')"));
  }
  assert.match(workflow, /flavor: latest=false/);
  assert.match(workflow, /needs: \[checks, compose\]/);
  assert.match(workflow, /needs: publish/);
  assert.match(workflow, /platforms: linux\/amd64,linux\/arm64/);
  assert.match(workflow, /needs: verify-images/);
  const composeChecks = await readRepositoryFile(".github/workflows/docker-compose.yml");
  assert.match(composeChecks, /runner: \[ubuntu-24.04, ubuntu-24.04-arm\]/);
  assert.match(composeChecks, /--no-build --pull always --wait/);
  assert.match(composeChecks, /ffmpeg.*-c:a aac/);
  assert.match(workflow, /--prerelease --latest=false/);
  assert.match(workflow, /Release tag must match package.json version/);
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
