import RecordingsLib
import SwiftUI

/// Shared colors and glass surfaces for the minimal recordings window.
enum Theme {
    /// Accent used for selection highlights and small affordances.
    static let accent = Color(red: 0.42, green: 0.34, blue: 0.92)
    static let recordRed = Color(red: 0.92, green: 0.26, blue: 0.30)

    static let cornerLarge: CGFloat = 22
    static let cornerMedium: CGFloat = 14
    static let cornerSmall: CGFloat = 9

    /// Continuous main canvas color: pure white in light mode, system window background in dark.
    static func canvas(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(NSColor.windowBackgroundColor) : .white
    }


}

extension View {
    /// Liquid Glass surface on macOS 26, honoring reduce-transparency. Used sparingly —
    /// chiefly the record control — never as boxed panels in the canvas.
    @ViewBuilder
    func glassSurface(cornerRadius: CGFloat, tint: Color? = nil, interactive: Bool = false) -> some View {
        modifier(GlassSurface(cornerRadius: cornerRadius, tint: tint, interactive: interactive))
    }
}

private struct GlassSurface: ViewModifier {
    let cornerRadius: CGFloat
    let tint: Color?
    let interactive: Bool
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    @ViewBuilder
    func body(content: Content) -> some View {
        switch ChromeSurface.forReducedTransparency(reduceTransparency) {
        case .opaque:
            // Reduce Transparency: opaque system background, never a translucent material.
            content
                .background(
                    Color(NSColor.windowBackgroundColor),
                    in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .strokeBorder(.separator, lineWidth: 1)
                )
        case .liquidGlass:
            content.glassEffect(makeGlass(), in: .rect(cornerRadius: cornerRadius))
        }
    }

    private func makeGlass() -> Glass {
        var glass: Glass = .regular
        if let tint { glass = glass.tint(tint) }
        if interactive { glass = glass.interactive() }
        return glass
    }
}

extension Date {
    /// Compact relative description for list rows, e.g. "2h ago".
    var relativeDescription: String {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f.localizedString(for: self, relativeTo: Date())
    }
}
