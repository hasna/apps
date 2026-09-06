import Foundation

/// Keeps pause and metering on the audio-delivery queue, without publishing every PCM chunk.
final class CaptureMonitor: @unchecked Sendable {
    private let lock = NSLock()
    private var paused = false
    private var bytes = 0
    private var level: Double = 0

    func setPaused(_ value: Bool) { lock.withLock { paused = value; if value { level = 0 } } }

    func admit(_ data: Data) -> Bool {
        lock.withLock {
            guard !paused else { return false }
            bytes += data.count
            var sum: Double = 0
            var count = 0
            data.withUnsafeBytes { raw in
                for offset in stride(from: 0, to: max(0, raw.count - 1), by: 2) {
                    let value = Double(Int16(bitPattern: UInt16(raw[offset]) | UInt16(raw[offset + 1]) << 8)) / 32768
                    sum += value * value
                    count += 1
                }
            }
            level = count > 0 ? min(1, sqrt(sum / Double(count)) * 5) : 0
            return true
        }
    }

    func snapshot() -> (duration: Double, level: Double) {
        lock.withLock { (Double(bytes) / 48_000, level) }
    }
}

public struct RecentPaste: Identifiable, Sendable {
    public let id = UUID()
    public let text: String
    public let bundleIdentifier: String?
    public let appName: String
    public let location: String
    public let timestamp = Date()
    public let status: String
    public let verified: Bool
}
