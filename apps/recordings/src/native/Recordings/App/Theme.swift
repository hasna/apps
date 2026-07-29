import RecordingsLib
import SwiftUI

/// The Recordings design system — deliberately small enough to hold in your head:
/// one accent, one alert color, three corner radii, three spacing steps, one chrome
/// font. Everything else leans on macOS system colors and materials. The identity
/// is an "infinity violet" Liquid-Glass sidebar beside one continuous canvas.
enum Theme {
    // MARK: Color

    /// Accent used for selection highlights and small affordances.
    static let accent = Color(red: 0.42, green: 0.34, blue: 0.92)
    /// Recording / destructive-adjacent alert color. Never the only signal —
    /// always paired with an icon or label.
    static let recordRed = Color(red: 0.92, green: 0.26, blue: 0.30)

    // MARK: Shape

    static let cornerLarge: CGFloat = 22
    static let cornerMedium: CGFloat = 14
    static let cornerSmall: CGFloat = 9

    // MARK: Spacing — the only steps chrome should need.

    static let spacingS: CGFloat = 8
    static let spacingM: CGFloat = 16
    static let spacingL: CGFloat = 24

    // MARK: Type

    /// Chrome label font (header line, metadata). Tracks Dynamic Type.
    static let labelFont = Font.system(.subheadline, design: .rounded)

    // MARK: Layout

    /// Deliberately narrow, Apple-style sidebar.
    static let sidebarWidth: CGFloat = 204

    /// Continuous main canvas color: pure white in light mode, system window background in dark.
    static func canvas(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(NSColor.windowBackgroundColor) : .white
    }

    /// "Infinity violet" sidebar gradient rendered behind the Liquid Glass rows so
    /// the glass refracts the color. Two stops; darkened in dark mode so white
    /// sidebar text keeps contrast.
    static func sidebarGradient(_ scheme: ColorScheme) -> LinearGradient {
        let colors: [Color] = scheme == .dark
            ? [Color(red: 0.16, green: 0.09, blue: 0.34),
               Color(red: 0.28, green: 0.12, blue: 0.46)]
            : [Color(red: 0.30, green: 0.18, blue: 0.66),
               Color(red: 0.44, green: 0.18, blue: 0.70)]
        return LinearGradient(colors: colors, startPoint: .top, endPoint: .bottom)
    }
}

extension View {
    /// Liquid Glass surface on macOS 26, honoring reduce-transparency. Used sparingly —
    /// chiefly the sidebar rows and the record hero — never as boxed panels in the canvas.
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
