import SwiftUI

struct OfflineView: View {
  let baseURL: String

  var body: some View {
    VStack(spacing: 8) {
      Image(systemName: "exclamationmark.triangle.fill")
        .font(.system(size: 28))
        .foregroundStyle(.orange)
        .symbolEffect(.pulse)

      Text("Server offline")
        .font(.subheadline)
        .fontWeight(.semibold)

      Text(baseURL)
        .font(.caption)
        .fontDesign(.monospaced)
        .foregroundStyle(.secondary)

      Text("Run economy serve or update the server URL from the slider button.")
        .font(.caption2)
        .multilineTextAlignment(.center)
        .foregroundStyle(.tertiary)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 24)
  }
}
