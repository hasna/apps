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
        try "export OPENAI_API_KEY='secret-key'\n".write(
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

    @Test("Saving a key writes it to config.json so the CLI uses the same key")
    func saveWritesConfig() throws {
        let home = try makeHome()

        try OpenAIAPIKeyStore.save(key: "sk-new-key", homePath: home.path)

        let key = OpenAIAPIKeyStore.load(
            homePath: home.path,
            environment: [:],
            userDefaultKey: nil
        )
        #expect(key == "sk-new-key")
    }

    @Test("Saving a key preserves unrelated config.json fields")
    func savePreservesOtherFields() throws {
        let home = try makeHome()
        try writeConfig(home: home, [
            "openai_api_key": "old-key",
            "transcription_model": "gpt-transcribe",
        ])

        try OpenAIAPIKeyStore.save(key: "sk-rotated", homePath: home.path)

        let configURL = home
            .appendingPathComponent(".hasna")
            .appendingPathComponent("recordings")
            .appendingPathComponent("config.json")
        let data = try Data(contentsOf: configURL)
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json["openai_api_key"] as? String == "sk-rotated")
        #expect(json["transcription_model"] as? String == "gpt-transcribe")
    }

    @Test("Saving an empty key removes it from config.json")
    func saveEmptyRemovesKey() throws {
        let home = try makeHome()
        try writeConfig(home: home, ["openai_api_key": "old-key"])

        try OpenAIAPIKeyStore.save(key: "   ", homePath: home.path)

        let key = OpenAIAPIKeyStore.load(
            homePath: home.path,
            environment: [:],
            userDefaultKey: nil
        )
        #expect(key == "")
    }

    @Test("Realtime transcription settings default to the live model and low delay")
    func realtimeSettingsDefaults() throws {
        let home = try makeHome()

        let settings = OpenAIAPIKeyStore.loadRealtimeTranscriptionSettings(
            homePath: home.path,
            environment: [:],
            storedLanguage: "en"
        )

        #expect(settings.model == "gpt-live-transcribe")
        #expect(settings.delay == "low")
        #expect(settings.prompt.isEmpty)
        #expect(settings.keywords.isEmpty)
        #expect(settings.languages == ["en"])
    }

    @Test("Realtime accuracy controls load from config.json")
    func realtimeSettingsFromConfig() throws {
        let home = try makeHome()
        try writeAnyConfig(home: home, [
            "realtime_transcription_model": "gpt-live-transcribe",
            "realtime_prompt": "Weekly infrastructure standup",
            "realtime_keywords": ["Hasna", "Alumia"],
            "realtime_languages": ["en", "FR"],
            "realtime_delay": "high",
        ])

        let settings = OpenAIAPIKeyStore.loadRealtimeTranscriptionSettings(
            homePath: home.path,
            environment: [:],
            storedLanguage: "en"
        )

        #expect(settings.prompt == "Weekly infrastructure standup")
        #expect(settings.keywords == ["Hasna", "Alumia"])
        #expect(settings.languages == ["en", "fr"])
        #expect(settings.delay == "high")
    }

    @Test("RECORDINGS_REALTIME_* env vars win over config.json")
    func realtimeSettingsFromEnvironment() throws {
        let home = try makeHome()
        try writeAnyConfig(home: home, [
            "realtime_prompt": "from config",
            "realtime_delay": "high",
        ])

        let settings = OpenAIAPIKeyStore.loadRealtimeTranscriptionSettings(
            homePath: home.path,
            environment: [
                "RECORDINGS_REALTIME_PROMPT": "from environment",
                "RECORDINGS_REALTIME_KEYWORDS": "Takumi, Alumia ,Takumi",
                "RECORDINGS_REALTIME_LANGUAGES": "de,invalid",
                "RECORDINGS_REALTIME_DELAY": "minimal",
            ],
            storedLanguage: "en"
        )

        #expect(settings.prompt == "from environment")
        #expect(settings.keywords == ["Takumi", "Alumia"])
        #expect(settings.languages == ["de"])
        #expect(settings.delay == "minimal")
    }

    @Test("An unsupported realtime delay falls back to the default")
    func realtimeSettingsRejectUnknownDelay() throws {
        let home = try makeHome()

        let settings = OpenAIAPIKeyStore.loadRealtimeTranscriptionSettings(
            homePath: home.path,
            environment: ["RECORDINGS_REALTIME_DELAY": "instant"],
            storedLanguage: "auto"
        )

        #expect(settings.delay == "low")
        #expect(settings.languages.isEmpty)
    }

    private func makeHome() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("recordings-key-store-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func writeConfig(home: URL, _ config: [String: String]) throws {
        try writeAnyConfig(home: home, config)
    }

    private func writeAnyConfig(home: URL, _ config: [String: Any]) throws {
        let configDir = home
            .appendingPathComponent(".hasna")
            .appendingPathComponent("recordings")
        try FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted])
        try data.write(to: configDir.appendingPathComponent("config.json"))
    }
}
