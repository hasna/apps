import SwiftUI

struct AccountRowView: View {
  let account: AccountStat

  var body: some View {
    HStack(alignment: .firstTextBaseline) {
      VStack(alignment: .leading, spacing: 1) {
        Text(account.displayName)
          .font(.system(size: 12))
          .lineLimit(1)
          .truncationMode(.middle)
        Text(accountSubtitle)
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .truncationMode(.middle)
        Text("\(account.sessions) sessions / \(account.requests) req / \(fmtTokens(account.total_tokens)) tok")
          .font(.system(size: 10).monospacedDigit())
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      Spacer()
      VStack(alignment: .trailing, spacing: 1) {
        Text(fmtCost(account.api_equivalent_usd))
          .font(.system(size: 12, weight: .medium).monospacedDigit())
          .foregroundStyle(.primary)
        Text(account.billable_usd > 0
          ? "billable \(fmtCost(account.billable_usd))"
          : "included \(fmtCost(account.subscription_included_usd))")
          .font(.system(size: 10).monospacedDigit())
          .foregroundStyle(.secondary)
      }
    }
  }

  private func fmtCost(_ usd: Double) -> String {
    if usd >= 1000 { return String(format: "$%.0f", usd) }
    if usd >= 0.01 { return String(format: "$%.2f", usd) }
    if usd > 0 { return String(format: "$%.1f¢", usd * 100) }
    return "$0.00"
  }

  private var accountSubtitle: String {
    if account.account_name.isEmpty {
      return account.agentLabel
    }
    return "\(account.agentLabel) / \(account.account_name)"
  }

  private func fmtTokens(_ tokens: Int) -> String {
    if tokens >= 1_000_000_000 { return String(format: "%.1fB", Double(tokens) / 1_000_000_000) }
    if tokens >= 1_000_000 { return String(format: "%.1fM", Double(tokens) / 1_000_000) }
    if tokens >= 1_000 { return String(format: "%.1fK", Double(tokens) / 1_000) }
    return "\(tokens)"
  }
}
