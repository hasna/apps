#!/usr/bin/env python3
"""Build the isolated native microphone probe from the actual recorder source."""
import argparse
import hashlib
import json
import pathlib
import plistlib
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=pathlib.Path, required=True,
                    help="A new output directory outside installed applications.")
args = parser.parse_args()
output = args.output.expanduser().resolve()
for forbidden in [pathlib.Path("/Applications"), pathlib.Path.home() / "Applications", pathlib.Path.home() / "Library"]:
    if output == forbidden or forbidden in output.parents:
        parser.error("Output must be outside installed applications and Library state.")
if any(part.suffix == ".app" for part in [output, *output.parents]):
    parser.error("Output must not be inside an app bundle.")
if output.exists():
    parser.error("Output must be a new directory; existing builds are preserved.")
package = pathlib.Path(__file__).resolve().parents[3]
sources = [
    package / "src/native/Recordings/RecordingsLib/NativePCMRecorder.swift",
    package / "src/native/Recordings/RecordingsLib/CaptureDiagnostics.swift",
    pathlib.Path(__file__).with_name("main.swift"),
]
source_hashes = {str(p.relative_to(package)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
output.mkdir(parents=True, exist_ok=False)
bundle = output / "Recordings Microphone Check.app"
macos = bundle / "Contents/MacOS"
macos.mkdir(parents=True)
executable = macos / "RecordingsCaptureProbe"
subprocess.run(["xcrun", "swiftc", "-swift-version", "6", "-O", "-parse-as-library", "-target", "arm64-apple-macos14.0",
                *map(str, sources), "-framework", "AppKit", "-o", str(executable)], check=True, timeout=120)
after_hashes = {str(p.relative_to(package)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
if after_hashes != source_hashes:
    raise SystemExit("Sources changed during compilation; discard this diagnostic build.")
architectures = subprocess.check_output(["xcrun", "lipo", "-archs", str(executable)], text=True).strip()
if architectures != "arm64":
    raise SystemExit("Probe must contain only native ARM64 code.")
info = {
    "CFBundleIdentifier": "md.recordings.capture-probe.r62",
    "CFBundleName": "Recordings Microphone Check",
    "CFBundleDisplayName": "Recordings Microphone Check",
    "CFBundleExecutable": executable.name,
    "CFBundlePackageType": "APPL",
    "CFBundleVersion": "1",
    "CFBundleShortVersionString": "1.0",
    "LSMinimumSystemVersion": "14.0",
    "NSMicrophoneUsageDescription": "Measure microphone signal for eight seconds to diagnose capture. Audio is discarded and no network is used.",
    "NSHighResolutionCapable": True,
}
with (bundle / "Contents/Info.plist").open("wb") as f:
    plistlib.dump(info, f)
receipt = {
    "sources": source_hashes,
    "target": "arm64-apple-macos14.0",
    "architectures": architectures,
    "executableSHA256": hashlib.sha256(executable.read_bytes()).hexdigest(),
    "bundleIdentifier": info["CFBundleIdentifier"],
}
(output / "build-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(bundle)
