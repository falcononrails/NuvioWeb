#!/usr/bin/env python3
"""Queue a checked image revision without giving the HTTP receiver Docker access."""
import hmac
import os
import re
import socketserver
from http.server import BaseHTTPRequestHandler
from pathlib import Path

REQUESTS = Path('/srv/nuvio-web/image-requests')


class DeployHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        self.connection.settimeout(15)
        expected = 'Bearer ' + os.environ['DEPLOY_TOKEN']
        if not hmac.compare_digest(self.headers.get('Authorization', ''), expected):
            self.send_error(401)
            return
        match = re.fullmatch(r'/__deploy/([0-9a-f]{40})', self.path)
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            length = 0
        if not match or not 0 < length <= 64 or self.rfile.read(length).strip() != b'{}':
            self.send_error(400)
            return
        # The root-owned worker validates this again and pulls only five fixed
        # repositories. This receiver cannot submit commands or Compose files.
        temporary = REQUESTS / 'pending.tmp'
        temporary.write_text(match[1], encoding='ascii')
        temporary.replace(REQUESTS / 'pending')
        self.send_response(202)
        self.end_headers()
        self.wfile.write(b'Image deployment queued. Check release.json for completion.\n')

    def log_message(self, fmt, *args):
        print(fmt % args, flush=True)


if __name__ == '__main__':
    path = '/run/nuvio-deploy/deploy.sock'
    if os.path.exists(path):
        os.unlink(path)
    with socketserver.UnixStreamServer(path, DeployHandler) as server:
        os.chmod(path, 0o666)
        server.serve_forever()
