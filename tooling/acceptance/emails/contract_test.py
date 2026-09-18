import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from contract import COMMANDS, ENTRYPOINT, Refused, canonical, digest, has_repo_digest, inspected_container, inspected_image, loads, pair_input, same_execution_config
from run import Docker, cleanup_owned_resources, main


def fixture(family="oci"):
    config = {"WorkingDir": "/app", "User": "1000:1000", "Entrypoint": ENTRYPOINT, "Cmd": COMMANDS["api"],
              "Env": ["HOME=/home/bun", "NODE_ENV=production"], "Volumes": {"/tmp": {}},
              "Labels": {"org.opencontainers.image.revision": "a"*40, "org.opencontainers.image.version": "1.2.3",
                         "org.opencontainers.image.source": "https://github.com/hasna/apps"}}
    diff = digest(b"synthetic tar bytes")
    stored = {"config": config, "os": "linux", "architecture": "amd64", "rootfs": {"type": "layers", "diff_ids": [diff]}}
    config_raw = canonical(stored)
    if family == "oci":
        media, cfg, layer = "application/vnd.oci.image.manifest.v1+json", "application/vnd.oci.image.config.v1+json", "application/vnd.oci.image.layer.v1.tar+gzip"
    else:
        media, cfg, layer = "application/vnd.docker.distribution.manifest.v2+json", "application/vnd.docker.container.image.v1+json", "application/vnd.docker.image.rootfs.diff.tar.gzip"
    manifest = {"schemaVersion": 2, "mediaType": media, "config": {"digest": digest(config_raw), "size": len(config_raw), "mediaType": cfg},
                "layers": [{"digest": digest(b"compressed synthetic tar bytes"), "size": 100, "mediaType": layer}]}
    manifest_raw = canonical(manifest)
    expected = {"image": "fixture.test/emails@"+digest(manifest_raw), "source_sha": "a"*40, "version": "1.2.3", "command": COMMANDS["api"],
                "manifest_path": "/fixture/manifest.json", "config_path": "/fixture/config.json"}
    row = {"RepoDigests": [expected["image"]], "Os": "linux", "Architecture": "amd64", "Id": digest(config_raw), "Config": config,
           "RootFS": {"Type": "layers", "Layers": [diff]}}
    return expected, [row], manifest_raw, config_raw


class AdmissionTests(unittest.TestCase):
    def test_docker_linux_serialization_defaults_do_not_change_execution_config(self):
        raw = {"User": "1000:1000", "Env": ["NODE_ENV=production"], "Entrypoint": ENTRYPOINT, "Cmd": COMMANDS["api"], "ArgsEscaped": True}
        inspected = {key: value for key, value in raw.items() if key != "ArgsEscaped"}
        inspected.update(OnBuild=None, Hostname="", AttachStdin=False)
        same_execution_config(raw, inspected)
        for extra in ({"Env": ["NODE_ENV=changed"]}, {"Entrypoint": ["/bin/sh"]}, {"OnBuild": ["unexpected"]},
                      {"Hostname": "other"}, {"UnknownRuntimeOption": True}, {"ArgsEscaped": "invalid"}):
            with self.assertRaises(Refused): same_execution_config(raw, {**inspected, **extra})

    def test_docker_hub_aliases_preserve_repository_and_exact_digest(self):
        value = digest(b"postgres")
        row = {"RepoDigests": ["postgres@"+value]}
        for name in ("docker.io/library/postgres", "index.docker.io/library/postgres", "docker.io/postgres", "library/postgres"):
            self.assertTrue(has_repo_digest(row, name+"@"+value))
        self.assertFalse(has_repo_digest(row, "different.test/library/postgres@"+value))
        self.assertFalse(has_repo_digest(row, "docker.io/another/postgres@"+value))
        self.assertFalse(has_repo_digest(row, "docker.io/library/postgres@"+digest(b"changed")))

    def test_actual_byte_binding_accepts_both_supported_manifest_families(self):
        for family in ("oci", "docker"):
            expected, rows, manifest, config = fixture(family)
            self.assertEqual(inspected_image("api", expected, rows, manifest, config)["config_id"], rows[0]["Id"])
            with self.assertRaisesRegex(Refused, "IMAGE_MANIFEST_BYTES"):
                inspected_image("api", expected, rows, manifest+b" ", config)
            with self.assertRaisesRegex(Refused, "IMAGE_CONFIG_BYTES"):
                inspected_image("api", expected, rows, manifest, config+b" ")

    def test_mixed_family_indexes_foreign_layers_and_layer_bounds_refuse(self):
        for change in (lambda m: m.update(mediaType="application/vnd.oci.image.index.v1+json"),
                       lambda m: m["config"].update(mediaType="application/vnd.docker.container.image.v1+json"),
                       lambda m: m["layers"][0].update(urls=["https://external.invalid/layer"]),
                       lambda m: m["layers"][0].update(size=0), lambda m: m.update(layers=[])):
            expected, rows, manifest, config = fixture()
            value = loads(manifest); change(value); raw = canonical(value)
            expected["image"] = "fixture.test/emails@"+digest(raw); rows[0]["RepoDigests"] = [expected["image"]]
            with self.assertRaises(Refused):
                inspected_image("api", expected, rows, raw, config)

    def test_actual_local_image_drift_never_accepts_matching_labels_alone(self):
        for change in (lambda r: r.update(Id=digest(b"different image")),
                       lambda r: r.update(Architecture="arm64"), lambda r: r.update(RepoDigests=[]),
                       lambda r: r["RootFS"].update(Layers=[digest(b"changed filesystem")]),
                       lambda r: r["Config"].update(Entrypoint=["/bin/sh"]),
                       lambda r: r["Config"]["Env"].append("AWS_PROFILE=external")):
            expected, rows, manifest, config = fixture(); change(rows[0])
            with self.assertRaises(Refused):
                inspected_image("api", expected, rows, manifest, config)

    def test_closed_pair_input_and_schema_agnostic_migration_map(self):
        expected, _, _, _ = fixture()
        pair = {"schema_version": 1, "api": expected, "worker": {**expected, "command": COMMANDS["worker"]},
                "postgres": {"image": "fixture.test/postgres@"+digest(b"pg")}, "migrations": {"migration-1": digest(b"sql")}}
        self.assertEqual(pair_input(canonical(pair)), pair)
        for change in (lambda p: p["api"].update(command=["-e", "arbitrary"]), lambda p: p["api"].update(image="fixture.test/emails:latest"),
                       lambda p: p.update(production_url="https://external.invalid"), lambda p: p.update(migrations={}),
                       lambda p: p["api"].update(source_sha="main"), lambda p: p["api"].update(manifest_path="relative")):
            changed = copy.deepcopy(pair); change(changed)
            with self.assertRaises(Refused): pair_input(canonical(changed))
        for raw in (b'{"schema_version":1,"schema_version":1}', b'{"x":NaN}'):
            with self.assertRaises(Refused): loads(raw)

    def test_running_container_must_have_actual_image_command_and_isolation(self):
        expected, rows, manifest, config = fixture()
        admitted = inspected_image("worker", expected, rows, manifest, config)
        row = {"Name": "/fixture", "Image": admitted["config_id"], "Path": ENTRYPOINT[0], "Args": COMMANDS["worker"],
               "HostConfig": {"NetworkMode": "fixture-net", "Privileged": False, "ReadonlyRootfs": True, "IpcMode": "private",
                              "CapDrop": ["ALL"], "SecurityOpt": ["no-new-privileges"]}, "NetworkSettings": {"Networks": {"fixture-net": {}}}}
        inspected_container([row], admitted, "fixture-net", "fixture")
        for change in (lambda r: r.update(Image=digest(b"another")), lambda r: r.update(Args=COMMANDS["api"]),
                       lambda r: r["HostConfig"].update(NetworkMode="host"), lambda r: r["HostConfig"].update(Privileged=True),
                       lambda r: r["HostConfig"].update(CapAdd=["SYS_ADMIN"]), lambda r: r["NetworkSettings"]["Networks"].update(external={}),
                       lambda r: r.update(Mounts=[{"Type": "bind", "Destination": "/app", "RW": False}])):
            changed = copy.deepcopy(row); change(changed)
            with self.assertRaises(Refused): inspected_container([changed], admitted, "fixture-net", "fixture")

    def test_docker_calls_ignore_host_credentials_remote_context_and_capture_failures(self):
        with tempfile.TemporaryDirectory() as directory, patch("run.shutil.which", return_value="/usr/bin/docker"), patch("run.subprocess.run") as run:
            run.return_value = type("Result", (), {"returncode": 1, "stdout": b"", "stderr": b"private arbitrary image diagnostic"})()
            docker = Docker(Path(directory))
            with patch.dict("os.environ", {"DOCKER_HOST": "tcp://remote.invalid:2375", "AWS_ACCESS_KEY_ID": "unused", "HOME": "/private"}):
                with self.assertRaisesRegex(Refused, "^CONTAINER_COMMAND_FAILED$"): docker.call("image", "inspect", "fixture")
            args, kwargs = run.call_args
            self.assertEqual(args[0][:3], ["/usr/bin/docker", "--host", "unix:///var/run/docker.sock"])
            self.assertEqual(set(kwargs["env"]), {"PATH", "DOCKER_CONFIG"})
            self.assertNotIn("HOME", kwargs["env"])

    def test_image_drift_after_create_refuses_before_process_start(self):
        with tempfile.TemporaryDirectory() as directory, patch("run.shutil.which", return_value="/usr/bin/docker"):
            d = Docker(Path(directory))
            expected, rows, manifest, config = fixture()
            admitted = inspected_image("api", expected, rows, manifest, config)
            with patch.object(d, "call") as call, patch.object(d, "json", return_value=[{"Name": "/different", "Image": digest(b"wrong")} ]):
                with self.assertRaisesRegex(Refused, "CONTAINER_IMAGE_DRIFT"):
                    d.start("api", expected["image"], COMMANDS["api"], admitted=admitted)
                self.assertEqual([c.args[0] for c in call.call_args_list], ["create"])

    def test_bad_input_produces_failed_proof_without_constructing_docker(self):
        with tempfile.TemporaryDirectory() as directory:
            pair, output = Path(directory) / "pair.json", Path(directory) / "proof.json"
            pair.write_bytes(b'{"schema_version":1}')
            with patch("run.Docker") as docker, patch("sys.argv", ["run.py", "--pair", str(pair), "--output", str(output)]), patch("builtins.print"):
                self.assertEqual(main(), 1)
            docker.assert_not_called()
            proof = json.loads(output.read_bytes())
            self.assertEqual(proof["status"], "failed")
            self.assertFalse(proof["deployment_authorized"])
            self.assertFalse(proof["production_configuration_verified"])

    def test_uncertain_network_create_is_reconciled_and_only_owned_label_removed(self):
        with tempfile.TemporaryDirectory() as directory, patch("run.shutil.which", return_value="/usr/bin/docker"):
            d = Docker(Path(directory))
            with patch.object(d, "call", side_effect=Refused("CONTAINER_COMMAND_UNCERTAIN")):
                with self.assertRaises(Refused): d.create_network()
            self.assertTrue(d.network_created)
            result = type("Result", (), {"returncode": 0, "stdout": (d.network+"\n").encode()})()
            with patch.object(d, "call", return_value=result) as call, patch.object(d, "json", return_value=[{"Labels": {"emails.pair": d.prefix}}]):
                self.assertTrue(d.cleanup())
                self.assertEqual(call.call_args_list[-1].args, ("network", "rm", d.network))
            with patch.object(d, "call", return_value=result) as call, patch.object(d, "json", return_value=[{"Labels": {"emails.pair": "another"}}]):
                self.assertFalse(d.cleanup())
                self.assertFalse(any("rm" in c.args for c in call.call_args_list))

    def test_ci_fallback_refuses_foreign_resource_names_or_changed_labels(self):
        with tempfile.TemporaryDirectory() as directory, patch("run.shutil.which", return_value="/usr/bin/docker"):
            d = Docker(Path(directory))
            result = type("Result", (), {"returncode": 0, "stdout": b"foreign-container\n"})()
            with patch.object(d, "call", return_value=result) as call:
                with self.assertRaisesRegex(Refused, "CI_RESOURCE_OWNERSHIP"): cleanup_owned_resources(d, "a"*20)
                self.assertEqual(len(call.call_args_list), 1)
            result.stdout = b"emails-pair-aaaaaaaaaaaaaaaaaaaa-api-ses\n"
            with patch.object(d, "call", return_value=result) as call, patch.object(d, "json", return_value=[{"Config": {"Labels": {"emails.pair": "changed"}}}]):
                with self.assertRaisesRegex(Refused, "CI_RESOURCE_LABEL"): cleanup_owned_resources(d, "a"*20)
                self.assertFalse(any("rm" in c.args for c in call.call_args_list))

    def test_runner_interruption_enters_cleanup_and_emits_failed_proof(self):
        expected, _, _, _ = fixture()
        pair = {"schema_version": 1, "api": expected, "worker": {**expected, "command": COMMANDS["worker"]},
                "postgres": {"image": "fixture.test/postgres@"+digest(b"pg")}, "migrations": {"migration-1": digest(b"sql")}}
        with tempfile.TemporaryDirectory() as directory:
            path, output = Path(directory) / "pair.json", Path(directory) / "proof.json"
            path.write_bytes(canonical(pair))
            with patch("run.Docker") as docker, patch("run.Acceptance") as acceptance, patch("builtins.print"), patch("sys.argv", ["run.py", "--pair", str(path), "--output", str(output)]):
                docker.return_value.prefix = "a"*20
                docker.return_value.cleanup.return_value = True
                def interrupt():
                    import signal
                    signal.raise_signal(signal.SIGTERM)
                acceptance.return_value.execute.side_effect = interrupt
                self.assertEqual(main(), 1)
                docker.return_value.cleanup.assert_called_once()
            proof = json.loads(output.read_bytes())
            self.assertEqual(proof["failure_code"], "RUNNER_INTERRUPTED")
            self.assertTrue(proof["cleanup_complete"])


if __name__ == "__main__":
    unittest.main()
