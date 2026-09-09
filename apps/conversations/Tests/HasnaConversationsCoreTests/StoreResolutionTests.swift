import Foundation
import Testing
@testable import HasnaConversationsCore

private let packageDirectory = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
private let receipt = "{\"version\":1,\"transport\":\"cloud-http\"}"

@Suite(.serialized)
final class StoreResolutionTests {
    private var directories: [URL] = []
    deinit { for dir in directories { try? FileManager.default.removeItem(at: dir) } }
    private func temporaryDirectory() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("conversations-native-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        directories.append(dir)
        return dir
    }

    private func fakePayload(_ directory: URL, script: String) throws -> (String, URL) {
        let app = directory.appendingPathComponent("Example.app/Contents/Resources/app")
        try FileManager.default.createDirectory(at: app.appendingPathComponent("src/lib/store"), withIntermediateDirectories: true)
        try "// fixture".write(to: app.appendingPathComponent("src/lib/store/index.ts"), atomically: true, encoding: .utf8)
        let executable = directory.appendingPathComponent("fixture-runtime")
        try ("#!/bin/sh\n" + script + "\n").write(to: executable, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        return (executable.path, app)
    }

    private func assertRefused(_ resolution: StoreResolution) {
        guard case .unresolved = resolution else { Issue.record("Expected configuration refusal"); return }
    }

    @Test func testExactReceiptPreservesCredentialInputsWithoutDisplayingValues() throws {
        let dir = try temporaryDirectory()
        let (bun, app) = try fakePayload(dir, script: "test \"$1\" = --no-env-file || exit 3\ntest \"$2\" = --eval || exit 3\nprintf '%s\\n' '\(receipt)'")
        let secret = UUID().uuidString
        let env = ["HOME": dir.path, "HASNA_STATION": UUID().uuidString, "HASNA_CONVERSATIONS_API_KEY": secret, "HASNA_PROFILE": "fixture-profile"]
        let result = resolveStore(bunPath: bun, appDirectory: app, environment: env)
        guard case .cloud(let childEnv) = result else { Issue.record("Expected shared configuration"); return }
        #expect(childEnv == env)
        #expect(!(result.debugDescription.contains(secret)))
        #expect(!(result.debugDescription.contains("fixture-profile")))
    }

    @Test func testAllRetiredDatabaseSelectorsRefuseBeforeRuntimeStarts() throws {
        let dir = try temporaryDirectory()
        let (bun, app) = try fakePayload(dir, script: "touch '\(dir.appendingPathComponent("unexpected-start").path)'\nprintf '%s\\n' '\(receipt)'")
        for key in StoreEnvContract.dbPathKeys {
            let secretPath = dir.appendingPathComponent("preserved-\(UUID().uuidString).db").path
            let result = resolveStore(bunPath: bun, appDirectory: app, environment: [key: secretPath])
            assertRefused(result)
            #expect(!(result.debugDescription.contains(secretPath)))
            #expect(result.debugDescription.contains(key))
        }
        #expect(!(FileManager.default.fileExists(atPath: dir.appendingPathComponent("unexpected-start").path)))
    }

    @Test func testInvalidExtraAndOversizedReceiptsRefuse() throws {
        for script in [
            "printf '%s\\n' '{\"version\":1,\"transport\":\"local\"}'",
            "printf '%s\\n' '\(receipt)' 'extra'",
            "printf '%s\\n' '\(receipt)' '\(receipt)'",
            "printf '%s\\n' '{\"version\":1,\"transport\":\"cloud-http\",\"key\":\"fixture\"}'",
            "printf '%0500d' 0",
            "exit 0",
        ] {
            let dir = try temporaryDirectory()
            let (bun, app) = try fakePayload(dir, script: script)
            assertRefused(resolveStore(bunPath: bun, appDirectory: app, environment: [:]))
        }
    }

    @Test func testNonzeroExitAndRawErrorsRemainPrivate() throws {
        let dir = try temporaryDirectory()
        let syntheticSecret = UUID().uuidString
        let (bun, app) = try fakePayload(dir, script: "printf '%s\\n' '\(receipt)'\nprintf '%s\\n' '\(syntheticSecret)' >&2\nexit 2")
        let result = resolveStore(bunPath: bun, appDirectory: app, environment: [:])
        assertRefused(result)
        #expect(!(result.debugDescription.contains(syntheticSecret)))
    }

    @Test func testTimeoutTerminatesPreflightAndRefuses() throws {
        for script in ["exec /bin/sleep 5", "printf '%s\\n' '\(receipt)'\nexec /bin/sleep 5"] {
            let dir = try temporaryDirectory()
            let (bun, app) = try fakePayload(dir, script: script)
            let start = ProcessInfo.processInfo.systemUptime
            assertRefused(resolveStore(bunPath: bun, appDirectory: app, environment: [:], timeout: 0.1))
            #expect(ProcessInfo.processInfo.systemUptime - start < 2)
        }
    }

    @Test func testMissingBundledResolverRefusesWithoutStartingRuntime() throws {
        let dir = try temporaryDirectory()
        let (bun, app) = try fakePayload(dir, script: "touch '\(dir.appendingPathComponent("unexpected-start").path)'")
        try FileManager.default.removeItem(at: app.appendingPathComponent("src/lib/store/index.ts"))
        assertRefused(resolveStore(bunPath: bun, appDirectory: app, environment: [:]))
        #expect(!(FileManager.default.fileExists(atPath: dir.appendingPathComponent("unexpected-start").path)))
    }

    @Test func testActualBundledPayloadUsesSharedSavedCredentialsWithoutLegacyFilesOrDotenv() throws {
        let dir = try temporaryDirectory()
        let app = dir.appendingPathComponent("Hasna Conversations.app/Contents/Resources/app")
        try FileManager.default.createDirectory(at: app, withIntermediateDirectories: true)
        // Copy the shipped source layout, so resolution is tested outside the
        // checkout's cwd. Only dependency installation is shared with the fixture.
        try FileManager.default.copyItem(at: packageDirectory.appendingPathComponent("src"), to: app.appendingPathComponent("src"))
        for name in ["package.json", "tsconfig.json"] {
            try FileManager.default.copyItem(at: packageDirectory.appendingPathComponent(name), to: app.appendingPathComponent(name))
        }
        try FileManager.default.createSymbolicLink(at: app.appendingPathComponent("node_modules"), withDestinationURL: packageDirectory.appendingPathComponent("node_modules"))
        let home = dir.appendingPathComponent("home")
        let saved = home.appendingPathComponent(".hasna/conversations/config")
        try FileManager.default.createDirectory(at: saved, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let token = UUID().uuidString
        let credential = saved.appendingPathComponent("credentials")
        try "HASNA_CONVERSATIONS_API_URL=http://127.0.0.1:1\nHASNA_CONVERSATIONS_API_KEY=\(token)\n".write(to: credential, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: credential.path)
        let legacy = home.appendingPathComponent(".hasna/fleet-env")
        try FileManager.default.createDirectory(at: legacy, withIntermediateDirectories: true)
        try "CONVERSATIONS_DB_PATH=legacy.db\n".write(to: legacy.appendingPathComponent("conversations.env"), atomically: true, encoding: .utf8)
        try "CONVERSATIONS_DB_PATH=dotenv.db\n".write(to: app.appendingPathComponent(".env"), atomically: true, encoding: .utf8)
        let env = ["HOME": home.path, "HASNA_HOME": home.appendingPathComponent(".hasna").path, "HASNA_STATION": UUID().uuidString, "PATH": "/usr/bin:/bin"]
        let candidates = [ProcessInfo.processInfo.environment["CONVERSATIONS_TEST_BUN"], "/opt/homebrew/bin/bun", FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".bun/bin/bun").path].compactMap { $0 }
        guard let bun = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else { Issue.record("Bun is required for the actual bundled resolver test"); return }
        let configured = resolveStore(bunPath: bun, appDirectory: app, environment: env)
        guard case .cloud(let childEnv) = configured else { Issue.record("Saved account configuration failed to resolve"); return }
        #expect(childEnv == env)
        #expect(!(configured.debugDescription.contains(token)))
        try FileManager.default.removeItem(at: credential)
        assertRefused(resolveStore(bunPath: bun, appDirectory: app, environment: env))
        let enumerator = FileManager.default.enumerator(atPath: dir.path)!
        let databases = enumerator.allObjects.compactMap { $0 as? String }.filter { $0.hasSuffix(".db") || $0.hasSuffix(".db-wal") || $0.hasSuffix(".db-shm") }
        #expect(databases.isEmpty)
    }
}
