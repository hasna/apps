import AVFoundation
import Foundation

enum NativePCMRecorderTapFormatSelection: String, Sendable {
    case inputScope
    case outputScope
}

struct NativePCMRecorderFormatSummary: Equatable, Sendable {
    let sampleRateHz: Double
    let channelCount: Int
    let isInterleaved: Bool
    let commonFormat: UInt32

    var compactDescription: String {
        "rate_hz=\(sampleRateHz) channels=\(channelCount) interleaved=\(isInterleaved) common_format=\(commonFormat)"
    }
}

struct NativePCMRecorderSignalSummary: Equatable, Sendable {
    let bufferCount: Int
    let byteCount: Int
    let frameCount: Int
    let sampleCount: Int
    let nonzeroSampleCount: Int
    let peakAbs: Double
    let rms: Double

    static let empty = Self(
        bufferCount: 0,
        byteCount: 0,
        frameCount: 0,
        sampleCount: 0,
        nonzeroSampleCount: 0,
        peakAbs: 0,
        rms: 0
    )
}

struct NativePCMRecorderDiagnosticsSnapshot: Equatable, Sendable {
    let tapFormatSelection: NativePCMRecorderTapFormatSelection
    let inputScopeFormat: NativePCMRecorderFormatSummary?
    let outputScopeFormat: NativePCMRecorderFormatSummary?
    let tapFormat: NativePCMRecorderFormatSummary?
    let firstCallbackFormat: NativePCMRecorderFormatSummary?
    let lastCallbackFormat: NativePCMRecorderFormatSummary?
    let callbackFormatChangeCount: Int
    let callbackFormatMismatchCount: Int
    let raw: NativePCMRecorderSignalSummary
    let converted: NativePCMRecorderSignalSummary
    let conversionEmptyOutputCount: Int
    let conversionFailureCount: Int
    let lastConversionErrorCode: Int?
    let engineRunningAfterStart: Bool?
    let engineRunningAtStop: Bool
    let engineStartSucceeded: Bool?
    let configurationChangeCount: Int
    let configurationChangeRunningStates: [Bool]

    var compactDescription: String {
        func format(_ value: NativePCMRecorderFormatSummary?) -> String {
            value?.compactDescription ?? "unavailable"
        }
        func signal(_ value: NativePCMRecorderSignalSummary) -> String {
            "buffers=\(value.bufferCount) bytes=\(value.byteCount) frames=\(value.frameCount) samples=\(value.sampleCount) nonzero_samples=\(value.nonzeroSampleCount) peak=\(value.peakAbs) rms=\(value.rms)"
        }
        let runningAfterStart = engineRunningAfterStart.map(String.init) ?? "unavailable"
        let startSucceeded = engineStartSucceeded.map(String.init) ?? "unavailable"
        return [
            "tap=\(tapFormatSelection.rawValue)",
            "input_scope{\(format(inputScopeFormat))}",
            "output_scope{\(format(outputScopeFormat))}",
            "tap_format{\(format(tapFormat))}",
            "first_callback{\(format(firstCallbackFormat))}",
            "last_callback{\(format(lastCallbackFormat))}",
            "callback_format_changes=\(callbackFormatChangeCount)",
            "callback_format_mismatches=\(callbackFormatMismatchCount)",
            "raw{\(signal(raw))}",
            "converted{\(signal(converted))}",
            "conversion_empty=\(conversionEmptyOutputCount)",
            "conversion_failures=\(conversionFailureCount)",
            "last_conversion_error_code=\(lastConversionErrorCode.map(String.init) ?? "none")",
            "engine_start_succeeded=\(startSucceeded)",
            "engine_running_after_start=\(runningAfterStart)",
            "engine_running_at_stop=\(engineRunningAtStop)",
            "configuration_changes=\(configurationChangeCount)",
            "configuration_running_states=\(configurationChangeRunningStates.map(String.init).joined(separator: ","))",
        ].joined(separator: " ")
    }
}

struct NativePCMRecorderDiagnosticsConfiguration: Sendable {
    let enabled: Bool
    let sink: @Sendable (NativePCMRecorderDiagnosticsSnapshot) -> Void

    init(
        enabled: Bool,
        sink: @escaping @Sendable (NativePCMRecorderDiagnosticsSnapshot) -> Void
    ) {
        self.enabled = enabled
        self.sink = sink
    }

    static let disabled = Self(enabled: false, sink: { _ in })
}

final class NativePCMRecorderDiagnosticsCollector: @unchecked Sendable {
    private struct MutableSignalSummary {
        var bufferCount = 0
        var byteCount = 0
        var frameCount = 0
        var sampleCount = 0
        var nonzeroSampleCount = 0
        var peakAbs = 0.0
        var sumSquares = 0.0

        var snapshot: NativePCMRecorderSignalSummary {
            NativePCMRecorderSignalSummary(
                bufferCount: bufferCount,
                byteCount: byteCount,
                frameCount: frameCount,
                sampleCount: sampleCount,
                nonzeroSampleCount: nonzeroSampleCount,
                peakAbs: peakAbs,
                rms: sampleCount > 0 ? sqrt(sumSquares / Double(sampleCount)) : 0
            )
        }
    }

    private let configuration: NativePCMRecorderDiagnosticsConfiguration
    private let tapFormatSelection: NativePCMRecorderTapFormatSelection
    private let lock = NSLock()
    private var inputScopeFormat: NativePCMRecorderFormatSummary?
    private var outputScopeFormat: NativePCMRecorderFormatSummary?
    private var tapFormat: NativePCMRecorderFormatSummary?
    private var firstCallbackFormat: NativePCMRecorderFormatSummary?
    private var lastCallbackFormat: NativePCMRecorderFormatSummary?
    private var callbackFormatChangeCount = 0
    private var callbackFormatMismatchCount = 0
    private var raw = MutableSignalSummary()
    private var converted = MutableSignalSummary()
    private var conversionEmptyOutputCount = 0
    private var conversionFailureCount = 0
    private var lastConversionErrorCode: Int?
    private var engineRunningAfterStart: Bool?
    private var engineRunningAtStop = false
    private var engineStartSucceeded: Bool?
    private var configurationChangeCount = 0
    private var configurationChangeRunningStates: [Bool] = []
    private var didFinish = false

    init(
        configuration: NativePCMRecorderDiagnosticsConfiguration,
        tapFormatSelection: NativePCMRecorderTapFormatSelection
    ) {
        self.configuration = configuration
        self.tapFormatSelection = tapFormatSelection
    }

    var isEnabled: Bool { configuration.enabled }

    func recordStart(
        inputScopeFormat: AVAudioFormat,
        outputScopeFormat: AVAudioFormat,
        tapFormat: AVAudioFormat
    ) {
        guard configuration.enabled else { return }
        lock.withLock {
            self.inputScopeFormat = Self.summary(inputScopeFormat)
            self.outputScopeFormat = Self.summary(outputScopeFormat)
            self.tapFormat = Self.summary(tapFormat)
        }
    }

    func recordEngineStart(succeeded: Bool, running: Bool) {
        guard configuration.enabled else { return }
        lock.withLock {
            engineStartSucceeded = succeeded
            engineRunningAfterStart = running
        }
    }

    func recordCallback(_ buffer: AVAudioPCMBuffer, expectedFormat: AVAudioFormat) {
        guard configuration.enabled else { return }
        lock.withLock {
            let format = Self.summary(buffer.format)
            if firstCallbackFormat == nil {
                firstCallbackFormat = format
            } else if lastCallbackFormat != format {
                callbackFormatChangeCount += 1
            }
            lastCallbackFormat = format
            if format != Self.summary(expectedFormat) {
                callbackFormatMismatchCount += 1
            }
            Self.add(buffer: buffer, to: &raw)
        }
    }

    func recordConverted(_ data: Data) {
        guard configuration.enabled else { return }
        lock.withLock {
            if data.isEmpty {
                conversionEmptyOutputCount += 1
            } else {
                Self.addPCM16(data: data, to: &converted)
            }
        }
    }

    func recordConversionFailure(_ error: NSError?) {
        guard configuration.enabled else { return }
        lock.withLock {
            conversionFailureCount += 1
            lastConversionErrorCode = error.map { $0.code }
        }
    }

    func recordConfigurationChange(engineRunning: Bool) {
        guard configuration.enabled else { return }
        lock.withLock {
            configurationChangeCount += 1
            if configurationChangeRunningStates.count < 16 {
                configurationChangeRunningStates.append(engineRunning)
            }
        }
    }

    func finish(engineRunning: Bool) {
        guard configuration.enabled else { return }
        let snapshot: NativePCMRecorderDiagnosticsSnapshot? = lock.withLock {
            guard !didFinish else { return nil }
            didFinish = true
            engineRunningAtStop = engineRunning
            return NativePCMRecorderDiagnosticsSnapshot(
                tapFormatSelection: tapFormatSelection,
                inputScopeFormat: inputScopeFormat,
                outputScopeFormat: outputScopeFormat,
                tapFormat: tapFormat,
                firstCallbackFormat: firstCallbackFormat,
                lastCallbackFormat: lastCallbackFormat,
                callbackFormatChangeCount: callbackFormatChangeCount,
                callbackFormatMismatchCount: callbackFormatMismatchCount,
                raw: raw.snapshot,
                converted: converted.snapshot,
                conversionEmptyOutputCount: conversionEmptyOutputCount,
                conversionFailureCount: conversionFailureCount,
                lastConversionErrorCode: lastConversionErrorCode,
                engineRunningAfterStart: engineRunningAfterStart,
                engineRunningAtStop: engineRunningAtStop,
                engineStartSucceeded: engineStartSucceeded,
                configurationChangeCount: configurationChangeCount,
                configurationChangeRunningStates: configurationChangeRunningStates
            )
        }
        if let snapshot {
            configuration.sink(snapshot)
        }
    }

    private static func summary(_ format: AVAudioFormat) -> NativePCMRecorderFormatSummary {
        NativePCMRecorderFormatSummary(
            sampleRateHz: format.sampleRate,
            channelCount: Int(format.channelCount),
            isInterleaved: format.isInterleaved,
            commonFormat: UInt32(format.commonFormat.rawValue)
        )
    }

    private static func add(buffer: AVAudioPCMBuffer, to stats: inout MutableSignalSummary) {
        stats.bufferCount += 1
        stats.frameCount += Int(buffer.frameLength)
        for audioBuffer in UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList) {
            let byteCount = Int(audioBuffer.mDataByteSize)
            stats.byteCount += byteCount
            guard byteCount > 0, let pointer = audioBuffer.mData else { continue }
            let raw = UnsafeRawBufferPointer(start: pointer, count: byteCount)
            switch buffer.format.commonFormat {
            case .pcmFormatFloat32:
                for value in raw.bindMemory(to: Float.self) {
                    add(value: Double(value), to: &stats)
                }
            case .pcmFormatFloat64:
                for value in raw.bindMemory(to: Double.self) {
                    add(value: value, to: &stats)
                }
            case .pcmFormatInt16:
                for value in raw.bindMemory(to: Int16.self) {
                    add(value: Double(value) / 32_768, to: &stats)
                }
            case .pcmFormatInt32:
                for value in raw.bindMemory(to: Int32.self) {
                    add(value: Double(value) / 2_147_483_648, to: &stats)
                }
            default:
                for byte in raw {
                    add(value: Double(byte) / 255, to: &stats)
                }
            }
        }
    }

    private static func addPCM16(data: Data, to stats: inout MutableSignalSummary) {
        stats.bufferCount += 1
        stats.byteCount += data.count
        stats.frameCount += data.count / 2
        data.withUnsafeBytes { raw in
            for value in raw.bindMemory(to: Int16.self) {
                add(value: Double(value) / 32_768, to: &stats)
            }
        }
    }

    private static func add(value: Double, to stats: inout MutableSignalSummary) {
        stats.sampleCount += 1
        guard value != 0 else { return }
        stats.nonzeroSampleCount += 1
        guard value.isFinite else { return }
        let magnitude = abs(value)
        stats.peakAbs = max(stats.peakAbs, magnitude)
        stats.sumSquares += value * value
    }
}
