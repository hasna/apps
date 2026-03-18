import SwiftUI

struct OfflineView: View {
  var body: some View {
    VStack(spacing: 8) {
      Image(systemName: "exclamationmark.triangle.fill")
        .font(.system(size: 28))
        .foregroundStyle(.orange)
        .symbolEffect(.pulse)
      Text("Server offline")
        .font(.subheadline)
        .fontWeight(.semibold)
      Text("economy serve")
        .font(.caption)
        .fontDesign(.monospaced)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 24)
  }
}
