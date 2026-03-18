import SwiftUI

struct ProjectRowView: View {
  let project: ProjectStat

  var body: some View {
    HStack {
      Text(project.project_name.isEmpty ? project.project_path.split(separator: "/").last.map(String.init) ?? "—" : project.project_name)
        .font(.system(size: 12))
        .lineLimit(1)
        .truncationMode(.middle)
      Spacer()
      Text(fmtCost(project.cost_usd))
        .font(.system(size: 12, weight: .medium).monospacedDigit())
        .foregroundStyle(.green)
    }
  }

  private func fmtCost(_ usd: Double) -> String {
    if usd >= 0.01 { return String(format: "$%.2f", usd) }
    if usd > 0 { return String(format: "%.1f¢", usd * 100) }
    return "$0.00"
  }
}
