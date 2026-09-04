// Hasna Conversations — native macOS shell.
//
// The bundled browser UI (web/ and dashboard/) was removed; the shell spawns the
// local HTTP server (Contents/Resources/app/src/server/serve.ts, run with bun),
// which exposes the /api/* routes backed by the active Store. This shell:
//   1. spawns that server on a free 127.0.0.1 port for the in-app client,
//   2. waits for /health,
//   3. supervises the child server and tears it down on quit.
import AppKit
import WebKit
import Foundation
// Store resolution lives in a separate, AppKit-free target so it can be tested.
// See Sources/HasnaConversationsCore/StoreResolution.swift.
import HasnaConversationsCore

// MARK: - Paths & environment

/// Resolve the bundled app payload directory (Contents/Resources/app).
func resourcesAppDir() -> URL {
    if let res = Bundle.main.resourceURL {
        let candidate = res.appendingPathComponent("app", isDirectory: true)
        if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
    }
    // Dev fallback: run straight from the repo (…/.build/…/HasnaConversationsApp).
    let repo = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    return repo
}

/// Find a usable `bun` binary across the common install locations.
func findBun() -> String? {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    let candidates = [
        "\(home)/.bun/bin/bun",
        "/opt/homebrew/bin/bun",
        "/usr/local/bin/bun",
        "/usr/bin/bun",
    ]
    for c in candidates where FileManager.default.isExecutableFile(atPath: c) { return c }
    // Fall back to `which bun` via a login-ish PATH.
    let which = Process()
    which.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    which.arguments = ["bash", "-lc", "command -v bun"]
    let pipe = Pipe()
    which.standardOutput = pipe
    try? which.run()
    which.waitUntilExit()
    let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
        .trimmingCharacters(in: .whitespacesAndNewlines)
    if let out, !out.isEmpty, FileManager.default.isExecutableFile(atPath: out) { return out }
    return nil
}

/// Ask the kernel for a free TCP port on the loopback interface.
func freeLoopbackPort() -> Int {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    guard fd >= 0 else { return 8797 }
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")
    addr.sin_port = 0
    let bound = withUnsafePointer(to: &addr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    var port = 8797
    if bound == 0 {
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        withUnsafeMutablePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                _ = getsockname(fd, $0, &len)
            }
        }
        port = Int(UInt16(bigEndian: addr.sin_port))
    }
    close(fd)
    return port
}

func resolveAgentId() -> String {
    if let env = ProcessInfo.processInfo.environment["CONVERSATIONS_AGENT_ID"],
       !env.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return env
    }
    // Default to the short hostname so DMs/messages are attributed to this machine.
    let host = ProcessInfo.processInfo.hostName
        .replacingOccurrences(of: ".local", with: "")
        .components(separatedBy: ".").first ?? "user"
    return host.isEmpty ? "user" : host
}

// MARK: - Backend server supervisor

final class Backend: @unchecked Sendable {
    private(set) var port: Int = 0
    private var proc: Process?

    /// Start the bundled server against an already-resolved store environment.
    /// The caller resolves the store first and refuses to call this at all when
    /// the store is ambiguous, so the server is never launched with an
    /// environment that would let it fall back to a local database.
    func start(storeEnv: [String: String]) -> Bool {
        guard let bun = findBun() else {
            NSLog("HasnaConversations: bun not found; cannot start server")
            return false
        }
        let appDir = resourcesAppDir()
        let serve = appDir.appendingPathComponent("src/server/serve.ts").path
        guard FileManager.default.fileExists(atPath: serve) else {
            NSLog("HasnaConversations: server entry not found at \(serve)")
            return false
        }
        port = freeLoopbackPort()

        let p = Process()
        p.executableURL = URL(fileURLWithPath: bun)
        p.arguments = ["run", serve]
        p.currentDirectoryURL = appDir

        var env = storeEnv
        env["PORT"] = String(port)
        env["CONVERSATIONS_DASHBOARD_HOST"] = "127.0.0.1"
        env["CONVERSATIONS_AGENT_ID"] = resolveAgentId()
        // Never let the app inherit an MCP-HTTP toggle that would bind a fixed port.
        env.removeValue(forKey: "MCP_HTTP")
        env.removeValue(forKey: "MCP_HTTP_PORT")
        p.environment = env

        let out = Pipe()
        p.standardOutput = out
        p.standardError = out
        out.fileHandleForReading.readabilityHandler = { h in
            let d = h.availableData
            if !d.isEmpty, let s = String(data: d, encoding: .utf8) { NSLog("Server: %@", s) }
        }

        do {
            try p.run()
            proc = p
            return true
        } catch {
            NSLog("HasnaConversations: failed to launch server: \(error)")
            return false
        }
    }

    /// Poll /health until the server answers or the deadline passes.
    func waitUntilReady(timeout: TimeInterval = 20) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        let url = URL(string: "http://127.0.0.1:\(port)/health")!
        while Date() < deadline {
            let sem = DispatchSemaphore(value: 0)
            var ok = false
            var req = URLRequest(url: url)
            req.timeoutInterval = 1.5
            URLSession.shared.dataTask(with: req) { _, resp, _ in
                if let http = resp as? HTTPURLResponse, http.statusCode == 200 { ok = true }
                sem.signal()
            }.resume()
            _ = sem.wait(timeout: .now() + 2)
            if ok { return true }
            Thread.sleep(forTimeInterval: 0.25)
        }
        return false
    }

    /// Log the store the CHILD reports, not the one this shell asked for.
    ///
    /// The two are different claims and only the second is a measurement. An
    /// earlier version logged `store=hosted` and stopped there, which an operator
    /// debugging the owner's exact symptom would read as confirmation — while the
    /// server it had just started was serving the on-box SQLite file. `/api/status`
    /// names the store that answered it (`api_url` when hosted, `db_path` when
    /// local), so this turns the announcement into an observation. Advisory only:
    /// a failed probe never stops the app.
    func logResolvedStore(expected: String) {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/status") else { return }
        let sem = DispatchSemaphore(value: 0)
        var req = URLRequest(url: url)
        req.timeoutInterval = 3
        URLSession.shared.dataTask(with: req) { data, _, _ in
            defer { sem.signal() }
            guard let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else {
                NSLog("HasnaConversations: could not read /api/status; child store unverified")
                return
            }
            // Field NAMES only — never the api_url value, which can carry a token
            // in a query string, and never anything from the key.
            let reported = json["db_path"] != nil ? "local" : (json["api_url"] != nil ? "hosted" : "unknown")
            if reported == expected {
                NSLog("HasnaConversations: child confirms store=%@", reported)
            } else {
                NSLog(
                    "HasnaConversations: STORE MISMATCH — this shell configured store=%@ but the "
                        + "server reports store=%@. The data shown is not the store that was asked for.",
                    expected, reported
                )
            }
        }.resume()
        _ = sem.wait(timeout: .now() + 4)
    }

    func stop() {
        proc?.terminate()
        proc = nil
    }
}

// MARK: - Window drag strip

/// A transparent NSView pinned to the top of the content that lets the user drag the
/// (hidden-titlebar) window. `mouseDownCanMoveWindow` makes AppKit move the window when a
/// drag begins here, without the view swallowing the event for the WKWebView beneath.
final class WindowDragStrip: NSView {
    override var mouseDownCanMoveWindow: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil } // let clicks fall through
}

// MARK: - App delegate

let backend = Backend()

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var web: WKWebView!
    private var dragStrip: WindowDragStrip?

    func applicationDidFinishLaunching(_ note: Notification) {
        NSApp.setActivationPolicy(.regular)

        // Resolve the store BEFORE starting anything. An unresolved store is a
        // hard stop, not a reason to fall through to whatever the server would
        // pick on its own — that fallback is the bug this guard exists to close.
        let resolution = resolveStore()
        var unresolvedReason: String? = nil
        var started = false
        var configuredStore: String? = nil
        switch resolution {
        case .cloud(let env, let url):
            NSLog("HasnaConversations: configured store=hosted url=%@", url)
            configuredStore = "hosted"
            started = backend.start(storeEnv: env)
        case .explicitLocal(let env, let selectedBy):
            // Name the variable that ACTUALLY selected local. Claiming a fixed
            // one is the same defect class this commit's sibling fixed: an
            // operator who chose local through HASNA_CONVERSATIONS_DB_PATH was
            // told it came from a variable they never set, and would go looking
            // for it.
            NSLog("HasnaConversations: configured store=local (explicitly requested via %@)", selectedBy)
            configuredStore = "local"
            started = backend.start(storeEnv: env)
        case .unresolved(let reason):
            NSLog("HasnaConversations: refusing to start — no unambiguous store. %@", reason)
            unresolvedReason = reason
        }
        let ready = started && backend.waitUntilReady()
        if ready, let configuredStore { backend.logResolvedStore(expected: configuredStore) }

        let frame = NSRect(x: 0, y: 0, width: 1080, height: 720)
        window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.title = "Hasna Conversations"
        window.isMovableByWindowBackground = true
        window.backgroundColor = .windowBackgroundColor
        window.minSize = NSSize(width: 900, height: 600)
        window.center()

        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()

        // Inject `native` body class + boot config BEFORE the page's JS runs.
        let boot = "window.__BOOT__={apiBase:'',agentId:\(jsString(resolveAgentId())),native:true};"
            + "document.addEventListener('DOMContentLoaded',function(){document.body.classList.add('native');});"
        cfg.userContentController.addUserScript(
            WKUserScript(source: boot, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )

        web = WKWebView(frame: frame, configuration: cfg)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.setValue(false, forKey: "drawsBackground") // avoid white flash in dark mode
        web.autoresizingMask = [.width, .height]
        if #available(macOS 13.3, *) { web.isInspectable = true }

        let container = NSView(frame: frame)
        container.autoresizingMask = [.width, .height]
        container.addSubview(web)

        let headerDragHeight: CGFloat = 52
        let strip = WindowDragStrip(frame: NSRect(x: 0, y: frame.height - headerDragHeight,
                                                  width: frame.width, height: headerDragHeight))
        strip.autoresizingMask = [.width, .minYMargin]
        container.addSubview(strip)
        dragStrip = strip

        window.contentView = container

        if ready {
            let url = URL(string: "http://127.0.0.1:\(backend.port)/")!
            web.load(URLRequest(url: url))
        } else {
            web.loadHTMLString(errorPage(started: started, unresolved: unresolvedReason), baseURL: nil)
        }

        buildMenu()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func jsString(_ s: String) -> String {
        let escaped = s
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        return "'\(escaped)'"
    }

    private func errorPage(started: Bool, unresolved: String? = nil) -> String {
        // The unresolved-store case is deliberately loud and specific. Showing a
        // generic failure here, or worse quietly serving local data, is what let
        // this app present a stale on-box database as the fleet's conversations.
        let reason: String
        if let unresolved {
            reason = """
            Not connected to the hosted conversations service, so nothing is shown.<br><br>
            <span style="opacity:.75">\(unresolved)</span>
            """
        } else if started {
            reason = "The conversations server did not become ready in time."
        } else {
            reason = "Could not start the conversations server. Is <code>bun</code> installed?"
        }
        return """
        <html><head><meta name="color-scheme" content="light dark"></head>
        <body style="font:14px -apple-system,sans-serif;display:grid;place-items:center;height:100vh;margin:0;
        background:#1B1D21;color:#E7E8EA;text-align:center">
        <div><div style="font-size:40px;color:#9D6BFF">✳︎</div>
        <h2>Hasna Conversations</h2><p>\(reason)</p></div></body></html>
        """
    }

    // MARK: WKNavigationDelegate
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        NSLog("HasnaConversations: navigation failed: \(error)")
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        NSLog("HasnaConversations: provisional navigation failed: \(error)")
    }

    // MARK: WKUIDelegate — WKWebView renders no UI for alert/confirm/prompt itself.
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "OK")
        a.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message
        a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let a = NSAlert(); a.messageText = prompt
        a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        field.stringValue = defaultText ?? ""
        a.accessoryView = field
        a.beginSheetModal(for: window) { r in
            completionHandler(r == .alertFirstButtonReturn ? field.stringValue : nil)
        }
    }

    // MARK: Lifecycle
    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ note: Notification) { backend.stop() }

    // MARK: Menu (so Cmd+C/V/X/A/Z and Quit work inside the WKWebView)
    private func buildMenu() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Hasna Conversations", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Hasna Conversations", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit Hasna Conversations", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        let viewItem = NSMenuItem()
        mainMenu.addItem(viewItem)
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
        viewItem.submenu = viewMenu

        let winItem = NSMenuItem()
        mainMenu.addItem(winItem)
        let winMenu = NSMenu(title: "Window")
        winMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
        winMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        winItem.submenu = winMenu

        NSApp.mainMenu = mainMenu
    }

    @objc private func reload() { web.reload() }
}

// MARK: - Entry point

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
