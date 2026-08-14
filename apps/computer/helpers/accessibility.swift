#!/usr/bin/env swift
// accessibility.swift — Query macOS Accessibility tree (AXUIElement)
// Usage: accessibility [--app <name>] [--focused] [--depth <n>]
// Output: JSON array of UI elements with role, title, position, size
//
// Requires: Accessibility permissions in System Settings

import AppKit
import Foundation

struct UIElement: Codable {
    let role: String?
    let title: String?
    let value: String?
    let label: String?
    let x: Int
    let y: Int
    let width: Int
    let height: Int
    let enabled: Bool
    let focused: Bool
    let children: Int
}

func getAXValue<T>(_ element: AXUIElement, _ attribute: String) -> T? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success else { return nil }
    return value as? T
}

func getPosition(_ element: AXUIElement) -> CGPoint? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, kAXPositionAttribute as String as CFString, &value)
    guard result == .success, let val = value else { return nil }
    var point = CGPoint.zero
    AXValueGetValue(val as! AXValue, .cgPoint, &point)
    return point
}

func getSize(_ element: AXUIElement) -> CGSize? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, kAXSizeAttribute as String as CFString, &value)
    guard result == .success, let val = value else { return nil }
    var size = CGSize.zero
    AXValueGetValue(val as! AXValue, .cgSize, &size)
    return size
}

func getChildren(_ element: AXUIElement) -> [AXUIElement] {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as String as CFString, &value)
    guard result == .success, let children = value as? [AXUIElement] else { return [] }
    return children
}

func elementToStruct(_ element: AXUIElement) -> UIElement {
    let role: String? = getAXValue(element, kAXRoleAttribute as String)
    let title: String? = getAXValue(element, kAXTitleAttribute as String)
    let value: String? = getAXValue(element, kAXValueAttribute as String)
    let label: String? = getAXValue(element, kAXDescriptionAttribute as String)
    let enabled: Bool = getAXValue(element, kAXEnabledAttribute as String) ?? true
    let focused: Bool = getAXValue(element, kAXFocusedAttribute as String) ?? false

    let pos = getPosition(element) ?? CGPoint.zero
    let sz = getSize(element) ?? CGSize.zero
    let children = getChildren(element)

    return UIElement(
        role: role,
        title: title,
        value: (value?.count ?? 0) > 200 ? String(value!.prefix(200)) + "..." : value,
        label: label,
        x: Int(pos.x),
        y: Int(pos.y),
        width: Int(sz.width),
        height: Int(sz.height),
        enabled: enabled,
        focused: focused,
        children: children.count
    )
}

func walkTree(_ element: AXUIElement, depth: Int, maxDepth: Int) -> [UIElement] {
    var results: [UIElement] = []
    let el = elementToStruct(element)

    // Skip tiny/invisible elements
    if el.width > 5 && el.height > 5 {
        results.append(el)
    }

    if depth < maxDepth {
        for child in getChildren(element) {
            results.append(contentsOf: walkTree(child, depth: depth + 1, maxDepth: maxDepth))
        }
    }

    return results
}

// Parse arguments
var appName: String? = nil
var focusedOnly = false
var maxDepth = 3

var args = Array(CommandLine.arguments.dropFirst())
while !args.isEmpty {
    let arg = args.removeFirst()
    switch arg {
    case "--app":
        if !args.isEmpty { appName = args.removeFirst() }
    case "--focused":
        focusedOnly = true
    case "--depth":
        if !args.isEmpty { maxDepth = Int(args.removeFirst()) ?? 3 }
    default:
        break
    }
}

// Get target application
var targetApp: NSRunningApplication?
if let name = appName {
    targetApp = NSWorkspace.shared.runningApplications.first {
        $0.localizedName?.lowercased() == name.lowercased()
    }
    if targetApp == nil {
        fputs("Error: Application '\(name)' not found\n", stderr)
        exit(1)
    }
} else {
    targetApp = NSWorkspace.shared.frontmostApplication
}

guard let app = targetApp, let pid = Optional(app.processIdentifier) else {
    fputs("Error: No application found\n", stderr)
    exit(1)
}

let appElement = AXUIElementCreateApplication(pid)

var elements: [UIElement]
if focusedOnly {
    var focusedElement: AnyObject?
    AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute as CFString, &focusedElement)
    if let focused = focusedElement {
        elements = walkTree(focused as! AXUIElement, depth: 0, maxDepth: maxDepth)
    } else {
        elements = []
    }
} else {
    elements = walkTree(appElement, depth: 0, maxDepth: maxDepth)
}

// Output as JSON
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
if let data = try? encoder.encode(elements) {
    print(String(data: data, encoding: .utf8)!)
}
