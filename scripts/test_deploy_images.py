"""Small regression check for the deployment trust boundary and rollback."""
import copy
import importlib.util
from http.server import HTTPServer
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('deploy_images', Path(__file__).with_name('deploy-images.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentCheck(unittest.TestCase):
    def test_receiver_only_queues_authenticated_commit_ids(self):
        receiver_spec = importlib.util.spec_from_file_location('deploy_http', Path(__file__).with_name('deploy-http.py'))
        receiver = importlib.util.module_from_spec(receiver_spec)
        receiver_spec.loader.exec_module(receiver)
        with tempfile.TemporaryDirectory() as directory, patch.object(receiver, 'REQUESTS', Path(directory)), patch.dict(receiver.os.environ, {'DEPLOY_TOKEN': 'test-token'}):
            with HTTPServer(('127.0.0.1', 0), receiver.DeployHandler) as server:
                worker = threading.Thread(target=server.serve_forever, daemon=True)
                worker.start()
                try:
                    for token, target, body, expected in [
                        ('wrong', 'a' * 40, '', 401),
                        ('test-token', '../other', '', 400),
                        ('test-token', 'a' * 40, '{"command":"docker"}', 400),
                        ('test-token', 'a' * 40, '{}', 202),
                    ]:
                        connection = http.client.HTTPConnection(*server.server_address, timeout=3)
                        connection.request('POST', '/__deploy/' + target, body, {'Authorization': 'Bearer ' + token})
                        response = connection.getresponse()
                        self.assertEqual(response.status, expected)
                        response.read()
                        connection.close()
                    self.assertEqual((Path(directory) / 'pending').read_text(), 'a' * 40)
                finally:
                    server.shutdown()
                    worker.join()

    def test_revision_digest_validation_and_failed_startup_restore(self):
        commit = 'a' * 40
        repository = 'ghcr.io/falcononrails/nuvioweb'
        ref = repository + '@sha256:' + 'b' * 64
        info = {'Architecture': 'arm64', 'Os': 'linux', 'RepoDigests': [ref],
                'Config': {'Labels': {'org.opencontainers.image.revision': commit}}}
        self.assertEqual(deploy.revision(commit), commit)
        self.assertEqual(deploy.image_reference(info, repository, commit), ref)
        for invalid in ['', '../secret', 'a' * 41, commit + '\n', 'nightly', None]:
            with self.assertRaises(ValueError):
                deploy.revision(invalid)
        for key, value in [('Architecture', 'amd64'), ('Os', 'windows'),
                           ('RepoDigests', [ref.replace('falcononrails', 'someoneelse')]),
                           ('Config', {'Labels': {'org.opencontainers.image.revision': 'c' * 40}})]:
            bad = copy.deepcopy(info)
            bad[key] = value
            with self.assertRaises(ValueError):
                deploy.image_reference(bad, repository, commit)
        with tempfile.TemporaryDirectory() as directory, patch.object(deploy, 'ROOT', Path(directory)):
            current = deploy.ROOT / 'current.json'
            candidate = deploy.ROOT / 'candidate.json'
            old = json.dumps({'x-revision': 'c' * 40, 'services': {}})
            new = json.dumps({'x-revision': commit, 'services': {}})
            current.write_text(old)
            candidate.write_text(new)
            with patch.object(deploy, 'compose') as start, patch.object(deploy, 'verify', side_effect=[RuntimeError('unhealthy'), None]):
                with self.assertRaises(RuntimeError):
                    deploy.activate(candidate, commit)
                self.assertEqual([call.args[0] for call in start.call_args_list], [candidate, current])
            self.assertEqual(current.read_text(), old)
            with patch.object(deploy, 'compose'), patch.object(deploy, 'verify'):
                deploy.activate(candidate, commit)
            self.assertEqual(current.read_text(), new)
            self.assertEqual((deploy.ROOT / 'previous.json').read_text(), old)


if __name__ == '__main__':
    unittest.main()
