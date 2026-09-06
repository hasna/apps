import Foundation
import Security

/// Bridges Finder/menu-bar launches to the same environment contract as the CLI.
/// The endpoint is user configuration; credentials live in Keychain, scoped to that URL.
public enum ServiceAPIConfiguration {
    public static let defaultsKey = "recordingsServiceAPIURL"
    public static let didChangeNotification = Notification.Name("recordingsServiceAPIConfigurationDidChange")
    private static let keychainService = "com.hasna.recordings.service-api"

    enum Failure: Error, LocalizedError {
        case invalidURL
        case keychain(OSStatus)

        var errorDescription: String? {
            switch self {
            case .invalidURL:
                "Enter an HTTPS API URL without credentials, query parameters, or a fragment. Localhost may use HTTP."
            case .keychain(let status):
                "Could not access the Recordings API credential in Keychain (\(status))."
            }
        }
    }

    public static func normalizedURL(_ value: String) throws -> String {
        guard var url = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = url.host, !host.isEmpty,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.scheme == "https" || (url.scheme == "http" && ["localhost", "127.0.0.1", "[::1]", "::1"].contains(host)) else {
            throw Failure.invalidURL
        }
        var path = url.path
        while path.hasSuffix("/") { path.removeLast() }
        if !path.hasSuffix("/v1") { path += "/v1" }
        url.path = path
        guard let result = url.url?.absoluteString else { throw Failure.invalidURL }
        return result
    }

    public static func configuredURL(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        defaults: UserDefaults = .standard
    ) -> String {
        environment["HASNA_RECORDINGS_API_URL"] ?? defaults.string(forKey: defaultsKey) ?? ""
    }

    public static func save(url: String, apiKey: String, defaults: UserDefaults = .standard) throws {
        let endpoint = try normalizedURL(url)
        let key = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if !key.isEmpty {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: keychainService,
                kSecAttrAccount as String: endpoint,
            ]
            let value = [kSecValueData as String: Data(key.utf8)]
            var status = SecItemUpdate(query as CFDictionary, value as CFDictionary)
            if status == errSecItemNotFound {
                var item = query.merging(value) { _, new in new }
                item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
                status = SecItemAdd(item as CFDictionary, nil)
            }
            guard status == errSecSuccess else { throw Failure.keychain(status) }
        }
        defaults.set(endpoint, forKey: defaultsKey)
        NotificationCenter.default.post(name: didChangeNotification, object: nil)
    }

    static func loadKey(for endpoint: String) throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: endpoint,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw Failure.keychain(status) }
        return (result as? Data).flatMap { String(data: $0, encoding: .utf8) }
    }

    static func childEnvironment(
        base: [String: String],
        defaults: UserDefaults = .standard,
        keyLoader: (String) throws -> String? = loadKey
    ) throws -> [String: String] {
        // Explicit environment routing wins. Never attach a saved credential to an
        // unrelated environment endpoint, or silently turn a local override into HTTP.
        if ["HASNA_RECORDINGS_API_URL", "HASNA_RECORDINGS_CLIENT_STORE", "RECORDINGS_CLIENT_STORE"]
            .contains(where: { !(base[$0] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            return base
        }
        guard let saved = defaults.string(forKey: defaultsKey), !saved.isEmpty else { return base }
        let endpoint = try normalizedURL(saved)
        var result = base
        result["HASNA_RECORDINGS_API_URL"] = endpoint
        result["HASNA_RECORDINGS_CLIENT_STORE"] = "http"
        if ["HASNA_RECORDINGS_API_KEY_OVERRIDE", "HASNA_RECORDINGS_API_KEY"]
            .allSatisfy({ (base[$0] ?? "").isEmpty }), let key = try keyLoader(endpoint), !key.isEmpty {
            result["HASNA_RECORDINGS_API_KEY_OVERRIDE"] = key
        }
        return result
    }
}
