import Foundation

/// A separate application must opt into its own filesystem and preferences roots.
/// This configuration never installs shortcuts or uses the legacy provider, Keychain,
/// environment variables, helper CLI, or service connection. Providers own their credentials.
public struct RecordingEngineConfiguration: Sendable {
    public let isolatedHomePath: String
    public let preferencesSuiteName: String

    public init(isolatedHomePath: String, preferencesSuiteName: String) throws {
        let path = URL(fileURLWithPath: isolatedHomePath).standardizedFileURL.resolvingSymlinksInPath()
        let liveHome = FileManager.default.homeDirectoryForCurrentUser.resolvingSymlinksInPath()
        let state = path.appendingPathComponent(".hasna/recordings").resolvingSymlinksInPath()
        let liveState = liveHome.appendingPathComponent(".hasna/recordings").resolvingSymlinksInPath()
        guard isolatedHomePath.hasPrefix("/"), path != liveHome,
              state != liveState,
              !preferencesSuiteName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              preferencesSuiteName != "com.hasna.recordings",
              preferencesSuiteName != "NSGlobalDomain",
              preferencesSuiteName != "NSArgumentDomain" else {
            throw RecordingProviderError.invalidIsolation
        }
        self.isolatedHomePath = path.path
        self.preferencesSuiteName = preferencesSuiteName
    }
}

/// The native capture format is fixed so providers can forward PCM without conversion.
public struct RecordingProviderSessionConfiguration: Sendable {
    public let captureID: String
    public let language: String
    public let sampleRate: Int = 24_000
    public let channels: Int = 1
    public let bitsPerSample: Int = 16

    public init(captureID: String, language: String) {
        self.captureID = captureID
        self.language = language
    }
}

public struct RecordingTranscriptionRequest: Sendable {
    public let captureID: String
    /// A complete 24 kHz, mono, signed little-endian PCM16 WAV, excluding paused audio.
    public let audioURL: URL
    public let duration: TimeInterval
    public let language: String

    public init(captureID: String, audioURL: URL, duration: TimeInterval, language: String) {
        self.captureID = captureID
        self.audioURL = audioURL
        self.duration = duration
        self.language = language
    }
}

public struct RecordingProviderResult: Sendable, Equatable {
    public let rawText: String
    public let processedText: String?

    public init(rawText: String, processedText: String? = nil) {
        self.rawText = rawText
        self.processedText = processedText
    }
}

public protocol RecordingTranscriptionProvider: Sendable {
    /// Construct promptly; start network/recognition work asynchronously inside the session.
    /// Freeze mutable provider settings here so they cannot switch beneath a capture.
    /// Each partial callback replaces the complete current transcript, rather than appending.
    func makeSession(
        configuration: RecordingProviderSessionConfiguration,
        onPartialTranscript: @escaping @Sendable (String) -> Void
    ) throws -> any RecordingTranscriptionSession
}

public protocol RecordingTranscriptionSession: Sendable {
    /// Called in capture order with variable-sized admitted PCM packets, off the audio
    /// callback. Empty packets are omitted; all admitted packets precede inputEnded().
    /// Return promptly. Providers must bound any queue while connecting or sending.
    /// An in-flight append may race cancel; a cancelled session must ignore it.
    func appendPCM(_ data: Data)
    /// Called once after all capture/converter PCM drains, before the fallback WAV is written.
    /// Streaming providers may close input now and cache an early final result. Return promptly;
    /// this does not authorize publishing text or reading audioURL before finish is called.
    /// Must be thread-safe and idempotent, and ignore calls after cancellation.
    func inputEnded()
    /// Called once after capture drains and the fallback WAV is safely written.
    /// File-based providers may ignore appendPCM and recognize this file locally.
    func finish(_ request: RecordingTranscriptionRequest) async throws -> RecordingProviderResult
    /// Must be thread-safe and idempotent, including cancellation during finish.
    func cancel()
}

public extension RecordingTranscriptionSession {
    /// File providers and existing adapters keep their finish-after-WAV behavior.
    func inputEnded() {}
}

public enum RecordingProviderError: Error, LocalizedError, Sendable {
    case invalidIsolation
    case noAudio
    case emptyTranscript

    public var errorDescription: String? {
        switch self {
        case .invalidIsolation: "Provide a separate absolute state home and preferences suite for this app."
        case .noAudio: "No audio was captured."
        case .emptyTranscript: "No speech was recognized."
        }
    }
}
