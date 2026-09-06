import Foundation
import Testing
@testable import RecordingsLib

struct RecordingDateTests {
    @Test("History accepts PostgreSQL, ISO, and SQLite dates", arguments: [
        "2026-09-06 10:52:42.523193+00",
        "2026-09-06 10:52:42+00",
        "2026-09-06 16:22:42.523193+05:30",
        "2026-09-06 16:22:42+0530",
        "2026-09-06 06:52:42-04",
        "2026-09-06T10:52:42.523Z",
        "2026-09-06T10:52:42Z",
        "2026-09-06 10:52:42",
    ])
    func supportedDates(value: String) throws {
        let expected = try #require(ISO8601DateFormatter().date(from: "2026-09-06T10:52:42Z"))
        let actual = try #require(Recording.parseDate(value))
        #expect(abs(actual.timeIntervalSince(expected)) < 1)
    }

    @Test("Missing and invalid dates remain absent", arguments: ["", "invalid", "2026-09-06 10:52:42+99"])
    func invalidDates(value: String) {
        #expect(Recording.parseDate(value) == nil)
    }
}
