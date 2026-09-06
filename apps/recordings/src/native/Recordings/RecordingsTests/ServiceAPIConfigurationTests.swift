import Foundation
import Testing
@testable import RecordingsLib

struct ServiceAPIConfigurationTests {
    @Test("a configurable service prefix keeps exactly one v1 segment", arguments: [
        "https://api.example.com/recordings", "https://api.example.com/recordings/v1/",
    ])
    func normalizesServicePrefix(_ input: String) throws {
        #expect(try ServiceAPIConfiguration.normalizedURL(input) == "https://api.example.com/recordings/v1")
    }

    @Test("invalid or credential-bearing URLs are rejected", arguments: [
        "", "https://user:password@example.com/v1", "http://example.com/v1",
        "https://example.com/v1?key=value", "https://example.com/v1#fragment",
    ])
    func rejectsUnsafeURL(_ input: String) {
        #expect(throws: (any Error).self) { try ServiceAPIConfiguration.normalizedURL(input) }
    }

    @Test("Finder launches receive saved routing and an endpoint-bound Keychain credential")
    func savedConnectionEnvironment() throws {
        let suite = "recordings-api-test-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("https://service.example.test/recordings/v1/", forKey: ServiceAPIConfiguration.defaultsKey)
        var lookedUp: [String] = []
        let environment = try ServiceAPIConfiguration.childEnvironment(base: ["PATH": "/bin"], defaults: defaults) { endpoint in
            lookedUp.append(endpoint)
            return "fixture-service-credential"
        }
        #expect(lookedUp == ["https://service.example.test/recordings/v1"])
        #expect(environment["HASNA_RECORDINGS_API_URL"] == lookedUp.first)
        #expect(environment["HASNA_RECORDINGS_CLIENT_STORE"] == "http")
        #expect(environment["HASNA_RECORDINGS_API_KEY_OVERRIDE"] != nil)
        #expect(environment["OPENAI_API_KEY"] == nil)
        #expect(environment["PATH"] == "/bin")
        #expect(defaults.string(forKey: "HASNA_RECORDINGS_API_KEY_OVERRIDE") == nil)
        for base in [["HASNA_RECORDINGS_API_URL": "https://another.example.test/v1"], ["HASNA_RECORDINGS_CLIENT_STORE": "sqlite"]] {
            let overridden = try ServiceAPIConfiguration.childEnvironment(base: base, defaults: defaults) { _ in
                Issue.record("Environment routing must not read the saved endpoint credential")
                return nil
            }
            #expect(overridden == base)
        }
    }

    @Test("an unconfigured native client invents no endpoint or local fallback")
    func noDefaultEndpoint() throws {
        let suite = "recordings-empty-api-test-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        #expect(try ServiceAPIConfiguration.childEnvironment(base: [:], defaults: defaults) { _ in
            Issue.record("No endpoint is configured")
            return nil
        }.isEmpty)
    }

    @MainActor
    @Test("global recording preferences ignore legacy project selections and prompts")
    func ignoresLegacyProjects() {
        let home = makeIsolatedTestHome("global-recording-preferences")
        let preferences = ProjectStore(filePath: "\(home)/projects.json")
        preferences.settings.globalSystemPrompt = "Global cleanup"
        preferences.settings.postProcessingMode = "always"
        preferences.settings.projects = [RecProject(id: "legacy", name: "Legacy", systemPrompt: "Project cleanup")]
        preferences.settings.activeProjectId = "legacy"
        let engine = RecordingEngine(homePath: home)
        engine.globalRecordingPreferences = preferences
        #expect(engine.projectStore == nil)
        #expect(engine.recordingCleanupPreferences.prompt == "Global cleanup")
        #expect(engine.recordingCleanupPreferences.mode == "always")
        #expect(preferences.settings.activeProjectId == "legacy")
    }
}
