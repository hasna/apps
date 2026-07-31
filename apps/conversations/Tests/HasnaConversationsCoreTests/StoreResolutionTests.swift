// Tests for the macOS shell's store guard.
//
// Until this target existed, NOTHING in the repository could fail on the Swift:
// .github/workflows/ci.yml runs on ubuntu-latest and never invokes `swift`, and
// Package.swift declared no test target — so the green CI tick was green
// regardless of what Sources/ contained, up to and including code that does not
// compile. The fail-closed property was argued from a source read and one manual
// build on one machine.
//
// The matrix below is loaded from test-fixtures/store-resolution-matrix.json,
// which src/lib/store/store-resolution-matrix.test.ts reads as well: this file
// asserts what the shell announces and what environment it hands the child, and
// that TypeScript test asserts the real resolver reaches the same store from that
// environment. One expectation, checked from both sides.

import XCTest
@testable import HasnaConversationsCore

// MARK: - Fixture model

struct MatrixArm: Decodable {
    let name: String
    let note: String?
    let configFile: [String: String]?
    let environment: [String: String]
    let shell: String
    let announcedUrl: String?
    let childStoreEnv: [String: String]?
    let childStore: String?
    let reasonContains: String?
}

struct Matrix: Decodable {
    let arms: [MatrixArm]
}

/// Repo root, derived from this file's own location so the fixture is found
/// whether the suite runs from a checkout or a CI workspace.
let repoRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()   // HasnaConversationsCoreTests
    .deletingLastPathComponent()   // Tests
    .deletingLastPathComponent()   // repo root

func loadMatrix() throws -> Matrix {
    let url = repoRoot.appendingPathComponent("test-fixtures/store-resolution-matrix.json")
    return try JSONDecoder().decode(Matrix.self, from: Data(contentsOf: url))
}

/// Write a `KEY=value` file into a fresh temporary directory and return its path.
func writeConfigFile(_ entries: [String: String]) throws -> String {
    let dir = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("hasna-store-resolution-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("conversations.env").path
    let body = entries.keys.sorted().map { "\($0)=\(entries[$0]!)" }.joined(separator: "\n") + "\n"
    try body.write(toFile: path, atomically: true, encoding: .utf8)
    return path
}

/// A path inside a real temporary directory that deliberately holds no file.
func absentConfigPath() -> String {
    URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("hasna-store-resolution-absent-\(UUID().uuidString)")
        .appendingPathComponent("conversations.env").path
}

// MARK: - The shared matrix

final class StoreResolutionMatrixTests: XCTestCase {

    func testFixtureIsNotEmpty() throws {
        // A matrix-driven suite that silently loads zero arms passes vacuously.
        let matrix = try loadMatrix()
        XCTAssertGreaterThanOrEqual(matrix.arms.count, 18, "fixture lost arms")
    }

    func testEveryArm() throws {
        for arm in try loadMatrix().arms {
            let configPath = try arm.configFile.map(writeConfigFile) ?? absentConfigPath()
            let resolution = resolveStore(environment: arm.environment, configPath: configPath)

            switch (arm.shell, resolution) {
            case ("cloud", .cloud(let env, let url)):
                if let expected = arm.announcedUrl {
                    XCTAssertEqual(url, expected, "\(arm.name): announced URL")
                }
                assertChildStoreEnv(env, equals: arm.childStoreEnv, arm: arm.name)

            case ("local", .explicitLocal(let env)):
                assertChildStoreEnv(env, equals: arm.childStoreEnv, arm: arm.name)

            case ("unresolved", .unresolved(let reason)):
                if let needle = arm.reasonContains {
                    XCTAssertTrue(
                        reason.contains(needle),
                        "\(arm.name): reason did not name \(needle) — got: \(reason)"
                    )
                }

            default:
                XCTFail("\(arm.name): expected shell=\(arm.shell), got \(resolution.debugDescription)")
            }
        }
    }

    /// The child must receive EXACTLY the store-selecting keys the fixture names —
    /// no more. "No more" is the half that matters: the defect was an inherited
    /// key surviving into the child and redirecting the store behind the shell's
    /// back, and a subset check would not have caught it.
    private func assertChildStoreEnv(
        _ env: [String: String],
        equals expected: [String: String]?,
        arm: String
    ) {
        guard let expected else { return }
        var actual: [String: String] = [:]
        for key in StoreEnvContract.storeSelectingKeys {
            if let value = env[key] { actual[key] = value }
        }
        XCTAssertEqual(
            actual.keys.sorted(), expected.keys.sorted(),
            "\(arm): store-selecting keys handed to the child"
        )
        for (key, value) in expected {
            XCTAssertEqual(actual[key], value, "\(arm): value of \(key) handed to the child")
        }
    }
}

// MARK: - The property, stated directly

final class StoreGuardPropertyTests: XCTestCase {

    /// Whatever the shell announces, the environment it hands the child must
    /// contain no key that could select the other store. This is the invariant
    /// the divergence broke, asserted independently of any single arm.
    func testCloudChildEnvCarriesNoLocalSelectingKey() throws {
        let hostileEnv = [
            "HASNA_CONVERSATIONS_DB_PATH": "/tmp/should-not-survive.db",
            "CONVERSATIONS_DB_PATH": "/tmp/should-not-survive.db",
            "HASNA_CONVERSATIONS_MODE": "local",
            "CONVERSATIONS_STORAGE_MODE": "local",
            "CONVERSATIONS_MODE": "local",
            "PATH": "/usr/bin",
        ]
        let configPath = try writeConfigFile([
            "HASNA_CONVERSATIONS_API_URL": "https://conversations.hasna.xyz/v1",
            "HASNA_CONVERSATIONS_API_KEY": "fixture-not-a-real-credential",
        ])

        guard case .cloud(let env, _) = resolveStore(environment: hostileEnv, configPath: configPath) else {
            return XCTFail("fleet config naming the hosted service must resolve to cloud")
        }
        for key in StoreEnvContract.dbPathKeys {
            XCTAssertNil(env[key], "\(key) survived into the child environment")
        }
        for key in StoreEnvContract.modeKeys where env[key] != nil {
            XCTAssertNotEqual(env[key], "local", "\(key)=local survived into the child environment")
        }
        // Unrelated inherited variables are untouched — the shell strips the
        // store-selecting keys, not the environment.
        XCTAssertEqual(env["PATH"], "/usr/bin")
    }

    /// The positive control for the test above: the same assertion must FAIL on a
    /// child environment built the old way (inherit everything, add the URL and
    /// key). Without this, "no local-selecting key survived" could be passing
    /// because the check cannot see them.
    func testTheGuardAssertionCanFail() {
        let oldStyleChildEnv = [
            "HASNA_CONVERSATIONS_DB_PATH": "/tmp/should-not-survive.db",
            "HASNA_CONVERSATIONS_API_URL": "https://conversations.hasna.xyz/v1",
            "HASNA_CONVERSATIONS_API_KEY": "fixture-not-a-real-credential",
        ]
        let survivors = StoreEnvContract.dbPathKeys.filter { oldStyleChildEnv[$0] != nil }
        XCTAssertEqual(
            survivors, ["HASNA_CONVERSATIONS_DB_PATH"],
            "the survivor check must detect a planted local-selecting key"
        )
    }

    /// Explicit local is supported and announced as local — the guard refuses
    /// ambiguity, not local storage.
    func testExplicitLocalIsAnnouncedAsLocal() throws {
        let configPath = try writeConfigFile(["HASNA_CONVERSATIONS_STORAGE_MODE": "local"])
        guard case .explicitLocal(let env) = resolveStore(environment: [:], configPath: configPath) else {
            return XCTFail("explicit local must resolve to explicitLocal")
        }
        XCTAssertEqual(env["HASNA_CONVERSATIONS_STORAGE_MODE"], "local")
    }

    /// A debug description must never carry the API key value: XCTest prints it
    /// on failure, and test output is persisted and served.
    func testDebugDescriptionNeverPrintsTheApiKey() throws {
        let configPath = try writeConfigFile([
            "HASNA_CONVERSATIONS_API_URL": "https://conversations.hasna.xyz/v1",
            "HASNA_CONVERSATIONS_API_KEY": "fixture-not-a-real-credential",
        ])
        let described = resolveStore(environment: [:], configPath: configPath).debugDescription
        XCTAssertFalse(described.contains("fixture-not-a-real-credential"))
        XCTAssertTrue(described.contains("HASNA_CONVERSATIONS_API_KEY"), "key NAMES are fine")
    }
}

// MARK: - Config-file reading

final class EnvFileTests: XCTestCase {

    /// The reviewer listed every row below as a branch with no evidence behind it.
    func testParsesExportPrefixQuotesAndComments() throws {
        let dir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("hasna-envfile-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let path = dir.appendingPathComponent("conversations.env").path
        try """
        # a comment

        export HASNA_CONVERSATIONS_API_URL="https://conversations.hasna.xyz/v1"
        HASNA_CONVERSATIONS_API_KEY='fixture-not-a-real-credential'
        NOT_AN_ASSIGNMENT
        """.write(toFile: path, atomically: true, encoding: .utf8)

        let parsed = try parseEnvFile(at: path)
        XCTAssertEqual(parsed["HASNA_CONVERSATIONS_API_URL"], "https://conversations.hasna.xyz/v1")
        XCTAssertEqual(parsed["HASNA_CONVERSATIONS_API_KEY"], "fixture-not-a-real-credential")
        XCTAssertNil(parsed["NOT_AN_ASSIGNMENT"])
    }

    func testParsesCRLFLineEndings() throws {
        let dir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("hasna-envfile-crlf-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let path = dir.appendingPathComponent("conversations.env").path
        let body = "HASNA_CONVERSATIONS_API_URL=https://conversations.hasna.xyz/v1\r\n"
            + "HASNA_CONVERSATIONS_API_KEY=fixture-not-a-real-credential\r\n"
        try body.write(toFile: path, atomically: true, encoding: .utf8)

        guard case .cloud(_, let url) = resolveStore(environment: [:], configPath: path) else {
            return XCTFail("CRLF config must still resolve to cloud")
        }
        XCTAssertEqual(url, "https://conversations.hasna.xyz/v1")
    }

    func testAbsentFileIsNotAnError() throws {
        XCTAssertEqual(try parseEnvFile(at: absentConfigPath()), [:])
    }

    /// "Present but unreadable" must not be reported as "does not define its
    /// variables" — that sends the operator to edit a file that is already right.
    func testUnreadableFileNamesTheReadFailure() throws {
        let dir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("hasna-envfile-unreadable-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let path = dir.appendingPathComponent("conversations.env").path
        try "HASNA_CONVERSATIONS_API_KEY=fixture-not-a-real-credential\n"
            .write(toFile: path, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: path)

        // Running as root defeats the permission bit, so the branch is
        // unreachable there. Skip rather than assert a check that cannot fail.
        try XCTSkipIf(getuid() == 0, "root bypasses the unreadable-file branch")

        guard case .unresolved(let reason) = resolveStore(environment: [:], configPath: path) else {
            return XCTFail("an unreadable config file must refuse, not fall through to local")
        }
        XCTAssertTrue(
            reason.contains("could not be read"),
            "reason must name the read failure, not a missing variable — got: \(reason)"
        )
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path)
    }
}
