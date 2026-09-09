import Foundation
import NotesLib

final class NotesLibTests: @unchecked Sendable {
    struct Fixture: Decodable { let note: Note; let largeSequence: String }

    private func fixture() throws -> Fixture {
        let url = try unwrap(Bundle.module.url(forResource: "wire-v1", withExtension: "json", subdirectory: "Fixtures"))
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }
    private func client(path: String = "api/v1", maximum: Int = 8 * 1024 * 1024, timeout: TimeInterval = 30) throws -> NotesClient {
        guard let base = ProcessInfo.processInfo.environment["NOTES_FIXTURE_URL"], let url = URL(string: "\(base)/\(path)/") else {
            throw ConformanceFailure(message: "NOTES_FIXTURE_URL is required: use scripts/test-swift-sdk.sh")
        }
        return try NotesClient(apiBase: url, allowHTTPLoopback: true, timeout: timeout, maximumResponseBytes: maximum) { "fixture-credential" }
    }

    func testSharedFixtureRoundTrip() throws {
        let fixture = try fixture()
        let note = fixture.note
        expectEqual(note.title, "Café ideas 📝")
        expectTrue(note.bodyMarkdown.contains("- [ ] 日本語\n"))
        expectEqual(note.folder, "historical/folder")
        expectEqual(note.revision, 7)
        expectEqual(note.updatedAt, "2026-09-02T11:21:31Z")
        expectEqual(fixture.largeSequence, "9007199254740993")
        expectEqual(try JSONDecoder().decode(Note.self, from: JSONEncoder().encode(note)), note)
    }

    func testAuthorityValidation() throws {
        for value in ["http://notes.example.com/v1", "https://user:pass@notes.example.com/v1", "https://notes.example.com/v1?key=x", "https://notes.example.com/v1#x"] {
            try expectThrows(try NotesClient(apiBase: unwrap(URL(string: value))) { "fixture-credential" })
        }
        let sdk = try NotesClient(apiBase: unwrap(URL(string: "https://notes.example.com/api/v1"))) { "fixture-credential" }
        expectEqual(sdk.apiBase.absoluteString, "https://notes.example.com/api/v1/")
    }

    func testPartialMutationPreservesMarkdownAndNull() throws {
        var input = NoteInput(title: "", bodyMarkdown: try fixture().note.bodyMarkdown, baseRevision: 7)
        input.folder = .null
        let json = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(input)).object
        expectEqual(json?["folder"], .null)
        expectEqual(json?["baseRevision"], .integer(7))
        expectEqual(json?["title"], .string(""))
        expectNil(json?["archived"])
    }

    func testActualHTTPBothBasesAndPagination() async throws {
        for path in ["api/v1", "v1"] {
            let sdk = try client(path: path)
            let page = try await sdk.list(limit: 200, label: "日本語", search: "tea & coffee")
            expectEqual(page.data.first, try fixture().note)
            expectEqual(page.nextCursor, "next-page")
            expectTrue(page.hasMore)
            let last = try await sdk.list(cursor: page.nextCursor)
            expectTrue(last.data.isEmpty)
            expectFalse(last.hasMore)
            let changes = try await sdk.changes()
            expectEqual(changes.changes.first?.sequence, "9007199254740993")
            expectEqual(changes.cursor, "changes-v1.fixture")
        }
    }

    func testActualHTTPMutationsAndConflict() async throws {
        let sdk = try client()
        let note = try fixture().note
        let created = try await sdk.create(NoteInput(bodyMarkdown: note.bodyMarkdown), idempotencyKey: "create:fixture-1")
        expectEqual(created.bodyMarkdown, note.bodyMarkdown)
        let updated = try await sdk.update(note.id, input: NoteInput(title: "Updated", baseRevision: 7), idempotencyKey: "update:fixture-1")
        expectEqual(updated.title, "Updated")
        do {
            _ = try await sdk.update(note.id, input: NoteInput(title: "Stale", baseRevision: 1))
            fail("A stale revision must fail")
        } catch let error as NotesAPIError {
            expectEqual(error.status, 409)
            expectEqual(error.code, "revision_conflict")
            expectEqual(error.currentNote, note)
            expectFalse(error.message.contains("fixture-credential"))
        }
        let deletion = try await sdk.delete(note.id, baseRevision: 7)
        expectTrue(deletion.deleted)
        let restored = try await sdk.restore(note.id, baseRevision: 8)
        expectFalse(restored.isDeleted)
        let labels = try await sdk.labels()
        expectEqual(labels.data.first?.name, "ideas")
        let renamed = try await sdk.renameLabel("ideas/old", to: "New")
        expectEqual(renamed.updated, 1)
        let removed = try await sdk.deleteLabel("日本語")
        expectEqual(removed.updated, 1)
        let export = try await sdk.export()
        expectEqual(export.notes.first, note)
    }

    func testActualHTTPRedirectAuthAndBounds() async throws {
        let sdk = try client()
        for (id, code) in [("redirect", "redirect_rejected"), ("unauthorized", "unauthorized"), ("forbidden", "forbidden"), ("invalid-json", "invalid_json")] {
            do { _ = try await sdk.get(id); fail("Expected \(code)") }
            catch let error as NotesAPIError { expectEqual(error.code, code); expectFalse(error.message.contains("fixture-credential")) }
        }
        do { _ = try await client(maximum: 100).get("oversized"); fail("Expected bounded response") }
        catch let error as NotesAPIError { expectEqual(error.code, "response_too_large") }
    }

    func testActualHTTPCancellationAndTimeout() async throws {
        let sdk = try client()
        let request = Task { try await sdk.get("slow") }
        try await Task.sleep(for: .milliseconds(30))
        request.cancel()
        do { _ = try await request.value; fail("Expected cancellation") }
        catch is CancellationError {}
        do { _ = try await client(timeout: 0.05).get("slow"); fail("Expected timeout") }
        catch let error as NotesAPIError { expectEqual(error.code, "timeout") }
    }

    func testMissingCredentialNeverUsesAmbientAuthority() async throws {
        let sdk = try NotesClient(apiBase: unwrap(URL(string: "https://notes.example.com/v1"))) { nil }
        do { _ = try await sdk.list(); fail("Expected missing credential") }
        catch let error as NotesAPIError { expectEqual(error.code, "missing_credential") }
        let failed = try NotesClient(apiBase: unwrap(URL(string: "https://notes.example.com/v1"))) {
            throw NotesAPIError("missing_credential", "Reflected fixture-credential")
        }
        do { _ = try await failed.list(); fail("Expected provider refusal") }
        catch let error as NotesAPIError { expectEqual(error.code, "missing_credential"); expectFalse(error.message.contains("fixture-credential")) }
    }
}


struct ConformanceFailure: Error { let message: String }
func fail(_ message: String) -> Never { fatalError(message) }
func expectEqual<T: Equatable>(_ left: T, _ right: T) { if left != right { fail("Values differ") } }
func expectTrue(_ value: Bool) { if !value { fail("Expected true") } }
func expectFalse(_ value: Bool) { if value { fail("Expected false") } }
func expectNil<T>(_ value: T?) { if value != nil { fail("Expected nil") } }
func unwrap<T>(_ value: T?) throws -> T { guard let value else { throw ConformanceFailure(message: "Required value missing") }; return value }
func expectThrows<T>(_ expression: @autoclosure () throws -> T) throws {
    do { _ = try expression() } catch { return }
    throw ConformanceFailure(message: "Expected an error")
}

@main struct Conformance {
    static func main() async throws {
        let checks = NotesLibTests()
        try checks.testSharedFixtureRoundTrip()
        try checks.testAuthorityValidation()
        try checks.testPartialMutationPreservesMarkdownAndNull()
        try await checks.testActualHTTPBothBasesAndPagination()
        try await checks.testActualHTTPMutationsAndConflict()
        try await checks.testActualHTTPRedirectAuthAndBounds()
        try await checks.testActualHTTPCancellationAndTimeout()
        try await checks.testMissingCredentialNeverUsesAmbientAuthority()
        print("NotesLib: 8 conformance groups passed against real HTTP")
    }
}
