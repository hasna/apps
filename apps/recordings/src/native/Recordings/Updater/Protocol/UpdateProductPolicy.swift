import Foundation

/// Validated product identity and layout, not runtime installation authority.
/// Paths are derived from canonical components, never accepted from an update.
public struct UpdateProductPolicy: Equatable, Sendable {
    public let applicationIdentifier: String
    public let applicationBundleName: String
    public let applicationExecutable: String
    public let supportDirectoryComponents: [String]
    public let artifactVerifierAccount: String
    public let architectures: [String]

    public init(
        applicationIdentifier: String,
        applicationBundleName: String,
        applicationExecutable: String,
        supportDirectoryComponents: [String],
        artifactVerifierAccount: String,
        architectures: [String]
    ) throws {
        guard Self.matches(applicationIdentifier, #"^[A-Za-z0-9][A-Za-z0-9.-]{1,200}$"#),
              !applicationIdentifier.contains("..") else {
            throw UpdateProductPolicyError.invalidIdentity
        }
        guard Self.component(applicationBundleName), applicationBundleName.hasSuffix(".app"),
              applicationBundleName.count > 4,
              Self.matches(applicationExecutable, #"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"#),
              !applicationExecutable.contains("..") else {
            throw UpdateProductPolicyError.invalidApplicationLayout
        }
        guard (1...4).contains(supportDirectoryComponents.count),
              supportDirectoryComponents.allSatisfy(Self.component) else {
            throw UpdateProductPolicyError.invalidSupportDirectory
        }
        guard Self.matches(artifactVerifierAccount, #"^_[a-z][a-z0-9_]{0,29}$"#) else {
            throw UpdateProductPolicyError.invalidVerifierAccount
        }
        guard [["arm64"], ["x86_64"], ["arm64", "x86_64"]].contains(architectures) else {
            throw UpdateProductPolicyError.invalidArchitectures
        }
        self.applicationIdentifier = applicationIdentifier
        self.applicationBundleName = applicationBundleName
        self.applicationExecutable = applicationExecutable
        self.supportDirectoryComponents = supportDirectoryComponents
        self.artifactVerifierAccount = artifactVerifierAccount
        self.architectures = architectures
    }

    public static let legacy: Self = {
        do {
            return try Self(
                applicationIdentifier: "com.hasna.recordings",
                applicationBundleName: "Hasna Recordings.app",
                applicationExecutable: "Recordings",
                supportDirectoryComponents: ["Hasna", "Recordings"],
                artifactVerifierAccount: "_recordingsverify",
                architectures: ["arm64", "x86_64"]
            )
        } catch {
            preconditionFailure("The compiled legacy updater policy is invalid")
        }
    }()

    /// Non-legacy metadata fixtures must never opt into partially threaded I/O.
    public func requireRuntimeSupport() throws {
        guard self == Self.legacy else { throw UpdateProductPolicyError.runtimeUnsupported }
    }

    public var machServiceName: String { applicationIdentifier + ".updater" }
    public var applicationPath: String { "/Applications/" + applicationBundleName }
    public var brokerExecutablePath: String { "/Library/PrivilegedHelperTools/" + machServiceName }
    public var supportRoot: String {
        "/Library/Application Support/" + supportDirectoryComponents.joined(separator: "/")
    }
    public var stateRoot: String { supportRoot + "/Updates" }
    public var trustRoot: String { supportRoot + "/Trust" }
    public var policyPath: String { trustRoot + "/broker-policy.json" }
    public var envelopePublicKeyDirectory: String { trustRoot + "/envelope-keys" }
    public var monotonicStateDirectory: String { "/private/var/db/" + machServiceName }
    public var monotonicStatePath: String { monotonicStateDirectory + "/release-state.json" }
    public var artifactVerifierPath: String {
        "/Library/PrivilegedHelperTools/" + applicationIdentifier + ".artifact-verifier"
    }
    public var artifactVerifierSandboxProfilePath: String { trustRoot + "/artifact-verifier.sb" }
    public var bootstrapMarkerPath: String { trustRoot + "/bootstrap-marker.json" }
    public var updateClientIdentifier: String { applicationIdentifier + ".update-client" }
    public var updateClientRelativePath: String { "Contents/Helpers/recordings-update-client" }
    public var executableRelativePath: String { "Contents/MacOS/" + applicationExecutable }
    public var companionRelativePath: String { "Contents/Helpers/recordings" }
    public var provenanceRelativePath: String { "Contents/Resources/recordings-build-provenance.json" }

    // Only the existing public provenance format is supported in this slice.
    public var provenanceSchemaVersion: Int { 4 }
    public var provenanceFields: Set<String> {
        ["schema_version", "bundle_id", "bundle_version", "bundle_build_version", "git_sha",
         "architectures", "team_id", "minimum_macos", "companion"]
    }
    public var companionProvenanceFields: Set<String> { ["version", "sha256", "architectures"] }

    public func admits(_ expected: CandidateReleaseMetadataExpectation) -> Bool {
        expected.applicationIdentifier == applicationIdentifier
            && expected.applicationExecutable == applicationExecutable
            && expected.architectures == architectures
    }

    private static func component(_ value: String) -> Bool {
        matches(value, #"^[A-Za-z0-9][A-Za-z0-9 ._-]{0,127}$"#)
            && !value.contains("..") && !value.hasSuffix(" ") && !value.hasSuffix(".")
    }

    private static func matches(_ value: String, _ pattern: String) -> Bool {
        // Anchored NSRegularExpression `$` also matches before a final newline.
        // Full-range equality excludes that spelling and every other suffix.
        guard let range = value.range(of: pattern, options: .regularExpression) else { return false }
        return range == value.startIndex..<value.endIndex
    }
}

public enum UpdateProductPolicyError: Error, Equatable, Sendable {
    case invalidIdentity
    case invalidApplicationLayout
    case invalidSupportDirectory
    case invalidVerifierAccount
    case invalidArchitectures
    case runtimeUnsupported
}
