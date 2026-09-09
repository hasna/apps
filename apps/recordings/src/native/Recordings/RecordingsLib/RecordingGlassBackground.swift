import SwiftUI
import AppKit

/// One live macOS material per surface. No opaque tint below the blur and no
/// per-meter-tick Liquid Glass surfaces; content remains legible in accessibility mode.
public struct RecordingGlassBackground: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    public var radius: CGFloat
    public init(radius: CGFloat = 16) { self.radius = radius }
    public var body: some View {
        ZStack {
            if ChromeSurface.forReducedTransparency(reduceTransparency) == .opaque {
                Color(NSColor.windowBackgroundColor)
            } else {
                NativeRecordingGlass()
                LinearGradient(colors: [.white.opacity(0.18), .clear, .white.opacity(0.06)], startPoint: .topLeading, endPoint: .bottomTrailing)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: radius))
        .overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(.white.opacity(0.45), lineWidth: 0.5))
    }
}

private struct NativeRecordingGlass: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = .hudWindow
        view.alphaValue = 0.9
        view.blendingMode = .behindWindow
        view.state = .active
        return view
    }
    func updateNSView(_ view: NSVisualEffectView, context: Context) {}
}
