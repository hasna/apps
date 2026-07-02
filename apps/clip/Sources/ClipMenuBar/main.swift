import AppKit
import ClipCore

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private let runner = ClipRunner()

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "Clip"
        statusItem.menu = buildMenu()
    }

    private func buildMenu() -> NSMenu {
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Capture Full Screen", action: #selector(captureFull), keyEquivalent: "1"))
        menu.addItem(NSMenuItem(title: "Capture Window", action: #selector(captureWindow), keyEquivalent: "2"))
        menu.addItem(NSMenuItem(title: "Capture Region", action: #selector(captureRegion), keyEquivalent: "3"))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Share Clipboard", action: #selector(shareClipboard), keyEquivalent: "c"))
        menu.addItem(NSMenuItem(title: "Open Recent", action: #selector(openRecent), keyEquivalent: "o"))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q"))
        for item in menu.items {
            item.target = self
        }
        return menu
    }

    @objc private func captureFull() {
        run(.captureFull())
    }

    @objc private func captureWindow() {
        run(.captureWindow())
    }

    @objc private func captureRegion() {
        run(.captureRegion())
    }

    @objc private func shareClipboard() {
        run(.shareClipboard())
    }

    @objc private func openRecent() {
        run(.openRecent())
    }

    @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }

    private func run(_ command: ClipCommand) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                _ = try self.runner.run(command)
            } catch {
                NSLog("OpenClip command failed: \(error.localizedDescription)")
            }
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
