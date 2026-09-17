@preconcurrency import AVFoundation
import AudioToolbox
import Foundation
import Testing
@testable import RecordingsLib

struct NativePCMRecorderDiagnosticsTests {
    @Test("Aggregates zero and nonzero mono raw and converted signal without retaining samples")
    func aggregatesMonoSignal() throws {
        let inputFormat = try #require(AVAudioFormat(
            standardFormatWithSampleRate: 48_000,
            channels: 1
        ))
        let snapshots = NativePCMRecorderDiagnosticsSnapshotStore()
        let collector = NativePCMRecorderDiagnosticsCollector(
            configuration: NativePCMRecorderDiagnosticsConfiguration(
                enabled: true,
                sink: snapshots.store
            ),
            tapFormatSelection: .inputScope
        )
        collector.recordStart(
            inputScopeFormat: inputFormat,
            outputScopeFormat: inputFormat,
            tapFormat: inputFormat
        )

        let zeroBuffer = try #require(AVAudioPCMBuffer(
            pcmFormat: inputFormat,
            frameCapacity: 4
        ))
        zeroBuffer.frameLength = 4
        collector.recordCallback(zeroBuffer, expectedFormat: inputFormat)

        let signalBuffer = try #require(AVAudioPCMBuffer(
            pcmFormat: inputFormat,
            frameCapacity: 4
        ))
        signalBuffer.frameLength = 4
        let samples = try #require(signalBuffer.floatChannelData?[0])
        for index in 0..<4 {
            samples[index] = index.isMultiple(of: 2) ? 0.25 : -0.25
        }
        collector.recordCallback(signalBuffer, expectedFormat: inputFormat)
        collector.recordConverted(pcm16([8_192, -8_192, 0, 4_096]))
        collector.finish(engineRunning: false)

        let snapshot = try #require(snapshots.value)
        #expect(snapshot.raw.bufferCount == 2)
        #expect(snapshot.raw.byteCount == 32)
        #expect(snapshot.raw.frameCount == 8)
        #expect(snapshot.raw.sampleCount == 8)
        #expect(snapshot.raw.nonzeroSampleCount == 4)
        #expect(abs(snapshot.raw.peakAbs - 0.25) < 0.000_001)
        #expect(snapshot.converted.bufferCount == 1)
        #expect(snapshot.converted.byteCount == 8)
        #expect(snapshot.converted.frameCount == 4)
        #expect(snapshot.converted.sampleCount == 4)
        #expect(snapshot.converted.nonzeroSampleCount == 3)
        #expect(abs(snapshot.converted.peakAbs - 0.25) < 0.000_001)
        #expect(snapshot.conversionEmptyOutputCount == 0)
    }

    @Test("Counts every channel and detects a callback format change")
    func aggregatesMultichannelSignalAndFormatChange() throws {
        let monoFormat = try #require(AVAudioFormat(
            standardFormatWithSampleRate: 48_000,
            channels: 1
        ))
        let stereoFormat = try #require(AVAudioFormat(
            standardFormatWithSampleRate: 48_000,
            channels: 2
        ))
        let snapshots = NativePCMRecorderDiagnosticsSnapshotStore()
        let collector = NativePCMRecorderDiagnosticsCollector(
            configuration: NativePCMRecorderDiagnosticsConfiguration(
                enabled: true,
                sink: snapshots.store
            ),
            tapFormatSelection: .outputScope
        )
        collector.recordStart(
            inputScopeFormat: stereoFormat,
            outputScopeFormat: monoFormat,
            tapFormat: monoFormat
        )

        let stereoBuffer = try #require(AVAudioPCMBuffer(
            pcmFormat: stereoFormat,
            frameCapacity: 3
        ))
        stereoBuffer.frameLength = 3
        let channels = try #require(stereoBuffer.floatChannelData)
        for index in 0..<3 {
            channels[0][index] = 0.125
            channels[1][index] = 0
        }
        collector.recordCallback(stereoBuffer, expectedFormat: monoFormat)
        let monoBuffer = try #require(AVAudioPCMBuffer(
            pcmFormat: monoFormat,
            frameCapacity: 3
        ))
        monoBuffer.frameLength = 3
        collector.recordCallback(monoBuffer, expectedFormat: monoFormat)
        collector.recordConfigurationChange(engineRunning: true)
        collector.finish(engineRunning: false)

        let snapshot = try #require(snapshots.value)
        #expect(snapshot.tapFormatSelection == .outputScope)
        #expect(snapshot.inputScopeFormat?.channelCount == 2)
        #expect(snapshot.outputScopeFormat?.channelCount == 1)
        #expect(snapshot.tapFormat?.channelCount == 1)
        #expect(snapshot.firstCallbackFormat?.channelCount == 2)
        #expect(snapshot.lastCallbackFormat?.channelCount == 1)
        #expect(snapshot.callbackFormatChangeCount == 1)
        #expect(snapshot.callbackFormatMismatchCount == 1)
        #expect(snapshot.raw.frameCount == 6)
        #expect(snapshot.raw.sampleCount == 9)
        #expect(snapshot.raw.nonzeroSampleCount == 3)
        #expect(snapshot.configurationChangeCount == 1)
        #expect(snapshot.configurationChangeRunningStates == [true])
    }

    @Test("Preserves conversion failure and empty output classification in the bounded snapshot")
    func recordsConversionFailureAndLifecycle() throws {
        let format = try #require(AVAudioFormat(
            standardFormatWithSampleRate: 48_000,
            channels: 1
        ))
        let snapshots = NativePCMRecorderDiagnosticsSnapshotStore()
        let collector = NativePCMRecorderDiagnosticsCollector(
            configuration: NativePCMRecorderDiagnosticsConfiguration(
                enabled: true,
                sink: snapshots.store
            ),
            tapFormatSelection: .inputScope
        )
        collector.recordStart(
            inputScopeFormat: format,
            outputScopeFormat: format,
            tapFormat: format
        )
        collector.recordEngineStart(succeeded: false, running: false)
        collector.recordConversionFailure(NSError(domain: "fixture", code: 42))
        collector.recordConverted(Data())
        collector.finish(engineRunning: false)
        collector.finish(engineRunning: true)

        let snapshot = try #require(snapshots.value)
        #expect(snapshot.engineStartSucceeded == false)
        #expect(snapshot.engineRunningAfterStart == false)
        #expect(snapshot.engineRunningAtStop == false)
        #expect(snapshot.conversionFailureCount == 1)
        #expect(snapshot.lastConversionErrorCode == 42)
        #expect(snapshot.conversionEmptyOutputCount == 1)
        #expect(snapshot.converted.sampleCount == 0)
        #expect(snapshot.compactDescription.contains("conversion_failures=1"))
        #expect(!snapshot.compactDescription.contains("fixture"))
        #expect(snapshots.count == 1)
    }

    @Test(
        "Selects a stable primary channel for discrete three-channel mono conversion",
        arguments: [false, true]
    )
    func downmixesDiscreteThreeChannelInput(inPhase: Bool) throws {
        let layout = try #require(
            AVAudioChannelLayout(layoutTag: kAudioChannelLayoutTag_DiscreteInOrder | 3)
        )
        let inputFormat = AVAudioFormat(
            standardFormatWithSampleRate: 48_000,
            channelLayout: layout
        )
        let outputFormat = try #require(NativePCMRecorder.realtimeOutputFormat())
        let converter = try #require(AVAudioConverter(
            from: inputFormat,
            to: outputFormat
        ))
        let emitted = NativePCMRecorderPCMDataStore()
        let recorder = NativePCMRecorder(
            testingInputFormat: inputFormat,
            outputFormat: outputFormat,
            converter: converter,
            stopCapture: {},
            onCallbackAdmitted: {},
            finalizeConverter: { _, _ in [] },
            onPCM: emitted.append
        )

        let frames = 4_800
        let buffer = try #require(AVAudioPCMBuffer(
            pcmFormat: inputFormat,
            frameCapacity: AVAudioFrameCount(frames)
        ))
        buffer.frameLength = AVAudioFrameCount(frames)
        let channels = try #require(buffer.floatChannelData)
        for channel in 0..<3 {
            let frequency = inPhase ? 440.0 : 440.0 + Double(channel * 170)
            for frame in 0..<frames {
                channels[channel][frame] = Float(
                    0.25 * sin(2 * .pi * frequency * Double(frame) / 48_000)
                )
            }
        }

        recorder.processInputBufferForTesting(buffer)
        recorder.stop()

        let data = emitted.value
        #expect(data.count > 0)
        let nonzeroSamples = data.withUnsafeBytes { raw -> Int in
            raw.bindMemory(to: Int16.self).filter { $0 != 0 }.count
        }
        #expect(nonzeroSamples > 0)
        #expect(nonzeroSamples > data.count / 4)
    }

    @Test("Selects a stable primary channel for an unknown-labelled three-channel layout")
    func downmixesUnknownThreeChannelInput() throws {
        let layout = try #require(unknownThreeChannelLayout())
        let inputFormat = AVAudioFormat(
            standardFormatWithSampleRate: 48_000,
            channelLayout: layout
        )
        let outputFormat = try #require(NativePCMRecorder.realtimeOutputFormat())
        let converter = try #require(AVAudioConverter(
            from: inputFormat,
            to: outputFormat
        ))
        let emitted = NativePCMRecorderPCMDataStore()
        let recorder = NativePCMRecorder(
            testingInputFormat: inputFormat,
            outputFormat: outputFormat,
            converter: converter,
            stopCapture: {},
            onCallbackAdmitted: {},
            finalizeConverter: { _, _ in [] },
            onPCM: emitted.append
        )

        let frames = 4_800
        let buffer = try #require(AVAudioPCMBuffer(
            pcmFormat: inputFormat,
            frameCapacity: AVAudioFrameCount(frames)
        ))
        buffer.frameLength = AVAudioFrameCount(frames)
        let channels = try #require(buffer.floatChannelData)
        for channel in 0..<3 {
            let amplitude = channel == 0 ? 0.25 : 0.05
            for frame in 0..<frames {
                channels[channel][frame] = Float(
                    amplitude * sin(2 * .pi * 440.0 * Double(frame) / 48_000)
                )
            }
        }

        recorder.processInputBufferForTesting(buffer)
        recorder.stop()

        let data = emitted.value
        #expect(data.count > 0)
        let nonzeroSamples = data.withUnsafeBytes { raw -> Int in
            raw.bindMemory(to: Int16.self).filter { $0 != 0 }.count
        }
        #expect(nonzeroSamples > 0)
        #expect(nonzeroSamples > data.count / 4)
    }

    private func pcm16(_ values: [Int16]) -> Data {
        values.reduce(into: Data()) { data, value in
            var littleEndian = value.littleEndian
            withUnsafeBytes(of: &littleEndian) {
                data.append(contentsOf: $0)
            }
        }
    }
}

private final class NativePCMRecorderDiagnosticsSnapshotStore: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var value: NativePCMRecorderDiagnosticsSnapshot?
    private(set) var count = 0

    func store(_ snapshot: NativePCMRecorderDiagnosticsSnapshot) {
        lock.lock()
        value = snapshot
        count += 1
        lock.unlock()
    }
}


private final class NativePCMRecorderPCMDataStore: @unchecked Sendable {
    private let lock = NSLock()
    private var chunks: [Data] = []

    func append(_ data: Data) {
        lock.lock()
        chunks.append(data)
        lock.unlock()
    }

    var value: Data {
        lock.lock()
        defer { lock.unlock() }
        return chunks.reduce(into: Data()) { $0.append($1) }
    }
}


private func unknownThreeChannelLayout() -> AVAudioChannelLayout? {
    let count = 3
    let size = MemoryLayout<AudioChannelLayout>.size
        + (count - 1) * MemoryLayout<AudioChannelDescription>.stride
    let pointer = UnsafeMutableRawPointer.allocate(
        byteCount: size,
        alignment: MemoryLayout<AudioChannelLayout>.alignment
    )
    pointer.initializeMemory(as: UInt8.self, repeating: 0, count: size)
    defer { pointer.deallocate() }

    let layout = pointer.assumingMemoryBound(to: AudioChannelLayout.self)
    layout.pointee.mChannelLayoutTag = kAudioChannelLayoutTag_UseChannelDescriptions
    layout.pointee.mChannelBitmap = AudioChannelBitmap(rawValue: 0)
    layout.pointee.mNumberChannelDescriptions = UInt32(count)
    let description = AudioChannelDescription(
        mChannelLabel: kAudioChannelLabel_Unknown,
        mChannelFlags: AudioChannelFlags(rawValue: 0),
        mCoordinates: (0, 0, 0)
    )
    let offset = MemoryLayout<AudioChannelLayout>.offset(of: \.mChannelDescriptions)!
    let descriptions = pointer.advanced(by: offset)
        .assumingMemoryBound(to: AudioChannelDescription.self)
    for index in 0..<count {
        descriptions[index] = description
    }
    return AVAudioChannelLayout(layout: layout)
}
