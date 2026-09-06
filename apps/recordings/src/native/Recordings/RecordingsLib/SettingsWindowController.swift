import AppKit

/// Settings must also open from an accessory app with no SwiftUI workspace scene.
/// Retain the window so repeated menu actions and closing/reopening preserve its state.
@MainActor
public final class SettingsWindowController {
    private var window: NSWindow?
    private let makeContent: @MainActor () -> NSView

    public init(content: @escaping @MainActor () -> NSView) {
        makeContent = content
    }

    @discardableResult
    public func show() -> NSWindow {
        let settings: NSWindow
        if let window {
            settings = window
        } else {
            settings = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 520, height: 500),
                styleMask: [.titled, .closable],
                backing: .buffered,
                defer: false
            )
            settings.title = "Hasna Recordings Settings"
            settings.isReleasedWhenClosed = false
            settings.contentView = makeContent()
            settings.center()
            window = settings
        }
        // Activation is needed when invoked from a menu-bar popover. Preserve the
        // activation policy so a bar-only app stays out of the Dock and app switcher.
        NSApplication.shared.activate()
        NSRunningApplication.current.activate(options: [.activateAllWindows])
        settings.makeKeyAndOrderFront(nil)
        return settings
    }
}
