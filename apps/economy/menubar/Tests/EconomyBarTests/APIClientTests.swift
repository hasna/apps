import Foundation
import XCTest
@testable import EconomyBar

final class APIClientTests: XCTestCase {
  override func tearDown() {
    MockURLProtocol.handler = nil
    super.tearDown()
  }

  func testNormalizeBaseURL() {
    XCTAssertEqual(APIClient.normalizeBaseURL(" economy.local:3456/ "), "http://economy.local:3456")
    XCTAssertEqual(APIClient.normalizeBaseURL("https://economy.local/api/"), "https://economy.local/api")
    XCTAssertEqual(APIClient.normalizeBaseURL("   "), APIClient.defaultBaseURL)
  }

  func testSetBaseURLNormalizesAndPersists() async {
    let previous = UserDefaults.standard.string(forKey: APIClient.defaultsKey)
    defer {
      if let previous {
        UserDefaults.standard.set(previous, forKey: APIClient.defaultsKey)
      } else {
        UserDefaults.standard.removeObject(forKey: APIClient.defaultsKey)
      }
    }

    let client = APIClient(baseURL: APIClient.defaultBaseURL, session: makeSession())
    let normalized = await client.setBaseURL(" economy.test:4567/ ")

    XCTAssertEqual(normalized, "http://economy.test:4567")
    XCTAssertEqual(APIClient.storedBaseURL(), "http://economy.test:4567")
  }

  func testFetchSessionsEncodesSearchAndDecodesWrappedResponse() async throws {
    var capturedRequest: URLRequest?
    MockURLProtocol.handler = { request in
      capturedRequest = request
      return ok("""
      {
        "data": [
          {
            "id": "session-1234567890abcdef",
            "agent": "codex",
            "project_path": "/tmp/open-economy",
            "project_name": null,
            "total_cost_usd": 1.25,
            "total_tokens": 1234,
            "request_count": 5,
            "started_at": "2026-05-09T03:00:00Z",
            "ended_at": null
          }
        ]
      }
      """, request: request)
    }

    let client = APIClient(baseURL: "https://economy.test/", session: makeSession())
    let sessions = try await client.fetchSessions(search: " codex project ", limit: 10)

    XCTAssertEqual(sessions.count, 1)
    XCTAssertEqual(sessions[0].agent, "codex")
    XCTAssertEqual(sessions[0].displayProject, "open-economy")

    let requestURL = try XCTUnwrap(capturedRequest?.url)
    let components = try XCTUnwrap(URLComponents(url: requestURL, resolvingAgainstBaseURL: false))
    XCTAssertEqual(components.scheme, "https")
    XCTAssertEqual(components.host, "economy.test")
    XCTAssertEqual(components.path, "/api/sessions")
    XCTAssertEqual(components.queryItems?.first(where: { $0.name == "limit" })?.value, "10")
    XCTAssertEqual(components.queryItems?.first(where: { $0.name == "search" })?.value, "codex project")
  }

  func testFetchAccountsDecodesWrappedResponse() async throws {
    var capturedRequest: URLRequest?
    MockURLProtocol.handler = { request in
      capturedRequest = request
      return ok("""
      {
        "data": [
          {
            "account_key": "claude:work@example.com",
            "account_tool": "claude",
            "account_name": "work",
            "account_email": "work@example.com",
            "account_source": "current",
            "sessions": 2,
            "requests": 3,
            "total_tokens": 4567,
            "api_equivalent_usd": 1.75,
            "billable_usd": 1.25,
            "metered_api_usd": 1.25,
            "subscription_included_usd": 0.5,
            "estimated_usd": 0,
            "unknown_usd": 0,
            "cost_usd": 1.75,
            "last_active": "2026-06-04T10:00:00Z"
          }
        ]
      }
      """, request: request)
    }

    let client = APIClient(baseURL: "https://economy.test/", session: makeSession())
    let accounts = try await client.fetchAccounts()

    XCTAssertEqual(accounts.count, 1)
    XCTAssertEqual(accounts[0].displayName, "work@example.com")
    XCTAssertEqual(accounts[0].agentLabel, "Claude")
    XCTAssertEqual(accounts[0].account_email, "work@example.com")
    XCTAssertEqual(accounts[0].api_equivalent_usd, 1.75)
    XCTAssertEqual(accounts[0].billable_usd, 1.25)
    XCTAssertEqual(accounts[0].subscription_included_usd, 0.5)

    let requestURL = try XCTUnwrap(capturedRequest?.url)
    XCTAssertEqual(requestURL.path, "/api/accounts")
    XCTAssertEqual(URLComponents(url: requestURL, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "period" })?.value, "month")
  }

  func testFetchProjectsDecodesWrappedResponseAndPassesPeriod() async throws {
    var capturedRequest: URLRequest?
    MockURLProtocol.handler = { request in
      capturedRequest = request
      return ok("""
      {
        "data": [
          {
            "project_path": "/workspace/open-economy",
            "project_name": "open-economy",
            "sessions": 2,
            "requests": 4,
            "total_tokens": 9876,
            "cost_usd": 3.25,
            "last_active": "2026-06-04T10:00:00Z"
          }
        ]
      }
      """, request: request)
    }

    let client = APIClient(baseURL: "https://economy.test/", session: makeSession())
    let projects = try await client.fetchProjects(period: "week")

    XCTAssertEqual(projects.count, 1)
    XCTAssertEqual(projects[0].displayName, "open-economy")
    XCTAssertEqual(projects[0].requests, 4)
    XCTAssertEqual(projects[0].total_tokens, 9876)

    let requestURL = try XCTUnwrap(capturedRequest?.url)
    XCTAssertEqual(requestURL.path, "/api/projects")
    XCTAssertEqual(URLComponents(url: requestURL, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "period" })?.value, "week")
  }

  func testFetchAgentsDecodesWrappedResponse() async throws {
    var capturedRequest: URLRequest?
    MockURLProtocol.handler = { request in
      capturedRequest = request
      return ok("""
      {
        "data": [
          {
            "agent": "codex",
            "sessions": 4,
            "requests": 8,
            "total_tokens": 123456,
            "api_equivalent_usd": 12.5,
            "billable_usd": 0,
            "metered_api_usd": 0,
            "subscription_included_usd": 12.5,
            "estimated_usd": 0,
            "unknown_usd": 0,
            "cost_usd": 12.5,
            "last_active": "2026-06-04T10:00:00Z"
          }
        ]
      }
      """, request: request)
    }

    let client = APIClient(baseURL: "https://economy.test/", session: makeSession())
    let agents = try await client.fetchAgents()

    XCTAssertEqual(agents.count, 1)
    XCTAssertEqual(agents[0].displayName, "Codex")
    XCTAssertEqual(agents[0].total_tokens, 123456)
    XCTAssertEqual(agents[0].api_equivalent_usd, 12.5)
    XCTAssertEqual(agents[0].subscription_included_usd, 12.5)

    let requestURL = try XCTUnwrap(capturedRequest?.url)
    let components = URLComponents(url: requestURL, resolvingAgainstBaseURL: false)
    XCTAssertEqual(requestURL.path, "/api/breakdown")
    XCTAssertEqual(components?.queryItems?.first(where: { $0.name == "by" })?.value, "agent")
    XCTAssertEqual(components?.queryItems?.first(where: { $0.name == "period" })?.value, "month")
  }

  func testFetchSubscriptionsDecodesWrappedResponse() async throws {
    var capturedRequest: URLRequest?
    MockURLProtocol.handler = { request in
      capturedRequest = request
      return ok("""
      {
        "data": [
          {
            "id": "anthropic-claude-max",
            "agent": "claude",
            "provider": "anthropic",
            "plan": "claude max",
            "monthly_fee_usd": 200,
            "included_usage_usd": 200,
            "billing_cycle_start": null,
            "reset_policy": "monthly",
            "active": 1,
            "created_at": "2026-06-04T10:00:00Z",
            "updated_at": "2026-06-04T10:00:00Z"
          }
        ]
      }
      """, request: request)
    }

    let client = APIClient(baseURL: "https://economy.test/", session: makeSession())
    let subscriptions = try await client.fetchSubscriptions()

    XCTAssertEqual(subscriptions.count, 1)
    XCTAssertEqual(subscriptions[0].displayName, "anthropic / claude max")
    XCTAssertEqual(subscriptions[0].agentLabel, "Claude")
    XCTAssertEqual(subscriptions[0].monthly_fee_usd, 200)
    XCTAssertEqual(subscriptions[0].included_usage_usd, 200)

    let requestURL = try XCTUnwrap(capturedRequest?.url)
    XCTAssertEqual(requestURL.path, "/api/subscriptions")
  }

  func testFetchUsageDecodesMultiAgentSnapshots() async throws {
    var capturedRequest: URLRequest?
    MockURLProtocol.handler = { request in
      capturedRequest = request
      return ok("""
      {
        "data": {
          "snapshots": [
            {
              "id": "claude-usage",
              "agent": "claude",
              "metric": "five_hour_utilization",
              "value": 82,
              "unit": "percent",
              "date": "2026-06-04",
              "machine_id": "spark02"
            },
            {
              "id": "cursor-usage",
              "agent": "cursor",
              "metric": "monthly_quota_used",
              "value": 41,
              "unit": "percent",
              "date": "2026-06-04",
              "machine_id": "apple01"
            }
          ],
          "summary": {
            "total_usd": 0,
            "sessions": 0,
            "requests": 0,
            "tokens": 0
          }
        }
      }
      """, request: request)
    }

    let client = APIClient(baseURL: "https://economy.test/", session: makeSession())
    let usage = try await client.fetchUsage()

    XCTAssertEqual(usage.snapshots.count, 2)
    XCTAssertEqual(usage.snapshots[0].id, "claude-usage")
    XCTAssertEqual(usage.snapshots[0].displayAgent, "Claude")
    XCTAssertEqual(usage.snapshots[0].displayMetric, "five hour utilization")
    XCTAssertEqual(usage.snapshots[0].displayValue, "82%")
    XCTAssertEqual(usage.snapshots[1].displayAgent, "Cursor")

    let requestURL = try XCTUnwrap(capturedRequest?.url)
    XCTAssertEqual(requestURL.path, "/api/usage")
    XCTAssertEqual(URLComponents(url: requestURL, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "period" })?.value, "month")
  }

  func testFetchFleetDecodesSummaryAndMachineRows() async throws {
    var capturedRequest: URLRequest?
    MockURLProtocol.handler = { request in
      capturedRequest = request
      return ok("""
      {
        "data": {
          "summary": {
            "total_usd": 383.87,
            "sessions": 7,
            "requests": 587,
            "tokens": 152579348
          },
          "machines": [
            {
              "machine_id": "spark02",
              "sessions": 6,
              "requests": 356,
              "total_cost_usd": 329.72,
              "last_active": "2026-06-05T07:08:54.631Z"
            },
            {
              "machine_id": "apple06",
              "sessions": 1,
              "requests": 231,
              "total_cost_usd": 54.14,
              "last_active": "2026-06-05T09:12:04.230Z"
            }
          ],
          "current_machine": "apple06"
        }
      }
      """, request: request)
    }

    let client = APIClient(baseURL: "https://economy.test/", session: makeSession())
    let fleet = try await client.fetchFleet(period: "today")

    XCTAssertEqual(fleet.summary.sessions, 7)
    XCTAssertEqual(fleet.machines.count, 2)
    XCTAssertEqual(fleet.machines[0].machine_id, "spark02")
    XCTAssertEqual(fleet.machines[0].sessions, 6)
    XCTAssertEqual(fleet.machines[0].requests, 356)
    XCTAssertEqual(fleet.current_machine, "apple06")

    let requestURL = try XCTUnwrap(capturedRequest?.url)
    XCTAssertEqual(requestURL.path, "/api/fleet")
    XCTAssertEqual(URLComponents(url: requestURL, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "period" })?.value, "today")
  }

  func testFetchHourlyDecodesRowsAndEncodesMachineFilter() async throws {
    var capturedRequest: URLRequest?
    MockURLProtocol.handler = { request in
      capturedRequest = request
      return ok("""
      {
        "data": [
          {
            "hour": "09",
            "agent": "codex",
            "cost_usd": 4.25
          },
          {
            "hour": "10",
            "agent": "claude",
            "cost_usd": 2.5
          }
        ]
      }
      """, request: request)
    }

    let client = APIClient(baseURL: "https://economy.test/", session: makeSession())
    let hourly = try await client.fetchHourly(machine: "apple06")

    XCTAssertEqual(hourly.count, 2)
    XCTAssertEqual(hourly[0].hour, "09")
    XCTAssertEqual(hourly[0].agent, "codex")
    XCTAssertEqual(hourly[0].cost_usd, 4.25)

    let requestURL = try XCTUnwrap(capturedRequest?.url)
    XCTAssertEqual(requestURL.path, "/api/hourly")
    XCTAssertEqual(URLComponents(url: requestURL, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "hours" })?.value, "12")
    XCTAssertEqual(URLComponents(url: requestURL, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "machine" })?.value, "apple06")
  }

  func testMachineFilteredFetchesEncodeMachineQueryItems() async throws {
    var capturedPaths: [String] = []
    MockURLProtocol.handler = { request in
      capturedPaths.append(self.pathWithQuery(request))

      switch request.url?.path {
      case "/api/summary":
        return ok(#"{"data":{"total_usd":1,"sessions":1,"requests":1,"tokens":150}}"#, request: request)
      case "/api/daily":
        return ok(#"{"data":[]}"#, request: request)
      case "/api/hourly":
        return ok(#"{"data":[]}"#, request: request)
      case "/api/projects":
        return ok(#"{"data":[]}"#, request: request)
      case "/api/breakdown":
        return ok(#"{"data":[]}"#, request: request)
      case "/api/accounts":
        return ok(#"{"data":[]}"#, request: request)
      case "/api/fleet":
        return ok(#"{"data":{"summary":{"total_usd":1,"sessions":1,"requests":1,"tokens":150},"machines":[],"current_machine":"apple06"}}"#, request: request)
      case "/api/sessions":
        return ok(#"{"data":[]}"#, request: request)
      default:
        return response(#"{"error":"unexpected path"}"#, request: request, status: 404)
      }
    }

    let client = APIClient(baseURL: "https://economy.test/", session: makeSession())

    _ = try await client.fetchSummary(period: "today", machine: "apple06")
    _ = try await client.fetchDaily(days: 7, machine: "apple06")
    _ = try await client.fetchHourly(machine: "apple06")
    _ = try await client.fetchProjects(period: "week", machine: "apple06")
    _ = try await client.fetchAgents(period: "week", machine: "apple06")
    _ = try await client.fetchAccounts(period: "month", machine: "apple06")
    _ = try await client.fetchFleet(period: "today", machine: "apple06")
    _ = try await client.fetchSessions(search: " open economy ", limit: 5, machine: "apple06")

    XCTAssertEqual(capturedPaths, [
      "/api/summary?period=today&machine=apple06",
      "/api/daily?days=7&machine=apple06",
      "/api/hourly?hours=12&machine=apple06",
      "/api/projects?period=week&machine=apple06",
      "/api/breakdown?by=agent&period=week&machine=apple06",
      "/api/accounts?period=month&machine=apple06",
      "/api/fleet?period=today&machine=apple06",
      "/api/sessions?limit=5&search=open%20economy&machine=apple06",
    ])
  }

  func testIsOnlineRequiresSuccessfulHTTPStatus() async {
    let client = APIClient(baseURL: "http://economy.test", session: makeSession())

    MockURLProtocol.handler = { request in
      ok(#"{"data":{"status":"ok"}}"#, request: request)
    }
    XCTAssertTrue(await client.isOnline())

    MockURLProtocol.handler = { request in
      response(#"{"error":"unavailable"}"#, request: request, status: 503)
    }
    XCTAssertFalse(await client.isOnline())
  }

  func testInvalidBaseURLReportsOfflineInsteadOfCrashing() async {
    MockURLProtocol.handler = { _ in
      XCTFail("Invalid URLs should not start a network request")
      throw APIError.offline
    }

    let client = APIClient(baseURL: "http://%", session: makeSession())

    XCTAssertFalse(await client.isOnline())

    var sawOffline = false
    do {
      _ = try await client.fetchSummary(period: "today")
    } catch APIError.offline {
      sawOffline = true
    } catch {
      sawOffline = false
    }
    XCTAssertTrue(sawOffline)
  }

  func testServerStatusThrowsServerError() async throws {
    MockURLProtocol.handler = { request in
      response(#"{"data":{}}"#, request: request, status: 503)
    }

    let client = APIClient(baseURL: "http://economy.test", session: makeSession())

    var sawServerError = false
    do {
      _ = try await client.fetchSummary(period: "today")
    } catch APIError.serverError(let statusCode) {
      XCTAssertEqual(statusCode, 503)
      sawServerError = true
    } catch {
      sawServerError = false
    }
    XCTAssertTrue(sawServerError)
  }

  func testModelDisplayFallbacks() {
    let namedProject = ProjectStat(
      project_path: "/workspace/hasna/open-economy",
      project_name: "Economy",
      sessions: 3,
      requests: 7,
      total_tokens: 99_000,
      cost_usd: 12.5,
      last_active: nil
    )
    XCTAssertEqual(namedProject.displayName, "Economy")

    let pathProject = ProjectStat(
      project_path: "/workspace/hasna/open-economy",
      project_name: nil,
      sessions: 3,
      requests: 7,
      total_tokens: 99_000,
      cost_usd: 12.5,
      last_active: nil
    )
    XCTAssertEqual(pathProject.displayName, "open-economy")

    let session = SessionStat(
      id: "session-abcdef1234567890",
      agent: "claude",
      project_path: "/workspace/hasna/open-economy",
      project_name: nil,
      total_cost_usd: 4.2,
      total_tokens: 99_000,
      request_count: 7,
      started_at: "not-a-date",
      ended_at: nil
    )
    XCTAssertEqual(session.displayProject, "open-economy")
    XCTAssertEqual(session.shortId, "session-abcd")
    XCTAssertEqual(session.startedAtLabel, "not-a-date")
  }

  private func pathWithQuery(_ request: URLRequest) -> String {
    guard
      let url = request.url,
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    else { return "" }

    if let query = components.percentEncodedQuery, !query.isEmpty {
      return "\(components.path)?\(query)"
    }

    return components.path
  }

  private func makeSession() -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [MockURLProtocol.self]
    return URLSession(configuration: configuration)
  }

  private func ok(_ body: String, request: URLRequest) -> (HTTPURLResponse, Data) {
    response(body, request: request, status: 200)
  }

  private func response(_ body: String, request: URLRequest, status: Int) -> (HTTPURLResponse, Data) {
    let response = HTTPURLResponse(
      url: request.url!,
      statusCode: status,
      httpVersion: nil,
      headerFields: ["Content-Type": "application/json"]
    )!
    return (response, Data(body.utf8))
  }
}

final class MockURLProtocol: URLProtocol {
  nonisolated(unsafe) static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

  override class func canInit(with request: URLRequest) -> Bool {
    true
  }

  override class func canonicalRequest(for request: URLRequest) -> URLRequest {
    request
  }

  override func startLoading() {
    guard let handler = Self.handler else {
      client?.urlProtocol(self, didFailWithError: APIError.offline)
      return
    }

    do {
      let (response, data) = try handler(request)
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: data)
      client?.urlProtocolDidFinishLoading(self)
    } catch {
      client?.urlProtocol(self, didFailWithError: error)
    }
  }

  override func stopLoading() {}
}
