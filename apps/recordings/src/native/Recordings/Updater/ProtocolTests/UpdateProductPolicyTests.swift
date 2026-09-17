import Testing
@testable import RecordingsUpdateProtocol

struct UpdateProductPolicyTests {
    @Test("legacy product keeps every protected destination and runtime capability")
    func legacyDestinations() throws {
        let policy = UpdateProductPolicy.legacy
        try policy.requireRuntimeSupport()
        #expect(RecordingsUpdateConstants.productPolicy == policy)
        #expect(policy.applicationIdentifier == "com.hasna.recordings")
        #expect(policy.applicationPath == "/Applications/Hasna Recordings.app")
        #expect(policy.machServiceName == "com.hasna.recordings.updater")
        #expect(policy.brokerExecutablePath == "/Library/PrivilegedHelperTools/com.hasna.recordings.updater")
        #expect(policy.stateRoot == "/Library/Application Support/Hasna/Recordings/Updates")
        #expect(policy.trustRoot == "/Library/Application Support/Hasna/Recordings/Trust")
        #expect(policy.policyPath == "/Library/Application Support/Hasna/Recordings/Trust/broker-policy.json")
        #expect(policy.envelopePublicKeyDirectory == "/Library/Application Support/Hasna/Recordings/Trust/envelope-keys")
        #expect(policy.monotonicStateDirectory == "/private/var/db/com.hasna.recordings.updater")
        #expect(policy.monotonicStatePath == "/private/var/db/com.hasna.recordings.updater/release-state.json")
        #expect(policy.artifactVerifierPath == "/Library/PrivilegedHelperTools/com.hasna.recordings.artifact-verifier")
        #expect(policy.artifactVerifierSandboxProfilePath == "/Library/Application Support/Hasna/Recordings/Trust/artifact-verifier.sb")
        #expect(policy.bootstrapMarkerPath == "/Library/Application Support/Hasna/Recordings/Trust/bootstrap-marker.json")
        #expect(policy.artifactVerifierAccount == "_recordingsverify")
        #expect(policy.updateClientIdentifier == "com.hasna.recordings.update-client")
        #expect(policy.updateClientRelativePath == "Contents/Helpers/recordings-update-client")
        #expect(policy.executableRelativePath == "Contents/MacOS/Recordings")
        #expect(policy.companionRelativePath == "Contents/Helpers/recordings")
        #expect(policy.provenanceRelativePath == "Contents/Resources/recordings-build-provenance.json")
        #expect(policy.architectures == ["arm64", "x86_64"])
        #expect(policy.provenanceSchemaVersion == 4)
        #expect(policy.provenanceFields == ["schema_version", "bundle_id", "bundle_version", "bundle_build_version", "git_sha", "architectures", "team_id", "minimum_macos", "companion"])
        #expect(policy.companionProvenanceFields == ["version", "sha256", "architectures"])
    }

    @Test("a valid fictional ARM64 product has distinct paths but no runtime authority")
    func otherProductIsNotEnabled() throws {
        let policy = try Self.fixture()
        #expect(policy.applicationPath == "/Applications/Example Recordings.app")
        #expect(policy.policyPath == "/Library/Application Support/Example/Recordings/Trust/broker-policy.json")
        #expect(policy.monotonicStatePath == "/private/var/db/com.example.recordings.product.updater/release-state.json")
        #expect(throws: UpdateProductPolicyError.runtimeUnsupported) { try policy.requireRuntimeSupport() }
    }

    @Test("changing any single legacy policy component does not enable a runtime")
    func partialLegacyOverridesAreDisabled() throws {
        let policies = [
            try Self.fixture(identifier: "com.hasna.recordings", bundle: "Hasna Recordings.app", executable: "Recordings", support: ["Hasna", "Recordings"], account: "_recordingsverify"),
            try Self.fixture(identifier: "com.hasna.recordings", bundle: "Hasna Recordings.app", executable: "Recordings", support: ["Hasna", "Recordings"], account: "_otherverify", architectures: ["arm64", "x86_64"]),
            try Self.fixture(identifier: "com.hasna.recordings", bundle: "Other.app", executable: "Recordings", support: ["Hasna", "Recordings"], account: "_recordingsverify", architectures: ["arm64", "x86_64"]),
            try Self.fixture(identifier: "com.hasna.recordings", bundle: "Hasna Recordings.app", executable: "Other", support: ["Hasna", "Recordings"], account: "_recordingsverify", architectures: ["arm64", "x86_64"]),
            try Self.fixture(identifier: "com.hasna.recordings", bundle: "Hasna Recordings.app", executable: "Recordings", support: ["Other", "Recordings"], account: "_recordingsverify", architectures: ["arm64", "x86_64"]),
            try Self.fixture(identifier: "com.example.other", bundle: "Hasna Recordings.app", executable: "Recordings", support: ["Hasna", "Recordings"], account: "_recordingsverify", architectures: ["arm64", "x86_64"]),
        ]
        for policy in policies {
            #expect(throws: UpdateProductPolicyError.runtimeUnsupported) { try policy.requireRuntimeSupport() }
        }
    }

    @Test("noncanonical identity, path, account and architecture inputs are rejected")
    func invalidPolicies() {
        for identifier in ["", "com.example\n", "com.example/other", "com..example", "com.example\u{0}"] {
            #expect(throws: UpdateProductPolicyError.invalidIdentity) { try Self.fixture(identifier: identifier) }
        }
        for bundle in ["../Other.app", "Other/app.app", ".app", "Other.app\n", "Other.app/", "Other.app "] {
            #expect(throws: UpdateProductPolicyError.invalidApplicationLayout) { try Self.fixture(bundle: bundle) }
        }
        for executable in ["../Other", "Other/name", "Other\n", "", "Other Name"] {
            #expect(throws: UpdateProductPolicyError.invalidApplicationLayout) { try Self.fixture(executable: executable) }
        }
        for support in [[], [".."], ["Example/Other"], ["Example\n"], ["Example", ""], ["a", "b", "c", "d", "e"]] {
            #expect(throws: UpdateProductPolicyError.invalidSupportDirectory) { try Self.fixture(support: support) }
        }
        for account in ["root", "_root/other", "_verify\n", ""] {
            #expect(throws: UpdateProductPolicyError.invalidVerifierAccount) { try Self.fixture(account: account) }
        }
        for architectures in [[], ["i386"], ["arm64", "arm64"], ["x86_64", "arm64"], ["arm64", "x86_64", "i386"]] {
            #expect(throws: UpdateProductPolicyError.invalidArchitectures) { try Self.fixture(architectures: architectures) }
        }
    }

    static func fixture(
        identifier: String = "com.example.recordings.product",
        bundle: String = "Example Recordings.app",
        executable: String = "Recordings",
        support: [String] = ["Example", "Recordings"],
        account: String = "_exampleverify",
        architectures: [String] = ["arm64"]
    ) throws -> UpdateProductPolicy {
        try UpdateProductPolicy(applicationIdentifier: identifier, applicationBundleName: bundle,
                                applicationExecutable: executable, supportDirectoryComponents: support,
                                artifactVerifierAccount: account, architectures: architectures)
    }
}
