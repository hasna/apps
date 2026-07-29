import Foundation
import Darwin

public enum PostProcessingMode: String, CaseIterable, Identifiable, Codable, Sendable {
    case off
    case auto
    case always

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .off: return "Raw"
        case .auto: return "Auto"
        case .always: return "Always"
        }
    }
}

public enum ProjectStoreError: Error, LocalizedError {
    case persistenceFailure(String)

    public var errorDescription: String? {
        switch self {
        case .persistenceFailure(let message): return message
        }
    }
}

/// Persisted app settings.
///
/// The projects feature was removed. Decoding stays tolerant of an existing
/// on-disk file that still carries `projects` / `activeProjectId`: those keys
/// are simply not read, so a pre-upgrade settings file still loads. Encoding
/// drops them, which is the forward-only outcome we want.
public struct ProjectSettings: Codable, Sendable {
    public var globalSystemPrompt: String
    public var postProcessingMode: String

    public init() {
        globalSystemPrompt = ""
        postProcessingMode = PostProcessingMode.auto.rawValue
    }

    enum CodingKeys: String, CodingKey {
        case globalSystemPrompt
        case postProcessingMode
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        globalSystemPrompt = try container.decodeIfPresent(String.self, forKey: .globalSystemPrompt) ?? ""
        postProcessingMode = try container.decodeIfPresent(String.self, forKey: .postProcessingMode) ?? PostProcessingMode.auto.rawValue
    }
}

@MainActor
public final class ProjectStore: ObservableObject {
    typealias SettingsDataLoader = (String) throws -> Data?

    @Published public var settings = ProjectSettings()
    @Published public private(set) var persistenceError: String?

    private let filePath: String
    private let dataLoader: SettingsDataLoader
    private var loadSucceeded = true
    private var loadFailureMessage: String?
    private var persistedData: Data?

    public var canPersistSettings: Bool { loadSucceeded }

    public var effectiveSystemPrompt: String {
        settings.globalSystemPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public var effectivePostProcessingMode: String {
        let mode = PostProcessingMode(rawValue: settings.postProcessingMode) ?? .auto
        return mode.rawValue
    }

    public convenience init(filePath: String? = nil) {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        self.init(
            filePath: filePath ?? "\(home)/.hasna/recordings/projects.json",
            dataLoader: Self.readSettingsData
        )
    }

    init(filePath: String, dataLoader: @escaping SettingsDataLoader) {
        self.filePath = filePath
        self.dataLoader = dataLoader
        loadSucceeded = load()
    }

    nonisolated private static func readSettingsData(atPath path: String) throws -> Data? {
        do {
            return try Data(contentsOf: URL(fileURLWithPath: path))
        } catch {
            let cocoaError = error as NSError
            if cocoaError.domain == NSCocoaErrorDomain,
               cocoaError.code == NSFileReadNoSuchFileError || cocoaError.code == NSFileNoSuchFileError {
                return nil
            }
            throw error
        }
    }

    @discardableResult
    func load() -> Bool {
        do {
            guard let data = try dataLoader(filePath) else {
                persistedData = nil
                loadFailureMessage = nil
                persistenceError = nil
                return true
            }
            settings = try JSONDecoder().decode(ProjectSettings.self, from: data)
            persistedData = data
            loadFailureMessage = nil
            persistenceError = nil
            return true
        } catch {
            let message = "Failed to load settings: \(error.localizedDescription)"
            blockMutations(message: message)
            return false
        }
    }

    public func save() throws {
        try requireWritableState()
        try persistSettings()
    }

    private func requireWritableState() throws {
        guard loadSucceeded else {
            throw ProjectStoreError.persistenceFailure(loadFailureMessage ?? "Failed to load settings")
        }
        try validatePersistedData()
    }

    private func validatePersistedData() throws {
        guard loadSucceeded else {
            throw ProjectStoreError.persistenceFailure(loadFailureMessage ?? "Failed to load settings")
        }
        do {
            guard try dataLoader(filePath) == persistedData else {
                let message = "Settings changed on disk. Restart Recordings before making changes."
                blockMutations(message: message)
                throw ProjectStoreError.persistenceFailure(message)
            }
        } catch let error as ProjectStoreError {
            throw error
        } catch {
            let message = "Failed to read settings before saving: \(error.localizedDescription)"
            blockMutations(message: message)
            throw ProjectStoreError.persistenceFailure(message)
        }
    }

    private func blockMutations(message: String) {
        loadSucceeded = false
        loadFailureMessage = message
        persistenceError = message
    }

    private func persistSettings() throws {
        do {
            let data = try JSONEncoder().encode(settings)
            let dir = (filePath as NSString).deletingLastPathComponent
            try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            try withExclusivePersistenceLock {
                try validatePersistedData()
                try data.write(to: URL(fileURLWithPath: filePath), options: .atomic)
                persistedData = data
            }
            persistenceError = nil
        } catch {
            if error is ProjectStoreError { throw error }
            persistenceError = "Failed to save settings: \(error.localizedDescription)"
            throw error
        }
    }

    private func withExclusivePersistenceLock<T>(_ operation: () throws -> T) throws -> T {
        let lockPath = "\(filePath).lock"
        let descriptor = Darwin.open(lockPath, O_CREAT | O_RDWR, mode_t(S_IRUSR | S_IWUSR))
        guard descriptor >= 0 else { throw posixError() }
        defer { Darwin.close(descriptor) }
        guard Darwin.lockf(descriptor, F_LOCK, 0) == 0 else { throw posixError() }
        defer { Darwin.lockf(descriptor, F_ULOCK, 0) }
        return try operation()
    }

    private func posixError() -> NSError {
        let code = errno
        return NSError(
            domain: NSPOSIXErrorDomain,
            code: Int(code),
            userInfo: [NSLocalizedDescriptionKey: String(cString: strerror(code))]
        )
    }

    public func clearPersistenceError() {
        persistenceError = nil
    }
}
