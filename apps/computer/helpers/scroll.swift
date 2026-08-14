#!/usr/bin/env swift
// scroll.swift — Native macOS scroll wheel events via CGEvent
// Usage: scroll <x> <y> <deltaY> [deltaX]
// Example: scroll 500 300 -3  (scroll up 3 clicks at position 500,300)

import CoreGraphics
import Foundation

guard CommandLine.arguments.count >= 4 else {
    fputs("Usage: scroll <x> <y> <deltaY> [deltaX]\n", stderr)
    exit(1)
}

let x = Double(CommandLine.arguments[1]) ?? 0
let y = Double(CommandLine.arguments[2]) ?? 0
let deltaY = Int32(CommandLine.arguments[3]) ?? 0
let deltaX = CommandLine.arguments.count > 4 ? Int32(CommandLine.arguments[4]) ?? 0 : 0

// Move mouse to position first
if let moveEvent = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                            mouseCursorPosition: CGPoint(x: x, y: y),
                            mouseButton: .left) {
    moveEvent.post(tap: .cgSessionEventTap)
    usleep(50_000) // 50ms delay for the move to register
}

// Create scroll wheel event
if let scrollEvent = CGEvent(scrollWheelEvent2Source: nil,
                              units: .line,
                              wheelCount: 2,
                              wheel1: deltaY,
                              wheel2: deltaX,
                              wheel3: 0) {
    scrollEvent.post(tap: .cgSessionEventTap)
}
