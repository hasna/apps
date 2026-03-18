import SwiftUI

struct OfflineView: View {
  var body: some View {
    VStack(spacing: 8) {
      Image(systemName: "exclamationmark.triangle.fill")
        .font(.system(size: 28))
        .foregroundStyle(.orange)
      Text("Server offline")
        .font(.system(size: 13, weight: .medium))
      Text("Start with: economy serve")
        .font(.system(size: 11))
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 16)
  }
}
