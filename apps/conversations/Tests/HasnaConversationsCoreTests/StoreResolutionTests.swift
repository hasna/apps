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
    /// For a `local` arm: the env-var NAME that must have chosen local. Optional
    /// in the model because non-local arms have none — but a `local` arm that
    /// omits it FAILS rather than skipping, in `testEveryArm`.
    let expectedSelectedBy: String?
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
        XCTAssertGreaterThanOrEqual(matrix.arms.count, 19, "fixture lost arms")

        // The arm count alone is not enough. `assertChildStoreEnv` returns early
        // when an arm carries no `childStoreEnv`, so stripping that field from
        // every arm would leave `testEveryArm` asserting only the classification
        // and never the environment handed to the child — which is the half the
        // divergence lived in. The TypeScript side guards the same floor; each
        // suite must hold its own, because either can be run alone.
        let started = matrix.arms.filter { $0.childStoreEnv != nil }
        XCTAssertGreaterThanOrEqual(started.count, 14, "fixture lost its child-env expectations")

        // And the fixture must not be satisfiable by a constant.
        XCTAssertEqual(Set(matrix.arms.map(\.shell)), ["cloud", "local", "unresolved"])
    }

    /// EVERY key that can select local has an arm — stated against the contract
    /// rather than as a count, so a seventh key added to `StoreEnvContract` fails
    /// here until someone writes its arm. One key (`CONVERSATIONS_STORAGE_MODE`)
    /// had no arm at all, which is the shape this replaces: a coverage claim that
    /// nothing re-derives goes stale the moment the contract grows. Deployment
    /// modes are gone, so local is selected by a DB path alone (or by the absence
    /// of an API pair); the retired mode keys are covered by the refuse-arm test.
    func testEveryLocalSelectingKeyHasAnArm() throws {
        let covered = Set(try loadMatrix().arms.compactMap {
            $0.shell == "local" ? $0.expectedSelectedBy : nil
        })
        let selectable = Set(StoreEnvContract.dbPathKeys)
        XCTAssertEqual(
            selectable.subtracting(covered), [],
            "these keys can select local and no fixture arm exercises them"
        )
    }

    /// EVERY retired mode key must have an arm that refuses naming it. Without
    /// this, a mode key added to the contract could be dropped from the ratchet
    /// without any fixture noticing.
    func testEveryLegacyModeKeyHasARefuseArm() throws {
        let covered = Set(try loadMatrix().arms.compactMap {
            $0.shell == "unresolved" ? $0.reasonContains : nil
        })
        for key in StoreEnvContract.legacyModeKeys {
            XCTAssertTrue(
                covered.contains { $0.contains(key) },
                "no unresolved arm names the retired mode key \(key)"
            )
        }
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

            case ("local", .explicitLocal(let env, let selectedBy)):
                // EQUALITY, not membership. This assertion used to read
                // `storeSelectingKeys.contains(selectedBy)` — a 10-key set that
                // includes the URL and API-key names — so it asserted "it is some
                // store key" while the fix claims "it is the key that ACTUALLY
                // chose local". Measured: planting `apiUrlKeys[0]` in the DB-path
                // branch left the whole suite green. The DB-path branch is also
                // the commit's own motivating example, so the one case that had
                // to be pinned was the one nothing could fail on.
                guard let expected = arm.expectedSelectedBy else {
                    XCTFail("\(arm.name): a local arm must state expectedSelectedBy")
                    break
                }
                XCTAssertEqual(
                    selectedBy, expected,
                    "\(arm.name): local must name the key that actually chose it"
                )
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
    /// contain no key that could select the other store — and no retired mode key
    /// at all, because a mode key in the child would trip the resolver's
    /// fail-loud ratchet. This is the invariant the divergence broke, asserted
    /// independently of any single arm.
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
        for key in StoreEnvContract.legacyModeKeys {
            XCTAssertNil(env[key], "retired \(key) survived into the child environment")
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
    /// ambiguity, not local storage. Local is selected by a DB path (or by the
    /// absence of an API pair); retired mode tokens are errors, not selectors.
    func testExplicitLocalIsAnnouncedAsLocal() throws {
        let configPath = try writeConfigFile(["HASNA_CONVERSATIONS_DB_PATH": "/tmp/fixture.db"])
        guard case .explicitLocal(let env, let selectedBy) =
            resolveStore(environment: [:], configPath: configPath) else {
            return XCTFail("explicit local must resolve to explicitLocal")
        }
        XCTAssertEqual(env["HASNA_CONVERSATIONS_DB_PATH"], "/tmp/fixture.db")
        XCTAssertNil(env["HASNA_CONVERSATIONS_STORAGE_MODE"])
        XCTAssertEqual(selectedBy, "HASNA_CONVERSATIONS_DB_PATH")
    }

    /// A retired storage-mode variable in the fleet config is an error naming
    /// the variable — never a local selector, never silently ignored.
    func testRetiredStorageModeVariableRefusesByName() throws {
        let configPath = try writeConfigFile(["HASNA_CONVERSATIONS_STORAGE_MODE": "local"])
        guard case .unresolved(let reason) = resolveStore(environment: [:], configPath: configPath) else {
            return XCTFail("a retired storage-mode variable must refuse, not resolve")
        }
        XCTAssertTrue(
            reason.contains("HASNA_CONVERSATIONS_STORAGE_MODE"),
            "reason must name the retired variable — got: \(reason)"
        )
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

// MARK: - What the shell announces about the hosted URL

/// A synthetic marker, never a real credential. It is planted into a URL and the
/// assertions below look for its ABSENCE from what the shell would log. It has to
/// be synthetic because a failing assertion prints the announced string, and test
/// output is persisted and served.
private let plantedSecret = "planted-control-not-a-real-credential"

/// The host every arm points at, asserted to SURVIVE — a mask that returns the
/// empty string, or any constant, satisfies every absence check below.
private let announcedHost = "conversations.hasna.xyz"

/// Every position the URL grammar lets an operator put a string into, other than
/// the scheme, host and port that name the server itself.
///
/// Written as one property applied to a list of positions, deliberately, rather
/// than as a case per shape. Enumerating the shapes the author happened to think
/// of IS the defect this suite exists to close: the previous mask cleared `query`
/// and `fragment` — the two shapes its author had in mind — and re-emitted
/// `user:password@` verbatim into `NSLog`, while the doc comment above it claimed
/// scheme, host, port and path were all that survived. A position nobody listed
/// has to fail here rather than ship.
private let secretBearingURLs: [(position: String, url: String)] = [
    ("userinfo (user)",
     "https://\(plantedSecret)@\(announcedHost)/v1"),
    ("userinfo (password)",
     "https://svc:\(plantedSecret)@\(announcedHost)/v1"),
    ("path segment",
     "https://\(announcedHost)/v1/\(plantedSecret)"),
    ("query",
     "https://\(announcedHost)/v1?access_token=\(plantedSecret)"),
    ("fragment",
     "https://\(announcedHost)/v1#access_token=\(plantedSecret)"),
    ("every position at once",
     "https://svc:\(plantedSecret)@\(announcedHost):8443"
        + "/v1/\(plantedSecret)?access_token=\(plantedSecret)#access_token=\(plantedSecret)"),
]

final class AnnouncedUrlRedactionTests: XCTestCase {

    /// POSITIVE CONTROL. The absence assertions below are only evidence if the
    /// probe can see the marker when it IS there — otherwise "not found" means
    /// the check is blind, not that the output is clean.
    func testTheProbeDetectsThePlantedSecretWhenPresent() {
        for arm in secretBearingURLs {
            XCTAssertTrue(
                arm.url.contains(plantedSecret),
                "\(arm.position): the probe cannot see the marker in its own input"
            )
        }
    }

    /// THE PROPERTY: whatever an operator put in the URL, it is not in the log.
    func testAnnouncedUrlDropsTheSecretInEveryGrammarPosition() {
        for arm in secretBearingURLs {
            let announced = loggableURL(arm.url)
            XCTAssertFalse(
                announced.contains(plantedSecret),
                "\(arm.position): the app would NSLog a credential — announced: \(announced)"
            )
        }
    }

    /// The other direction. Every assertion above is satisfied by a mask that
    /// returns "" or a fixed string, so the announcement must still identify the
    /// server it was written to identify.
    func testAnnouncedUrlStillNamesTheServer() {
        for arm in secretBearingURLs {
            XCTAssertTrue(
                loggableURL(arm.url).contains(announcedHost),
                "\(arm.position): the announcement no longer names the host"
            )
        }
        // Scheme, host and port are kept, exactly and only.
        XCTAssertEqual(loggableURL("https://\(announcedHost)/v1"), "https://\(announcedHost)")
        XCTAssertEqual(
            loggableURL("https://\(announcedHost):8443/v1?a=1#b=2"),
            "https://\(announcedHost):8443",
            "a non-default port distinguishes one deployment from another and must survive"
        )
        XCTAssertEqual(loggableURL("http://127.0.0.1:3000/"), "http://127.0.0.1:3000")
        XCTAssertEqual(
            loggableURL("https://[::1]:8443/v1"), "https://[::1]:8443",
            "an IPv6 literal must keep its brackets or the port reads as part of the address"
        )
        // And it is not a constant: a different server announces differently.
        XCTAssertNotEqual(
            loggableURL("https://\(announcedHost)/v1"),
            loggableURL("https://someone-elses-host.example/v1")
        )
        // A URL the transport could never use names nothing rather than echoing
        // an unparsed string straight back into the log.
        XCTAssertEqual(loggableURL("not a url at all"), "(unparseable URL)")
    }

    /// END TO END, through the shipped path: the value comes out of a real config
    /// file, through `resolveStore`, to the string `main.swift` hands to `NSLog`.
    /// The child must STILL receive the URL in full — a mask that also breaks the
    /// connection is a different bug.
    func testEndToEndAnnouncementDropsTheSecretAndTheChildStillGetsTheUrl() throws {
        for arm in secretBearingURLs {
            let configPath = try writeConfigFile([
                "HASNA_CONVERSATIONS_API_URL": arm.url,
                "HASNA_CONVERSATIONS_API_KEY": "fixture-not-a-real-credential",
            ])
            guard case .cloud(let env, let announced) =
                resolveStore(environment: [:], configPath: configPath) else {
                XCTFail("\(arm.position): a usable https URL must still resolve to cloud")
                continue
            }
            XCTAssertFalse(
                announced.contains(plantedSecret),
                "\(arm.position): the app would NSLog a credential — announced: \(announced)"
            )
            XCTAssertEqual(
                env["HASNA_CONVERSATIONS_API_URL"], arm.url,
                "\(arm.position): the child must still receive the configured URL in full"
            )
        }
    }

    /// `debugDescription` prints the same announced URL, and XCTest prints it on
    /// any failure — so it inherits the property and is asserted directly rather
    /// than assumed to follow.
    func testDebugDescriptionDropsTheSecretInEveryGrammarPosition() throws {
        for arm in secretBearingURLs {
            let configPath = try writeConfigFile([
                "HASNA_CONVERSATIONS_API_URL": arm.url,
                "HASNA_CONVERSATIONS_API_KEY": "fixture-not-a-real-credential",
            ])
            let described = resolveStore(environment: [:], configPath: configPath).debugDescription
            XCTAssertFalse(
                described.contains(plantedSecret),
                "\(arm.position): debugDescription leaked a credential — \(described)"
            )
        }
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
        XCTAssertEqual(url, "https://conversations.hasna.xyz")
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
