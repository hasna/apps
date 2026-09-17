@preconcurrency import AVFoundation
import Foundation

enum NativePCMRecorderError: LocalizedError {
    case alreadyActive
    case noInputDevice
    case unsupportedInputFormat
    case failedToCreateConverter
    case failedToStart(String)

    var errorDescription: String? {
        switch self {
        case .alreadyActive:
            return "Microphone capture is already starting, running, or stopping"
        case .noInputDevice:
            return "No microphone input device is available"
        case .unsupportedInputFormat:
            return "The selected microphone format is not supported"
        case .failedToCreateConverter:
            return "Could not prepare microphone audio conversion"
        case .failedToStart(let message):
            return "Could not start microphone capture: \(message)"
        }
    }
}

final class NativePCMRecorder: @unchecked Sendable {
    private enum LifecycleState: Equatable {
        case idle
        case starting
        case running
        case stopping
    }

    private let engine = AVAudioEngine()
    private let onPCM: @Sendable (Data) -> Void
    private let lifecycle = NSCondition()
    private let conversionLock = NSLock()
    private let deliveryQueue = DispatchQueue(label: "com.hasna.recordings.native-pcm-delivery")
    private let deliveryQueueKey = DispatchSpecificKey<UInt8>()
    private let stopWorkQueue = DispatchQueue(label: "com.hasna.recordings.native-pcm-stop")
    private let stopCaptureForTesting: (@Sendable () -> Void)?
    private let startCaptureForTesting: (@Sendable () throws -> Void)?
    private let onCallbackAdmittedForTesting: (@Sendable () -> Void)?
    private let finalizeConverter: @Sendable (AVAudioConverter, AVAudioFormat) -> [Data]
    private let diagnostics: NativePCMRecorderDiagnosticsCollector
    private let tapFormatSelection: NativePCMRecorderTapFormatSelection
    private var converter: AVAudioConverter?
    private var inputFormat: AVAudioFormat?
    private var outputFormat: AVAudioFormat?
    private var configurationObserver: NSObjectProtocol?
    private var state = LifecycleState.idle
    private var acceptingCallbacks = false
    private var inFlightCallbacks = 0

    init(
        onPCM: @escaping @Sendable (Data) -> Void,
        diagnostics: NativePCMRecorderDiagnosticsConfiguration = .disabled,
        tapFormatSelection: NativePCMRecorderTapFormatSelection = .inputScope
    ) {
        self.onPCM = onPCM
        self.stopCaptureForTesting = nil
        self.startCaptureForTesting = nil
        self.onCallbackAdmittedForTesting = nil
        self.finalizeConverter = Self.finalizeConverterTail
        self.tapFormatSelection = tapFormatSelection
        self.diagnostics = NativePCMRecorderDiagnosticsCollector(
            configuration: diagnostics,
            tapFormatSelection: tapFormatSelection
        )
        deliveryQueue.setSpecific(key: deliveryQueueKey, value: 1)
    }

    init(
        testingInputFormat: AVAudioFormat,
        outputFormat: AVAudioFormat,
        converter: AVAudioConverter,
        stopCapture: @escaping @Sendable () -> Void,
        startCapture: (@Sendable () throws -> Void)? = nil,
        onCallbackAdmitted: @escaping @Sendable () -> Void,
        finalizeConverter: @escaping @Sendable (AVAudioConverter, AVAudioFormat) -> [Data],
        startsRunning: Bool = true,
        onPCM: @escaping @Sendable (Data) -> Void,
        diagnostics: NativePCMRecorderDiagnosticsConfiguration = .disabled,
        tapFormatSelection: NativePCMRecorderTapFormatSelection = .inputScope
    ) {
        self.onPCM = onPCM
        self.stopCaptureForTesting = stopCapture
        self.startCaptureForTesting = startCapture
        self.onCallbackAdmittedForTesting = onCallbackAdmitted
        self.finalizeConverter = finalizeConverter
        self.converter = converter
        Self.configureConverter(converter, forInput: testingInputFormat)
        self.inputFormat = testingInputFormat
        self.outputFormat = outputFormat
        self.tapFormatSelection = tapFormatSelection
        self.diagnostics = NativePCMRecorderDiagnosticsCollector(
            configuration: diagnostics,
            tapFormatSelection: tapFormatSelection
        )
        self.state = startsRunning ? .running : .idle
        self.acceptingCallbacks = startsRunning
        deliveryQueue.setSpecific(key: deliveryQueueKey, value: 1)
    }

    func start() throws {
        try reserveStart()

        if let startCaptureForTesting {
            do {
                try startCaptureForTesting()
                diagnostics.recordEngineStart(succeeded: true, running: engine.isRunning)
                finishStart()
            } catch {
                diagnostics.recordEngineStart(succeeded: false, running: engine.isRunning)
                diagnostics.finish(engineRunning: engine.isRunning)
                resetAfterStartFailure()
                throw NativePCMRecorderError.failedToStart(error.localizedDescription)
            }
            return
        }

        let inputNode = engine.inputNode
        let inputScopeFormat = inputNode.inputFormat(forBus: 0)
        let outputScopeFormat = inputNode.outputFormat(forBus: 0)
        let tapFormat: AVAudioFormat
        switch tapFormatSelection {
        case .inputScope:
            tapFormat = inputScopeFormat
        case .outputScope:
            tapFormat = outputScopeFormat
        }
        diagnostics.recordStart(
            inputScopeFormat: inputScopeFormat,
            outputScopeFormat: outputScopeFormat,
            tapFormat: tapFormat
        )
        guard inputScopeFormat.channelCount > 0 else {
            try failStart(.noInputDevice)
        }
        guard inputScopeFormat.sampleRate > 0, tapFormat.channelCount > 0, tapFormat.sampleRate > 0 else {
            try failStart(.unsupportedInputFormat)
        }
        guard let outputFormat = Self.realtimeOutputFormat() else {
            try failStart(.unsupportedInputFormat)
        }
        guard let converter = AVAudioConverter(from: tapFormat, to: outputFormat) else {
            try failStart(.failedToCreateConverter)
        }
        Self.configureConverter(converter, forInput: tapFormat)

        lifecycle.lock()
        self.converter = converter
        self.inputFormat = tapFormat
        self.outputFormat = outputFormat
        lifecycle.unlock()

        inputNode.installTap(onBus: 0, bufferSize: 1_024, format: tapFormat) { [weak self] buffer, _ in
            self?.processInputBuffer(buffer)
        }
        installConfigurationObserver()

        do {
            // These two calls are the ~520 ms a cold start costs, and they are why a short tap
            // cannot capture anything: `RecordingEngine` only reports a live capture once the
            // tap above delivers its first buffer, ~100 ms after `start()` returns.
            //
            // Pre-warming (holding a started engine between recordings, or hoisting
            // `prepare()` to app launch) is the only way to make a sub-500 ms press record.
            // It is deliberately NOT done here: a running engine with an installed input tap
            // holds the input device open, which lights the macOS microphone-in-use indicator
            // and lists the app under Control Center's microphone recents for as long as it
            // runs. A permanently lit indicator is a worse regression than the bug. Whether
            // `prepare()` alone — resource allocation without starting the IO thread — both
            // absorbs a useful share of the 520 ms and leaves the indicator dark has to be
            // measured on real hardware before anyone acts on it.
            engine.prepare()
            try engine.start()
            diagnostics.recordEngineStart(succeeded: true, running: engine.isRunning)
            finishStart()
        } catch {
            inputNode.removeTap(onBus: 0)
            removeConfigurationObserver()
            diagnostics.recordEngineStart(succeeded: false, running: engine.isRunning)
            diagnostics.finish(engineRunning: engine.isRunning)
            resetAfterStartFailure()
            throw NativePCMRecorderError.failedToStart(error.localizedDescription)
        }
    }

    private func reserveStart() throws {
        lifecycle.lock()
        guard state == .idle else {
            lifecycle.unlock()
            throw NativePCMRecorderError.alreadyActive
        }
        state = .starting
        lifecycle.unlock()
    }

    private func finishStart() {
        lifecycle.lock()
        acceptingCallbacks = true
        state = .running
        lifecycle.broadcast()
        lifecycle.unlock()
    }

    private func failStart(_ error: NativePCMRecorderError) throws -> Never {
        diagnostics.recordEngineStart(succeeded: false, running: engine.isRunning)
        diagnostics.finish(engineRunning: engine.isRunning)
        abandonStart()
        throw error
    }

    private func installConfigurationObserver() {
        guard diagnostics.isEnabled else { return }
        configurationObserver = NotificationCenter.default.addObserver(
            forName: Notification.Name.AVAudioEngineConfigurationChange,
            object: engine,
            queue: nil
        ) { [weak self] _ in
            self?.diagnostics.recordConfigurationChange(engineRunning: self?.engine.isRunning ?? false)
        }
    }

    private func removeConfigurationObserver() {
        if let configurationObserver {
            NotificationCenter.default.removeObserver(configurationObserver)
            self.configurationObserver = nil
        }
    }

    private func resetAfterStartFailure() {
        lifecycle.lock()
        converter = nil
        inputFormat = nil
        outputFormat = nil
        state = .idle
        acceptingCallbacks = false
        lifecycle.broadcast()
        lifecycle.unlock()
    }

    func stop() {
        let isReentrantDelivery = DispatchQueue.getSpecific(key: deliveryQueueKey) != nil
        lifecycle.lock()
        while state == .starting || (state == .stopping && !isReentrantDelivery) {
            lifecycle.wait()
        }
        guard state == .running else {
            lifecycle.unlock()
            return
        }
        acceptingCallbacks = false
        state = .stopping
        lifecycle.unlock()

        if isReentrantDelivery {
            stopWorkQueue.async { [self] in
                stopCaptureAndFinish()
            }
        } else {
            stopCaptureAndFinish()
        }
    }

    private func stopCaptureAndFinish() {
        if let stopCaptureForTesting {
            stopCaptureForTesting()
        } else {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
            removeConfigurationObserver()
        }

        lifecycle.lock()
        while inFlightCallbacks > 0 {
            lifecycle.wait()
        }
        let converter = converter
        let outputFormat = outputFormat
        lifecycle.unlock()

        if let converter, let outputFormat {
            conversionLock.lock()
            let tailChunks = finalizeConverter(converter, outputFormat)
            conversionLock.unlock()
            for data in tailChunks where !data.isEmpty {
                diagnostics.recordConverted(data)
                deliverPCM(data)
            }
        }

        diagnostics.finish(engineRunning: engine.isRunning)

        lifecycle.lock()
        self.converter = nil
        inputFormat = nil
        self.outputFormat = nil
        state = .idle
        lifecycle.broadcast()
        lifecycle.unlock()
    }

    deinit {
        stop()
    }

    private func abandonStart() {
        lifecycle.lock()
        state = .idle
        acceptingCallbacks = false
        lifecycle.broadcast()
        lifecycle.unlock()
    }

    func processInputBufferForTesting(_ inputBuffer: AVAudioPCMBuffer) {
        processInputBuffer(inputBuffer)
    }

    func deliverPCMForTesting(_ data: Data) {
        lifecycle.lock()
        guard acceptingCallbacks else {
            lifecycle.unlock()
            return
        }
        inFlightCallbacks += 1
        lifecycle.unlock()

        defer { finishCallback() }
        deliverPCM(data)
    }

    var isIdleForTesting: Bool {
        lifecycle.lock()
        defer { lifecycle.unlock() }
        return state == .idle
    }

    private func processInputBuffer(_ inputBuffer: AVAudioPCMBuffer) {
        lifecycle.lock()
        guard acceptingCallbacks,
              let converter,
              let inputFormat,
              let outputFormat else {
            lifecycle.unlock()
            return
        }
        inFlightCallbacks += 1
        lifecycle.unlock()

        onCallbackAdmittedForTesting?()
        diagnostics.recordCallback(inputBuffer, expectedFormat: inputFormat)

        defer { finishCallback() }

        conversionLock.lock()
        let data = convert(
            inputBuffer,
            converter: converter,
            inputFormat: inputFormat,
            outputFormat: outputFormat
        )
        conversionLock.unlock()
        if !data.isEmpty {
            deliverPCM(data)
        }
    }

    private func deliverPCM(_ data: Data) {
        if DispatchQueue.getSpecific(key: deliveryQueueKey) != nil {
            onPCM(data)
        } else {
            deliveryQueue.sync {
                onPCM(data)
            }
        }
    }

    private func finishCallback() {
        lifecycle.lock()
        inFlightCallbacks -= 1
        if inFlightCallbacks == 0 {
            lifecycle.broadcast()
        }
        lifecycle.unlock()
    }

    private func convert(
        _ inputBuffer: AVAudioPCMBuffer,
        converter: AVAudioConverter,
        inputFormat: AVAudioFormat,
        outputFormat: AVAudioFormat
    ) -> Data {
        let sampleRateRatio = outputFormat.sampleRate / inputFormat.sampleRate
        let estimatedFrames = AVAudioFrameCount(Double(inputBuffer.frameLength) * sampleRateRatio) + 512
        guard let outputBuffer = AVAudioPCMBuffer(
            pcmFormat: outputFormat,
            frameCapacity: max(estimatedFrames, 1)
        ) else {
            diagnostics.recordConverted(Data())
            return Data()
        }

        let inputSource = AudioConverterInputSource(buffer: inputBuffer)
        var conversionError: NSError?
        let status = converter.convert(to: outputBuffer, error: &conversionError) { _, status in
            inputSource.next(status: status)
        }

        if let conversionError {
            diagnostics.recordConversionFailure(conversionError)
            return Data()
        }
        if status == .error {
            diagnostics.recordConversionFailure(nil)
            return Data()
        }
        let data = Self.extractPCM16Data(from: outputBuffer)
        diagnostics.recordConverted(data)
        return data
    }

    private static func configureConverter(
        _ converter: AVAudioConverter,
        forInput inputFormat: AVAudioFormat
    ) {
        // CoreAudio's default layout mapping silently emits zero PCM for 3+ channel
        // DiscreteInOrder/Unknown layouts when the destination is mono. The first input
        // channel is the only stable source with no speaker-role assumptions, so select it
        // explicitly. This preserves the tap buffer and avoids an unverified custom mix.
        guard inputFormat.channelCount > 2 else { return }
        converter.channelMap = [0]
    }

    static func finalizeConverterTail(_ converter: AVAudioConverter, outputFormat: AVAudioFormat) -> [Data] {
        var chunks: [Data] = []
        while let outputBuffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: 4_096) {
            var conversionError: NSError?
            let status = converter.convert(to: outputBuffer, error: &conversionError) { _, inputStatus in
                inputStatus.pointee = .endOfStream
                return nil
            }
            guard conversionError == nil else { break }
            let data = extractPCM16Data(from: outputBuffer)
            if !data.isEmpty {
                chunks.append(data)
            }
            switch status {
            case .haveData:
                guard !data.isEmpty else { return chunks }
            case .inputRanDry, .endOfStream, .error:
                return chunks
            @unknown default:
                return chunks
            }
        }
        return chunks
    }

    static func realtimeOutputFormat() -> AVAudioFormat? {
        AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: 24_000,
            channels: 1,
            interleaved: true
        )
    }

    static func extractPCM16Data(from buffer: AVAudioPCMBuffer) -> Data {
        var data = Data()
        for audioBuffer in UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList) {
            guard let bytes = audioBuffer.mData?.assumingMemoryBound(to: UInt8.self),
                  audioBuffer.mDataByteSize > 0 else {
                continue
            }
            data.append(bytes, count: Int(audioBuffer.mDataByteSize))
        }
        return data
    }
}

private final class AudioConverterInputSource: @unchecked Sendable {
    private let buffer: AVAudioPCMBuffer
    private let lock = NSLock()
    private var consumed = false

    init(buffer: AVAudioPCMBuffer) {
        self.buffer = buffer
    }

    func next(status: UnsafeMutablePointer<AVAudioConverterInputStatus>) -> AVAudioBuffer? {
        lock.lock()
        defer { lock.unlock() }

        if consumed {
            status.pointee = .noDataNow
            return nil
        }

        consumed = true
        status.pointee = .haveData
        return buffer
    }
}
