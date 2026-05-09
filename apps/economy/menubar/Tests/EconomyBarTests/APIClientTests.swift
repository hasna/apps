import Foundation
import Testing
@testable import EconomyBar

@Suite(.serialized)
struct APIClientTests {
  @Test func normalizeBaseURL() {
    #expect(APIClient.normalizeBaseURL(" economy.local:3456/ ") == "http://economy.local:3456")
    #expect(APIClient.normalizeBaseURL("https://economy.local/api/") == "https://economy.local/api")
    #expect(APIClient.normalizeBaseURL("   ") == APIClient.defaultBaseURL)
  }

  @Test func setBaseURLNormalizesAndPersists() async {
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

    #expect(normalized == "http://economy.test:4567")
    #expect(APIClient.storedBaseURL() == "http://economy.test:4567")
  }

  @Test func fetchSessionsEncodesSearchAndDecodesWrappedResponse() async throws {
    defer { MockURLProtocol.handler = nil }
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

    #expect(sessions.count == 1)
    #expect(sessions[0].agent == "codex")
    #expect(sessions[0].displayProject == "open-economy")

    let requestURL = try #require(capturedRequest?.url)
    let components = try #require(URLComponents(url: requestURL, resolvingAgainstBaseURL: false))
    #expect(components.scheme == "https")
    #expect(components.host == "economy.test")
    #expect(components.path == "/api/sessions")
    #expect(components.queryItems?.first(where: { $0.name == "limit" })?.value == "10")
    #expect(components.queryItems?.first(where: { $0.name == "search" })?.value == "codex project")
  }

  @Test func isOnlineRequiresSuccessfulHTTPStatus() async {
    defer { MockURLProtocol.handler = nil }
    let client = APIClient(baseURL: "http://economy.test", session: makeSession())

    MockURLProtocol.handler = { request in
      let response = HTTPURLResponse(
        url: request.url!,
        statusCode: 200,
        httpVersion: nil,
        headerFields: ["Content-Type": "application/json"]
      )!
      return (response, Data(#"{"data":{"status":"ok"}}"#.utf8))
    }
    #expect(await client.isOnline())

    MockURLProtocol.handler = { request in
      let response = HTTPURLResponse(
        url: request.url!,
        statusCode: 503,
        httpVersion: nil,
        headerFields: ["Content-Type": "application/json"]
      )!
      return (response, Data(#"{"error":"unavailable"}"#.utf8))
    }
    #expect(await client.isOnline() == false)
  }

  @Test func invalidBaseURLReportsOfflineInsteadOfCrashing() async {
    defer { MockURLProtocol.handler = nil }
    MockURLProtocol.handler = { _ in
      Issue.record("Invalid URLs should not start a network request")
      throw APIError.offline
    }

    let client = APIClient(baseURL: "http://%", session: makeSession())

    #expect(await client.isOnline() == false)

    var sawOffline = false
    do {
      _ = try await client.fetchSummary(period: "today")
    } catch APIError.offline {
      sawOffline = true
    } catch {
      sawOffline = false
    }
    #expect(sawOffline)
  }

  @Test func serverStatusThrowsServerError() async throws {
    defer { MockURLProtocol.handler = nil }
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

    var sawServerError = false
    do {
      _ = try await client.fetchSummary(period: "today")
    } catch APIError.serverError(let statusCode) {
      #expect(statusCode == 503)
      sawServerError = true
    } catch {
      sawServerError = false
    }
    #expect(sawServerError)
  }

  @Test func modelDisplayFallbacks() {
    let namedProject = ProjectStat(
      project_path: "/workspace/hasna/open-economy",
      project_name: "Economy",
      sessions: 3,
      cost_usd: 12.5,
      last_active: nil
    )
    #expect(namedProject.displayName == "Economy")

    let pathProject = ProjectStat(
      project_path: "/workspace/hasna/open-economy",
      project_name: nil,
      sessions: 3,
      cost_usd: 12.5,
      last_active: nil
    )
    #expect(pathProject.displayName == "open-economy")

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
    #expect(session.displayProject == "open-economy")
    #expect(session.shortId == "session-abcd")
    #expect(session.startedAtLabel == "not-a-date")
  }

  private func makeSession() -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [MockURLProtocol.self]
    return URLSession(configuration: configuration)
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
