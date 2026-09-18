#!/usr/bin/env python3
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location("public_proof", Path(__file__).with_name("public_proof.py"))
proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)


class PublicProofTest(unittest.TestCase):
    def test_identifies_the_credential_free_probe_to_the_edge(self):
        def edge(request, timeout):
            # The public edge rejects the generic Python client identity.
            identity = request.get_header("User-agent", "Python-urllib")
            if identity != "HasnaEmailsDeployment/1.0 (+https://github.com/hasna/apps)":
                raise urllib.error.HTTPError(request.full_url, 403, "Forbidden", {}, None)
            self.assertEqual(request.full_url, proof.BASE + "/ready")
            self.assertEqual(timeout, 20)
            self.assertEqual(request.get_header("Accept"), "application/json")
            self.assertIsNone(request.get_header("Authorization"))
            self.assertIsNone(request.get_header("X-api-key"))
            response = io.BytesIO(b'{"status":"ready"}')
            response.status = 200
            response.geturl = lambda: request.full_url
            return response

        with patch.object(proof.urllib.request, "urlopen", side_effect=edge):
            self.assertEqual(proof.get("/ready"), {"status": "ready"})


if __name__ == "__main__":
    unittest.main()
