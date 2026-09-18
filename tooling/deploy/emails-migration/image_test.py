#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("emails_migration_image", ROOT / "image.py")
image = importlib.util.module_from_spec(spec)
spec.loader.exec_module(image)
SOURCE = "a" * 40
DIGEST = "sha256:" + "b" * 64


class ImageTest(unittest.TestCase):
    def test_current_image_binds_exact_source_modules_and_registry_digest(self):
        with tempfile.TemporaryDirectory() as temporary:
            emails = Path(temporary)
            (emails / "package.json").write_text('{"version":"1.6.3"}')
            inputs = {}
            for name in image.admission.MODULES:
                if name.startswith("app/src/"):
                    path = emails / name.removeprefix("app/")
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(name)
                    inputs[name] = image.promotion.digest(path.read_bytes())
            inspected = {"sourceRevision": SOURCE, "imageVersion": "1.6.3", "imageDigest": DIGEST,
                         "configDigest": DIGEST, "definitionInputsDigest": DIGEST,
                         "definitionInputs": inputs, "layersVerified": 3}
            with patch.object(image.promotion, "aws", return_value={"Account": image.promotion.ACCOUNT}) as aws, \
                 patch.object(image.admission, "inspect", return_value=inspected) as inspect:
                receipt = image.prepare(SOURCE, DIGEST, emails)
            self.assertEqual(aws.call_args.args, ("sts", "get-caller-identity"))
            self.assertEqual(inspect.call_args.args, (DIGEST, image.promotion))
            self.assertEqual(receipt["sourceModules"], inputs)
            self.assertEqual(receipt["imageDigest"], DIGEST)
            self.assertFalse(any(receipt[key] for key in ("taskRegistered", "taskLaunched", "serviceUpdated", "databaseMutated")))
            with patch.object(image.promotion, "aws", return_value={"Account": image.promotion.ACCOUNT}), \
                 patch.object(image.admission, "inspect", return_value={**inspected, "sourceRevision": "c" * 40}):
                with self.assertRaisesRegex(ValueError, "IMAGE_SOURCE_OR_VERSION"):
                    image.prepare(SOURCE, DIGEST, emails)
            with patch.object(image.promotion, "aws", return_value={"Account": image.promotion.ACCOUNT}), \
                 patch.object(image.admission, "inspect", return_value={**inspected, "definitionInputs": {**inputs, next(iter(inputs)): DIGEST}}):
                with self.assertRaisesRegex(ValueError, "IMAGE_SOURCE_MODULE_MISMATCH"):
                    image.prepare(SOURCE, DIGEST, emails)

    def test_invalid_identity_refuses_before_aws(self):
        with patch.object(image.promotion, "aws", side_effect=AssertionError("AWS must not be called")):
            with self.assertRaisesRegex(ValueError, "SOURCE_COMMIT"):
                image.prepare("invalid", DIGEST)
            with self.assertRaisesRegex(ValueError, "BAD_DIGEST"):
                image.prepare(SOURCE, "invalid")

    def test_cli_refuses_non_main_dispatch_before_aws(self):
        with patch.object(sys, "argv", ["image.py", "--source", SOURCE, "--image-digest", DIGEST,
                                        "--out", "unused"]), \
             patch.dict(image.os.environ, {"GITHUB_REPOSITORY": "hasna/apps",
                                            "GITHUB_REF": "refs/heads/feature",
                                            "GITHUB_EVENT_NAME": "workflow_dispatch",
                                            "GITHUB_SHA": SOURCE}), \
             patch.object(image.promotion, "aws", side_effect=AssertionError("AWS must not be called")):
            with self.assertRaisesRegex(ValueError, "MAIN_DISPATCH_ONLY"):
                image.main()


if __name__ == "__main__":
    unittest.main()
