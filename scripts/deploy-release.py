#!/usr/bin/env python3
"""Forced SSH command for the nuvio-deploy account. Accepts a built site only."""
import fcntl
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tarfile
import tempfile

ROOT = Path('/srv/nuvio-web')
command = re.fullmatch(r'deploy ([0-9a-f]{40})', os.environ.get('SSH_ORIGINAL_COMMAND', ''))
if not command:
    sys.exit('Only a release deployment is permitted.')
revision = command[1]
with (ROOT / '.deploy.lock').open('w') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    with tempfile.TemporaryDirectory(prefix='.incoming-', dir=ROOT) as temporary:
        staging = Path(temporary)
        archive = staging / 'release.tar.gz'
        maximum = 100 * 1024 * 1024
        size = 0
        with archive.open('wb') as output:
            while chunk := sys.stdin.buffer.read(1024 * 1024):
                size += len(chunk)
                if size > maximum:
                    sys.exit('Release exceeds upload limit.')
                output.write(chunk)
        site = staging / 'site'
        site.mkdir()
        with tarfile.open(archive, 'r:gz') as bundle:
            members = bundle.getmembers()
            if len(members) > 12000 or sum(item.size for item in members) > 400 * 1024 * 1024:
                sys.exit('Release exceeds extraction limit.')
            for member in members:
                path = PurePosixPath(member.name)
                if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
                    sys.exit('Invalid release member.')
                destination = site.joinpath(*path.parts)
                if member.isdir():
                    destination.mkdir(parents=True, exist_ok=True)
                else:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with bundle.extractfile(member) as source, destination.open('wb') as target:
                        shutil.copyfileobj(source, target)
                    destination.chmod(0o644)
        if not (site / 'index.html').is_file() or json.loads((site / 'release.json').read_text())['commit'] != revision:
            sys.exit('Release identity does not match the upload.')
        release = ROOT / 'releases' / ('nightly-' + revision)
        if release.exists():
            sys.exit('Release already exists; dispatch a new commit.')
        site.rename(release)
        current = ROOT / 'current'
        if current.is_symlink():
            previous = ROOT / '.previous-new'
            previous.unlink(missing_ok=True)
            previous.symlink_to(os.readlink(current))
            previous.replace(ROOT / 'previous')
        replacement = ROOT / '.current-new'
        replacement.unlink(missing_ok=True)
        replacement.symlink_to('releases/' + release.name)
        replacement.replace(current)
        print('Deployed ' + revision)
