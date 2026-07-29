import Testing
import Foundation
@testable import RecordingsLib

struct TranscriptionResultIdentityTests {
    @Test("Each transcription has a unique id even with identical content and timestamp")
    func uniqueIdentity() {
        let now = Date()
        let a = TranscriptionResult(rawText: "hello", processedText: nil, timestamp: now)
        let b = TranscriptionResult(rawText: "hello", processedText: nil, timestamp: now)
        // Same content and exact same timestamp must not collide — identity drives
        // SwiftUI ForEach rows and the "copied" indicator.
        #expect(a.id != b.id)
    }

    @Test("displayText prefers processed text over raw")
    func displayTextPrefersProcessed() {
        let r = TranscriptionResult(rawText: "raw", processedText: "processed", timestamp: Date())
        #expect(r.displayText == "processed")
    }
}
