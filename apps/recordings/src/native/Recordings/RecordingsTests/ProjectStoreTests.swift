import Foundation
import Testing
@testable import RecordingsLib

struct ProjectStoreTests {
    private struct SyntheticReadError: LocalizedError {
        var errorDescription: String? { "synthetic read failure" }
    }

    @Test("a pre-upgrade settings file that still carries project data still decodes")
    func legacyProjectDataIsIgnoredOnDecode() throws {
        let input = Data(##"{"globalSystemPrompt":"Global","postProcessingMode":"always","activeProjectId":"legacy-id","projects":[{"id":"legacy-id","name":"Legacy","path":"/tmp/legacy","systemPrompt":"Keep bullets","appBundleIds":["com.example.app"],"canonicalPath":"recordings-app://projects/legacy-id","color":"#12AB34"}]}"##.utf8)

        // Decoding must not throw: users with an existing projects.json keep their
        // settings on the first launch after the projects feature was removed.
        let settings = try JSONDecoder().decode(ProjectSettings.self, from: input)
        #expect(settings.globalSystemPrompt == "Global")
        #expect(settings.postProcessingMode == "always")

        // Re-encoding drops the retired project entries. This is forward-only; the
        // surviving settings keys are unchanged.
        let encoded = try JSONEncoder().encode(settings)
        let object = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        #expect(object["globalSystemPrompt"] as? String == "Global")
        #expect(object["postProcessingMode"] as? String == "always")
        #expect(object.keys.sorted() == ["globalSystemPrompt", "postProcessingMode"])
    }

    @Test("settings persistence failures remain visible to the UI")
    @MainActor
    func reportsPersistenceFailure() throws {
        // An unwritable path fails at load, so the surfaced message is the load failure —
        // what matters to the UI contract is that a failed save leaves a visible error.
        let store = ProjectStore(filePath: "/dev/null/projects.json")
        store.settings.globalSystemPrompt = "Cannot Save"

        #expect(throws: (any Error).self) {
            try store.save()
        }
        let persistenceError = try #require(store.persistenceError)
        #expect(persistenceError.contains("settings"))
    }

    @Test("settings decode failures are visible and block saving")
    @MainActor
    func reportsLoadFailure() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let file = root.appendingPathComponent("projects.json")
        try Data("not-json".utf8).write(to: file)

        let store = ProjectStore(filePath: file.path)

        #expect(store.persistenceError?.contains("Failed to load settings") == true)
        #expect(!store.canPersistSettings)
        #expect(throws: ProjectStoreError.self) {
            try store.save()
        }
        #expect(try Data(contentsOf: file) == Data("not-json".utf8))
    }

    @Test("unreadable settings data blocks saving without overwriting the file")
    @MainActor
    func unreadableDataBlocksMutations() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let file = root.appendingPathComponent("projects.json")
        let sentinel = Data("existing-settings-data".utf8)
        try sentinel.write(to: file)

        let store = ProjectStore(filePath: file.path) { _ in
            throw SyntheticReadError()
        }
        store.settings.globalSystemPrompt = "Must not be persisted"

        #expect(store.persistenceError?.contains("synthetic read failure") == true)
        #expect(!store.canPersistSettings)
        #expect(throws: ProjectStoreError.self) { try store.save() }
        #expect(try Data(contentsOf: file) == sentinel)
    }

    @Test("a settings file that becomes unreadable after launch is never overwritten")
    @MainActor
    func postLaunchReadFailureBlocksMutations() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let file = root.appendingPathComponent("projects.json")
        let initial = try JSONEncoder().encode(ProjectSettings())
        try initial.write(to: file)
        var readError: SyntheticReadError?
        let store = ProjectStore(filePath: file.path) { path in
            if let readError { throw readError }
            return try Data(contentsOf: URL(fileURLWithPath: path))
        }

        readError = SyntheticReadError()
        store.settings.globalSystemPrompt = "Must not be persisted"

        #expect(throws: ProjectStoreError.self) { try store.save() }
        #expect(!store.canPersistSettings)
        #expect(store.persistenceError?.contains("synthetic read failure") == true)
        #expect(try Data(contentsOf: file) == initial)
    }

    @Test("external settings file changes are never replaced by stale in-memory settings")
    @MainActor
    func externalChangeBlocksMutations() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let file = root.appendingPathComponent("projects.json")
        try JSONEncoder().encode(ProjectSettings()).write(to: file)
        let store = ProjectStore(filePath: file.path)
        let external = Data("externally-replaced-data".utf8)
        try external.write(to: file)

        store.settings.globalSystemPrompt = "Must not replace external data"

        #expect(throws: ProjectStoreError.self) { try store.save() }
        #expect(!store.canPersistSettings)
        #expect(store.persistenceError?.contains("changed on disk") == true)
        #expect(try Data(contentsOf: file) == external)
    }

    @Test("a stale app instance cannot overwrite a newer settings save")
    @MainActor
    func staleStoreCannotOverwriteNewerSave() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let file = root.appendingPathComponent("projects.json")
        try JSONEncoder().encode(ProjectSettings()).write(to: file)
        let first = ProjectStore(filePath: file.path)
        let stale = ProjectStore(filePath: file.path)

        first.settings.globalSystemPrompt = "newer value"
        try first.save()
        let newerData = try Data(contentsOf: file)
        stale.settings.globalSystemPrompt = "stale value"

        #expect(throws: ProjectStoreError.self) { try stale.save() }
        #expect(!stale.canPersistSettings)
        #expect(try Data(contentsOf: file) == newerData)
        let persisted = try JSONDecoder().decode(ProjectSettings.self, from: newerData)
        #expect(persisted.globalSystemPrompt == "newer value")
    }

    @Test("absent settings data remains a writable empty store")
    @MainActor
    func absentDataIsWritable() {
        let file = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathComponent("projects.json")
        let store = ProjectStore(filePath: file.path) { _ in nil }

        #expect(store.persistenceError == nil)
        #expect(store.canPersistSettings)
    }

    @Test("post-processing mode resolution falls back to auto for an unknown value")
    @MainActor
    func postProcessingModeResolution() {
        let file = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathComponent("projects.json")
        let store = ProjectStore(filePath: file.path) { _ in nil }

        store.settings.postProcessingMode = "always"
        #expect(store.effectivePostProcessingMode == PostProcessingMode.always.rawValue)

        store.settings.postProcessingMode = "not-a-mode"
        #expect(store.effectivePostProcessingMode == PostProcessingMode.auto.rawValue)
    }

    @Test("the effective system prompt is the trimmed global prompt")
    @MainActor
    func effectiveSystemPromptUsesGlobalPrompt() {
        let file = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathComponent("projects.json")
        let store = ProjectStore(filePath: file.path) { _ in nil }

        store.settings.globalSystemPrompt = "  Format as concise notes.  "
        #expect(store.effectiveSystemPrompt == "Format as concise notes.")
    }
}
