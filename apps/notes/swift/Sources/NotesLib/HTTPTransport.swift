import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// One bounded transfer owns one ephemeral session. NSLock protects callbacks
// and cancellation, which URLSession may deliver on different queues.
final class HTTPTransfer: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<(Data, Int), any Error>?
    private var task: URLSessionDataTask?
    private var session: URLSession?
    private var data = Data()
    private var status = 0
    private var finished = false
    private var cancelled = false
    private var maximum: Int

    init(maximum: Int) { self.maximum = maximum }

    func run(_ request: URLRequest) async throws -> (Data, Int) {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                lock.lock()
                if cancelled {
                    lock.unlock()
                    continuation.resume(throwing: CancellationError())
                    return
                }
                self.continuation = continuation
                let configuration = URLSessionConfiguration.ephemeral
                configuration.httpCookieStorage = nil
                configuration.urlCredentialStorage = nil
                configuration.urlCache = nil
                configuration.timeoutIntervalForResource = request.timeoutInterval
                let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
                self.session = session
                let task = session.dataTask(with: request)
                self.task = task
                lock.unlock()
                task.resume()
            }
        } onCancel: { self.cancel() }
    }

    private func cancel() {
        lock.lock(); cancelled = true; lock.unlock()
        finish(.failure(CancellationError()))
    }

    private func finish(_ result: Result<(Data, Int), any Error>) {
        lock.lock()
        guard !finished, let continuation else { lock.unlock(); return }
        finished = true
        self.continuation = nil
        let task = task, session = session
        self.task = nil; self.session = nil
        lock.unlock()
        task?.cancel()
        session?.invalidateAndCancel()
        continuation.resume(with: result)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
        finish(.failure(NotesAPIError("redirect_rejected", "An authenticated Notes redirect was refused.", status: response.statusCode)))
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void) {
        guard let response = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            finish(.failure(NotesAPIError("invalid_response", "Notes returned an invalid response.")))
            return
        }
        let status = response.statusCode
        lock.lock()
        self.status = status
        if !(200..<300).contains(status) { maximum = min(maximum, 128 * 1024) }
        let maximum = maximum
        lock.unlock()
        if status == 401 || status == 403 {
            completionHandler(.cancel)
            finish(.failure(NotesAPIError(status == 401 ? "unauthorized" : "forbidden", status == 401 ? "Sign in again to access Notes." : "This account cannot perform that action.", status: status)))
        } else if (300..<400).contains(status) {
            completionHandler(.cancel)
            finish(.failure(NotesAPIError("redirect_rejected", "An authenticated Notes redirect was refused.", status: status)))
        } else if response.expectedContentLength > Int64(maximum) {
            completionHandler(.cancel)
            finish(.failure(NotesAPIError("response_too_large", "Notes API response exceeds the client limit.", status: status)))
        } else { completionHandler(.allow) }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
        lock.lock()
        let exceeds = chunk.count > maximum - data.count
        if !exceeds && !finished { data.append(chunk) }
        let status = status
        lock.unlock()
        if exceeds { finish(.failure(NotesAPIError("response_too_large", "Notes API response exceeds the client limit.", status: status))) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
        lock.lock(); let bytes = data, status = status; lock.unlock()
        if let error {
            let timedOut = (error as? URLError)?.code == .timedOut
            finish(.failure(NotesAPIError(timedOut ? "timeout" : "network_error", timedOut ? "Notes request timed out." : "Cannot reach Notes. Your changes have not been confirmed.")))
        } else { finish(.success((bytes, status))) }
    }
}
