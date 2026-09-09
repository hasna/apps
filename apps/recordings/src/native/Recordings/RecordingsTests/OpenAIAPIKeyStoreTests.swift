import Foundation
import Testing
@testable import RecordingsLib

struct OpenAIAPIKeyStoreTests {
    @Test("Environment key has highest priority")
    func environmentKeyWins() {
        let key = OpenAIAPIKeyStore.load(
            homePath: "/tmp/recordings-missing-home",
            environment: ["OPENAI_API_KEY": "env-key"],
            userDefaultKey: "stored-key"
        )
        #expect(key == "env-key")
    }

    @Test("User default key is used before config file")
    func userDefaultKeyWins() throws {
        let home = try makeHome()
        try writeConfig(home: home, ["openai_api_key": "config-key"])

        let key = OpenAIAPIKeyStore.load(
            homePath: home.path,
            environment: [:],
            userDefaultKey: "stored-key"
        )
        #expect(key == "stored-key")
    }

    @Test("Config file key is loaded from installed app data")
    func configFileKey() throws {
        let home = try makeHome()
        try writeConfig(home: home, ["openai_api_key": "config-key"])

        let key = OpenAIAPIKeyStore.load(
            homePath: home.path,
            environment: [:],
            userDefaultKey: nil
        )
        #expect(key == "config-key")
    }

    @Test("Config file can reference environment variable")
    func configEnvReference() throws {
        let home = try makeHome()
        try writeConfig(home: home, ["openai_api_key": "$RECORDINGS_API_KEY"])

        let key = OpenAIAPIKeyStore.load(
            homePath: home.path,
            environment: ["RECORDINGS_API_KEY": "referenced-key"],
            userDefaultKey: nil
        )
        #expect(key == "referenced-key")
    }

    @Test("Language defaults to English and can be loaded from config")
    func languageConfig() throws {
        let home = try makeHome()
        #expect(OpenAIAPIKeyStore.loadLanguage(homePath: home.path, environment: [:], userDefaultLanguage: nil) == "en")

        try writeConfig(home: home, ["language": "FR"])
        #expect(OpenAIAPIKeyStore.loadLanguage(homePath: home.path, environment: [:], userDefaultLanguage: nil) == "fr")
        #expect(OpenAIAPIKeyStore.apiLanguageHint(for: "auto") == "")
        #expect(OpenAIAPIKeyStore.apiLanguageHint(for: "en") == "en")
    }

    @Test("Saving language writes the CLI language config")
    func saveLanguageWritesConfig() throws {
        let home = try makeHome()

        try OpenAIAPIKeyStore.saveLanguage(language: "en", homePath: home.path)

        let configURL = home
            .appendingPathComponent(".hasna")
            .appendingPathComponent("recordings")
            .appendingPathComponent("config.json")
        let data = try Data(contentsOf: configURL)
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json["language"] as? String == "en")
    }

    @Test("Secrets env files are searched recursively")
    func recursiveSecrets() throws {
        let home = try makeHome()
        let secretDir = home
            .appendingPathComponent(".secrets")
            .appendingPathComponent("hasnaxyz")
            .appendingPathComponent("openai")
        try FileManager.default.createDirectory(at: secretDir, withIntermediateDirectories: true)
        let fixture = "secret-key"
        try "export OPENAI_API_KEY='\(fixture)'\n".write(
            to: secretDir.appendingPathComponent("live.env"),
            atomically: true,
            encoding: .utf8
        )

        let key = OpenAIAPIKeyStore.load(
            homePath: home.path,
            environment: [:],
            userDefaultKey: nil
        )
        #expect(key == "secret-key")
    }

    @Test("Keychain key precedes legacy preferences and config")
    func keychainPrecedence() throws {
        let home = try makeHome()
        try writeConfig(home: home, ["openai_api_key": "old-config"])
        #expect(OpenAIAPIKeyStore.load(homePath: home.path, environment: [:],
            userDefaultKey: "old-default", keychainLoader: { "keychain-fixture" }) == "keychain-fixture")
    }

    @Test("Save writes only Keychain and removes legacy plaintext while preserving settings")
    func secureSave() throws {
        let home = try makeHome()
        let suite = "provider-test-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("old-default", forKey: "openAIAPIKey")
        try writeConfig(home: home, ["openai_api_key": "old-key", "api_key": "older-key",
            "transcription_model": "gpt-4o-transcribe"])
        var stored = ""
        try OpenAIAPIKeyStore.save(key: "  keychain-fixture  ", homePath: home.path,
            defaults: defaults, keychainWriter: { stored = $0 })
        #expect(stored == "keychain-fixture")
        #expect(defaults.string(forKey: "openAIAPIKey") == nil)
        let data = try Data(contentsOf: home.appendingPathComponent(".hasna/recordings/config.json"))
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json["openai_api_key"] == nil)
        #expect(json["api_key"] == nil)
        #expect(json["transcription_model"] as? String == "gpt-4o-transcribe")
        #expect(String(data: data, encoding: .utf8)?.contains(stored) == false)
    }

    @Test("Keychain failure preserves existing configuration")
    func failedSave() throws {
        let home = try makeHome()
        try writeConfig(home: home, ["openai_api_key": "legacy-fixture"])
        #expect(throws: OpenAIAPIKeyStore.KeychainFailure.self) {
            try OpenAIAPIKeyStore.save(key: "new-fixture", homePath: home.path,
                keychainWriter: { _ in throw OpenAIAPIKeyStore.KeychainFailure(status: -50) })
        }
        #expect(OpenAIAPIKeyStore.load(homePath: home.path, environment: [:], userDefaultKey: nil) == "legacy-fixture")
    }

    @Test("Provider key reaches the helper without becoming service authentication")
    func separateProviderEnvironment() {
        let result = OpenAIAPIKeyStore.childEnvironment(base: [
            "RECORDINGS_API_KEY": "provider-fixture",
            "HASNA_RECORDINGS_API_KEY_OVERRIDE": "service-fixture",
        ], homePath: "/tmp/test-home", keyLoader: { "provider-fixture" })
        #expect(result["RECORDINGS_API_KEY"] == nil)
        #expect(result["OPENAI_API_KEY"] == "provider-fixture")
        #expect(result["RECORDINGS_OPENAI_API_KEY"] == "provider-fixture")
        #expect(result["HASNA_RECORDINGS_API_KEY_OVERRIDE"] == "service-fixture")
    }

    private func makeHome() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("recordings-key-store-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func writeConfig(home: URL, _ config: [String: String]) throws {
        let configDir = home
            .appendingPathComponent(".hasna")
            .appendingPathComponent("recordings")
        try FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted])
        try data.write(to: configDir.appendingPathComponent("config.json"))
    }
}
