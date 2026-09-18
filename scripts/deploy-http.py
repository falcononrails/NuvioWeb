#!/usr/bin/env python3
"""Receive checked GitHub builds through the existing HTTPS proxy."""
import hmac
import os
import re
import socketserver
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler


class DeployHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        self.connection.settimeout(90)
        expected = "Bearer " + os.environ["DEPLOY_TOKEN"]
        if not hmac.compare_digest(self.headers.get("Authorization", ""), expected):
            self.send_error(401)
            return
        match = re.fullmatch(r"/__deploy/([0-9a-f]{40})", self.path)
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if not match or not 0 < length <= 100 * 1024 * 1024:
            self.send_error(400)
            return
        with tempfile.TemporaryFile() as upload:
            remaining = length
            while remaining:
                block = self.rfile.read(min(remaining, 1024 * 1024))
                if not block:
                    self.send_error(400)
                    return
                upload.write(block)
                remaining -= len(block)
            upload.seek(0)
            result = subprocess.run(
                ["/usr/local/bin/nuvio-deploy-release"],
                stdin=upload, capture_output=True, timeout=90,
                env={**os.environ, "SSH_ORIGINAL_COMMAND": "deploy " + match[1]},
            )
        if result.returncode:
            print(result.stderr.decode(errors="replace"), flush=True)
            self.send_error(409, "Release installation failed")
            return
        self.send_response(200)
        self.end_headers()
        self.wfile.write(result.stdout)

    def log_message(self, fmt, *args):
        print(fmt % args, flush=True)


if __name__ == "__main__":
    path = "/run/nuvio-deploy/deploy.sock"
    if os.path.exists(path):
        os.unlink(path)
    # Serialized deployments share the atomic installer lock used by SSH.
    with socketserver.UnixStreamServer(path, DeployHandler) as server:
        os.chmod(path, 0o666)
        server.serve_forever()
