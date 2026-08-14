#!/usr/bin/env swift
// record.swift — Record mouse/keyboard events via CGEvent tap
// Usage: record [--duration <seconds>]
// Output: JSON array of events to stdout
// Stop: Ctrl+C or duration expires
//
// Requires: Accessibility permissions in System Settings

import CoreGraphics
import Foundation

struct RecordedEvent: Codable {
    let type: String
    let x: Double?
    let y: Double?
    let button: String?
    let keyCode: Int?
    let characters: String?
    let timestamp: Double
}

var events: [RecordedEvent] = []
var startTime: Double = 0
var maxDuration: Double = 60 // default 60 seconds

// Parse args
var args = Array(CommandLine.arguments.dropFirst())
while !args.isEmpty {
    let arg = args.removeFirst()
    if arg == "--duration" && !args.isEmpty {
        maxDuration = Double(args.removeFirst()) ?? 60
    }
}

func eventType(_ type: CGEventType) -> String? {
    switch type {
    case .leftMouseDown: return "left_click"
    case .rightMouseDown: return "right_click"
    case .leftMouseUp: return "left_mouse_up"
    case .rightMouseUp: return "right_mouse_up"
    case .mouseMoved: return "mouse_move"
    case .leftMouseDragged: return "left_drag"
    case .scrollWheel: return "scroll"
    case .keyDown: return "key_down"
    case .keyUp: return "key_up"
    default: return nil
    }
}

func buttonName(_ type: CGEventType) -> String? {
    switch type {
    case .leftMouseDown, .leftMouseUp, .leftMouseDragged: return "left"
    case .rightMouseDown, .rightMouseUp: return "right"
    default: return nil
    }
}

// Callback for CGEvent tap
let callback: CGEventTapCallBack = { proxy, type, event, refcon in
    guard let typeName = eventType(type) else { return Unmanaged.passRetained(event) }

    let now = CFAbsoluteTimeGetCurrent()
    if startTime == 0 { startTime = now }
    let elapsed = now - startTime

    // Check duration limit
    if elapsed > maxDuration {
        CFRunLoopStop(CFRunLoopGetCurrent())
        return Unmanaged.passRetained(event)
    }

    let location = event.location

    let recorded = RecordedEvent(
        type: typeName,
        x: typeName.contains("mouse") || typeName.contains("click") || typeName.contains("drag") || typeName == "scroll" ? Double(location.x) : nil,
        y: typeName.contains("mouse") || typeName.contains("click") || typeName.contains("drag") || typeName == "scroll" ? Double(location.y) : nil,
        button: buttonName(type),
        keyCode: typeName.contains("key") ? Int(event.getIntegerValueField(.keyboardEventKeycode)) : nil,
        characters: nil,
        timestamp: elapsed
    )

    // For mouse_move, only record every ~50ms to avoid flooding
    if typeName == "mouse_move" {
        if let last = events.last, last.type == "mouse_move" && (elapsed - last.timestamp) < 0.05 {
            return Unmanaged.passRetained(event)
        }
    }

    events.append(recorded)

    // Print progress to stderr
    fputs("\r\u{1B}[K Recording... \(events.count) events (\(String(format: "%.1f", elapsed))s / \(String(format: "%.0f", maxDuration))s)", stderr)

    return Unmanaged.passRetained(event)
}

// Create event tap
var eventMask: CGEventMask = 0
eventMask |= (1 << CGEventType.leftMouseDown.rawValue)
eventMask |= (1 << CGEventType.leftMouseUp.rawValue)
eventMask |= (1 << CGEventType.rightMouseDown.rawValue)
eventMask |= (1 << CGEventType.rightMouseUp.rawValue)
eventMask |= (1 << CGEventType.mouseMoved.rawValue)
eventMask |= (1 << CGEventType.leftMouseDragged.rawValue)
eventMask |= (1 << CGEventType.scrollWheel.rawValue)
eventMask |= (1 << CGEventType.keyDown.rawValue)
eventMask |= (1 << CGEventType.keyUp.rawValue)

guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,  // Listen only, don't modify events
    eventsOfInterest: eventMask,
    callback: callback,
    userInfo: nil
) else {
    fputs("Error: Failed to create event tap. Check Accessibility permissions.\n", stderr)
    exit(1)
}

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)

fputs("Recording mouse/keyboard events (max \(String(format: "%.0f", maxDuration))s, Ctrl+C to stop)...\n", stderr)

// Handle Ctrl+C
signal(SIGINT) { _ in
    CFRunLoopStop(CFRunLoopGetCurrent())
}

// Run
CFRunLoopRun()

// Output JSON
fputs("\n", stderr)
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted]
if let data = try? encoder.encode(events) {
    print(String(data: data, encoding: .utf8)!)
}
fputs("Recorded \(events.count) events\n", stderr)
