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

  func testFetchSessionsEncodesSearchAndDecodesWrappedResponse() async throws {
    var capturedRequest: URLRequest?
    MockURLProtocol.handler = { request in
      capturedRequest = request
      let response = HTTPURLResponse(
        url: request.url!,
        statusCode: 200,
        httpVersion: nil,
        headerFields: ["Content-Type": "application/json"]
      )!
      let data = Data("""
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
      """.utf8)
      return (response, data)
    }

    let client = APIClient(baseURL: "https://economy.test/", session: makeSession())
    let sessions = try await client.fetchSessions(search: " codex project ", limit: 10)

    XCTAssertEqual(sessions.count, 1)
    XCTAssertEqual(sessions[0].agent, "codex")
    XCTAssertEqual(sessions[0].displayProject, "open-economy")

    let components = try XCTUnwrap(URLComponents(url: try XCTUnwrap(capturedRequest?.url), resolvingAgainstBaseURL: false))
    XCTAssertEqual(components.scheme, "https")
    XCTAssertEqual(components.host, "economy.test")
    XCTAssertEqual(components.path, "/api/sessions")
    XCTAssertEqual(components.queryItems?.first(where: { $0.name == "limit" })?.value, "10")
    XCTAssertEqual(components.queryItems?.first(where: { $0.name == "search" })?.value, "codex project")
  }

  func testServerStatusThrowsServerError() async throws {
    MockURLProtocol.handler = { request in
      let response = HTTPURLResponse(
        url: request.url!,
        statusCode: 503,
        httpVersion: nil,
        headerFields: ["Content-Type": "application/json"]
      )!
      return (response, Data(#"{"data":{}}"#.utf8))
    }

    let client = APIClient(baseURL: "http://economy.test", session: makeSession())

    do {
      _ = try await client.fetchSummary(period: "today")
      XCTFail("Expected serverError")
    } catch APIError.serverError(let statusCode) {
      XCTAssertEqual(statusCode, 503)
    } catch {
      XCTFail("Unexpected error: \(error)")
    }
  }

  func testModelDisplayFallbacks() {
    let namedProject = ProjectStat(
      project_path: "/workspace/hasna/open-economy",
      project_name: "Economy",
      sessions: 3,
      cost_usd: 12.5,
      last_active: nil
    )
    XCTAssertEqual(namedProject.displayName, "Economy")

    let pathProject = ProjectStat(
      project_path: "/workspace/hasna/open-economy",
      project_name: nil,
      sessions: 3,
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

  private func makeSession() -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [MockURLProtocol.self]
    return URLSession(configuration: configuration)
  }
}

final class MockURLProtocol: URLProtocol {
  static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

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
