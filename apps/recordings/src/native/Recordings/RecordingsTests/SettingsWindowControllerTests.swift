import AppKit
import Testing
@testable import RecordingsLib

@MainActor
struct SettingsWindowControllerTests {
    @Test("Settings creates one window and reopens it after closing")
    func reusesSettingsWindow() {
        let policy = NSApplication.shared.activationPolicy()
        var creations = 0
        let controller = SettingsWindowController {
            creations += 1
            return NSView(frame: NSRect(x: 0, y: 0, width: 520, height: 500))
        }
        #expect(creations == 0)
        let first = controller.show()
        defer { first.close() }
        #expect(first.isVisible)
        #expect(first.title == "Hasna Recordings Settings")
        first.close()
        #expect(!first.isVisible)
        let reopened = controller.show()
        #expect(reopened === first)
        #expect(reopened.isVisible)
        #expect(creations == 1)
        #expect(NSApplication.shared.activationPolicy() == policy)
    }
}
