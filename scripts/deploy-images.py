#!/usr/bin/env python3
"""Deploy our five ARM64 images by digest, retaining the last healthy set."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.request

ROOT = Path('/opt/nuvio-web/images')
REQUESTS = Path('/srv/nuvio-web/image-requests')
IMAGES = {
    'nuvioweb': 'nuvioweb',
    'playback-bridge': 'nuvioweb-playback-bridge',
    'trakt-auth-bridge': 'nuvioweb-trakt-auth-bridge',
    'debrid-api-bridge': 'nuvioweb-debrid-api-bridge',
    'external-return-bridge': 'nuvioweb-external-return-bridge',
}


def revision(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{40}', value):
        raise ValueError('Expected a full lowercase Git commit ID')
    return value


def image_reference(info, repository, commit):
    if info.get('Architecture') != 'arm64' or info.get('Os') != 'linux':
        raise ValueError('Image is not native Linux ARM64')
    if info.get('Config', {}).get('Labels', {}).get('org.opencontainers.image.revision') != commit:
        raise ValueError('Image revision does not match the checked build')
    for ref in info.get('RepoDigests', []):
        if re.fullmatch(re.escape(repository) + r'@sha256:[0-9a-f]{64}', ref):
            return ref
    raise ValueError('Image has no digest for the expected repository')


def command(args, **kwargs):
    return subprocess.run(args, check=True, timeout=600, **kwargs)


def compose(lock):
    command(['docker', 'compose', '--project-name', 'nuvio-images',
             '--env-file', str(ROOT / '.env'),
             '-f', str(ROOT / 'compose.yaml'), '-f', str(ROOT / 'production.yaml'),
             '-f', str(lock), 'up', '-d', '--no-build', '--pull', 'never',
             '--wait', '--wait-timeout', '120'])


def verify(commit):
    def get(path):
        with urllib.request.urlopen('http://127.0.0.1:4873/' + path, timeout=15) as response:
            return json.load(response)
    if get('release.json').get('commit') != commit:
        raise RuntimeError('Frontend is not serving the requested image')
    if get('api/playback/health').get('revision') != commit:
        raise RuntimeError('Playback is not serving the requested image')
    for name in ['trakt', 'debrid', 'external-return']:
        health = get(f'api/{name}/health')
        if name == 'debrid' and health.get('revision') != commit:
            raise RuntimeError('Debrid is not serving the requested image')
    push = get('api/external-return/push/public-key')
    if not push.get('enabled') or not push.get('episodes'):
        raise RuntimeError('Episode notifications are not configured')


def activate(candidate, commit):
    current = ROOT / 'current.json'
    try:
        compose(candidate)
        verify(commit)
    except Exception:
        if current.exists():
            print('Startup check failed; restoring the previous image digests.', flush=True)
            compose(current)
            verify(json.loads(current.read_text())['x-revision'])
        raise
    if current.exists() and current.read_bytes() != candidate.read_bytes():
        previous = ROOT / 'previous.tmp'
        previous.write_bytes(current.read_bytes())
        previous.replace(ROOT / 'previous.json')
    candidate.replace(current)
    print(f'Deployed {commit} with all five images pinned by digest.', flush=True)


def deploy(commit):
    commit = revision(commit)
    services = {}
    for service, image in IMAGES.items():
        repository = 'ghcr.io/falcononrails/' + image
        tag = repository + ':sha-' + commit
        command(['docker', 'pull', tag])
        result = command(['docker', 'image', 'inspect', tag], capture_output=True, text=True)
        ref = image_reference(json.loads(result.stdout)[0], repository, commit)
        services[service] = {'image': ref}
        print(f'{service}: {ref}', flush=True)
    candidate = ROOT / 'candidate.json'
    candidate.write_text(json.dumps({'x-revision': commit, 'services': services}, indent=2) + '\n')
    activate(candidate, commit)


def main():
    import fcntl
    # ponytail: one deployment lock for this single production stack.
    with (ROOT / '.deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if sys.argv[1:] == ['--rollback']:
            candidate = ROOT / 'candidate.json'
            candidate.write_bytes((ROOT / 'previous.json').read_bytes())
            activate(candidate, revision(json.loads(candidate.read_text())['x-revision']))
        elif len(sys.argv) == 2:
            deploy(sys.argv[1])
        elif len(sys.argv) == 1:
            processing = REQUESTS / 'processing'
            (REQUESTS / 'pending').replace(processing)
            # The queue is untrusted even though the HTTP receiver checks it.
            fd = os.open(processing, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, 'r', encoding='ascii') as request:
                commit = revision(request.read(41))
            processing.unlink()
            deploy(commit)
        else:
            raise ValueError('Usage: deploy-images.py [COMMIT | --rollback]')


if __name__ == '__main__':
    main()
