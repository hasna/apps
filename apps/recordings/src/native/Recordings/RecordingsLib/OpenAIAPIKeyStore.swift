import Foundation
import Security

struct ProcessingModelSelection: Equatable, Sendable {
    let transcriptionPrompt: String
    let transcriptionModel: String
    let transcriberModel: String
    let enhancementModel: String
    let intentModel: String
    let enhanceTriggersJSON: String
    let keywordTransformsJSON: String
}

enum OpenAIAPIKeyStore {
    static let defaultLanguage = "en"

    static func load(
        homePath: String,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        userDefaultKey: String? = UserDefaults.standard.string(forKey: "openAIAPIKey"),
        keychainLoader: (() throws -> String?)? = nil
    ) -> String {
        if let key = firstNonEmpty(environment["RECORDINGS_OPENAI_API_KEY"], environment["OPENAI_API_KEY"], environment["RECORDINGS_API_KEY"]) {
            return key
        }
        // Test and resolver homes must never read the owner's credentials.
        if let loader = keychainLoader,
           let key = try? loader(), let key = firstNonEmpty(key) { return key }
        if keychainLoader == nil, homePath == FileManager.default.homeDirectoryForCurrentUser.path,
           let key = try? loadKeychain(), let key = firstNonEmpty(key) { return key }
        if let key = firstNonEmpty(userDefaultKey) {
            return key
        }
        if let key = loadConfigKey(homePath: homePath, environment: environment) {
            return key
        }
        if let key = loadSecretKey(homePath: homePath) {
            return key
        }
        return ""
    }

    static func loadLanguage(
        homePath: String,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        userDefaultLanguage: String? = UserDefaults.standard.string(forKey: "recordingsLanguage")
    ) -> String {
        if let language = firstNonEmpty(environment["RECORDINGS_LANGUAGE"]) {
            return normalizedStoredLanguage(language)
        }
        if let language = firstNonEmpty(userDefaultLanguage) {
            return normalizedStoredLanguage(language)
        }
        if let language = loadConfigValue(homePath: homePath, key: "language", environment: environment) {
            return normalizedStoredLanguage(language)
        }
        return defaultLanguage
    }

    static func loadProcessingModelSelection(
        homePath: String,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> ProcessingModelSelection {
        let json = loadMutableConfig(homePath: homePath)
        let enhancementModel = firstNonEmpty(
            environment["RECORDINGS_ENHANCEMENT_MODEL"],
            json["enhancement_model"] as? String
        ) ?? "gpt-4o"
        let transcriberModel = firstNonEmpty(
            environment["RECORDINGS_TRANSCRIBER_MODEL"],
            json["transcriber_model"] as? String,
            enhancementModel
        ) ?? enhancementModel
        let transcriptionModel = firstNonEmpty(
            environment["RECORDINGS_MODEL"],
            json["transcription_model"] as? String
        ) ?? "gpt-4o-transcribe"
        let intentModel = firstNonEmpty(
            environment["RECORDINGS_INTENT_MODEL"],
            json["intent_model"] as? String
        ) ?? "gpt-4o-mini"
        let triggers = (json["enhance_triggers"] as? [String]) ?? [
            "say it better", "rewrite this", "make it sound", "clean this up",
            "fix this", "rephrase", "write it properly", "make it professional",
            "improve this", "polish this",
        ]
        let triggerData = try? JSONSerialization.data(withJSONObject: triggers)
        let triggerJSON = triggerData.flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        let keywordTransforms = (json["keyword_transforms"] as? [String: String]) ?? [:]
        let transformData = try? JSONSerialization.data(withJSONObject: keywordTransforms)
        let transformJSON = transformData.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return ProcessingModelSelection(
            transcriptionPrompt: firstNonEmpty(
                environment["RECORDINGS_TRANSCRIPTION_PROMPT"],
                json["transcription_prompt"] as? String
            ) ?? "",
            transcriptionModel: transcriptionModel,
            transcriberModel: transcriberModel,
            enhancementModel: enhancementModel,
            intentModel: intentModel,
            enhanceTriggersJSON: triggerJSON,
            keywordTransformsJSON: transformJSON
        )
    }

    /// The app and its embedded helper share the provider credential through Keychain
    /// and an in-memory child environment. Never write a new key into preferences.
    static func save(
        key: String, homePath: String,
        defaults: UserDefaults = .standard,
        keychainWriter: (String) throws -> Void = saveKeychain
    ) throws {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        try keychainWriter(trimmed)
        var json = loadMutableConfig(homePath: homePath)
        if json.removeValue(forKey: "openai_api_key") != nil || json["api_key"] != nil {
            json.removeValue(forKey: "api_key")
            try writeConfig(json, homePath: homePath)
        }
        defaults.removeObject(forKey: "openAIAPIKey")
    }

    private static var keychainQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "hasna.credentials.openai.api-key",
         kSecAttrAccount as String: "openai/api_key"]
    }

    static func loadKeychain(allowInteraction: Bool = false) throws -> String? {
        var query = keychainQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        if !allowInteraction { query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail }
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainFailure(status: status) }
        return (result as? Data).flatMap { String(data: $0, encoding: .utf8) }
    }

    private static func saveKeychain(_ key: String) throws {
        let query = keychainQuery
        if key.isEmpty {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainFailure(status: status) }
            return
        }
        let value = [kSecValueData as String: Data(key.utf8)]
        var status = SecItemUpdate(query as CFDictionary, value as CFDictionary)
        if status == errSecItemNotFound {
            var item = query.merging(value) { _, new in new }
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(item as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw KeychainFailure(status: status) }
    }

    struct KeychainFailure: Error, LocalizedError {
        let status: OSStatus
        var errorDescription: String? { "Could not access the OpenAI key in Keychain (\(status))." }
    }

    static func childEnvironment(
        base: [String: String], homePath: String,
        keyLoader: (() -> String)? = nil
    ) -> [String: String] {
        var result = base
        let key = keyLoader?() ?? load(homePath: homePath, environment: base)
        // RECORDINGS_API_KEY is also an alias in the Hasna service resolver. Keeping
        // it would send a provider key to the service API as its authentication.
        result.removeValue(forKey: "RECORDINGS_API_KEY")
        if !key.isEmpty {
            result["OPENAI_API_KEY"] = key
            result["RECORDINGS_OPENAI_API_KEY"] = key
        }
        return result
    }

    static func saveLanguage(language: String, homePath: String) throws {
        let normalized = normalizedStoredLanguage(language)
        var json = loadMutableConfig(homePath: homePath)

        if apiLanguageHint(for: normalized).isEmpty {
            json.removeValue(forKey: "language")
        } else {
            json["language"] = normalized
        }

        try writeConfig(json, homePath: homePath)
    }

    static func apiLanguageHint(for storedLanguage: String) -> String {
        let normalized = normalizedStoredLanguage(storedLanguage)
        return normalized == "auto" ? "" : normalized
    }

    private static func loadConfigKey(homePath: String, environment: [String: String]) -> String? {
        for key in ["openai_api_key", "api_key"] {
            if let resolved = loadConfigValue(homePath: homePath, key: key, environment: environment) {
                return resolved
            }
        }
        return nil
    }

    private static func loadConfigValue(homePath: String, key: String, environment: [String: String]) -> String? {
        let json = loadMutableConfig(homePath: homePath)
        guard let value = json[key] as? String else { return nil }
        return resolve(value: value, environment: environment)
    }

    private static func loadMutableConfig(homePath: String) -> [String: Any] {
        let url = configURL(homePath: homePath)
        guard let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [:] }
        return json
    }

    private static func writeConfig(_ json: [String: Any], homePath: String) throws {
        let url = configURL(homePath: homePath)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: url, options: .atomic)
    }

    private static func configURL(homePath: String) -> URL {
        URL(fileURLWithPath: homePath)
            .appendingPathComponent(".hasna")
            .appendingPathComponent("recordings")
            .appendingPathComponent("config.json")
    }

    private static func loadSecretKey(homePath: String) -> String? {
        let root = URL(fileURLWithPath: homePath).appendingPathComponent(".secrets")
        let fileManager = FileManager.default
        guard let enumerator = fileManager.enumerator(
            at: root,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else { return nil }

        for case let url as URL in enumerator {
            guard url.pathExtension == "env",
                  let values = try? parseEnvFile(url: url)
            else { continue }

            if let key = firstNonEmpty(values["RECORDINGS_API_KEY"], values["OPENAI_API_KEY"]) {
                return key
            }
        }
        return nil
    }

    private static func parseEnvFile(url: URL) throws -> [String: String] {
        let content = try String(contentsOf: url, encoding: .utf8)
        var values: [String: String] = [:]

        for rawLine in content.split(whereSeparator: \.isNewline) {
            var line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !line.isEmpty, !line.hasPrefix("#") else { continue }
            if line.hasPrefix("export ") {
                line.removeFirst("export ".count)
            }

            let parts = line.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard parts.count == 2 else { continue }

            let key = parts[0].trimmingCharacters(in: .whitespacesAndNewlines)
            let value = stripQuotes(String(parts[1]).trimmingCharacters(in: .whitespacesAndNewlines))
            values[key] = value
        }

        return values
    }

    private static func resolve(value: String, environment: [String: String]) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.hasPrefix("$"), trimmed.count > 1 {
            return firstNonEmpty(environment[String(trimmed.dropFirst())])
        }
        return trimmed
    }

    private static func stripQuotes(_ value: String) -> String {
        guard value.count >= 2 else { return value }
        if (value.hasPrefix("\"") && value.hasSuffix("\"")) ||
            (value.hasPrefix("'") && value.hasSuffix("'")) {
            return String(value.dropFirst().dropLast())
        }
        return value
    }

    private static func normalizedStoredLanguage(_ language: String) -> String {
        let trimmed = language.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return trimmed.isEmpty ? defaultLanguage : trimmed
    }

    private static func firstNonEmpty(_ values: String?...) -> String? {
        for value in values {
            let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !trimmed.isEmpty {
                return trimmed
            }
        }
        return nil
    }
}
