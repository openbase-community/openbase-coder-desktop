#if os(macOS)
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import ScreenCaptureKit

/// Executes single desktop-control commands for the Openbase computer-use MCP
/// path (Claude Code sessions proxy tool calls here through Electron).
///
/// Unlike `OpenAIComputerUseRunner`, which owns a full model loop, this
/// executor performs one visible action per request. Every command requires
/// LiveKit screen sharing to be active so the user always sees what an agent
/// does on their desktop.
@available(macOS 14.0, *)
final class OpenbaseDesktopControlExecutor {
    enum ControlError: Error, LocalizedError {
        case screenShareInactive
        case screenshotFailed
        case accessibilityNotTrusted
        case appNotFound(String)
        case invalidAction(String)

        var errorDescription: String? {
            switch self {
            case .screenShareInactive:
                return "Screen sharing is not active. Start the Openbase screen share first so the user can watch, then retry."
            case .screenshotFailed:
                return "Unable to capture the macOS display screenshot. Check the Screen Recording permission for the Openbase companion."
            case .accessibilityNotTrusted:
                return "Accessibility permission is required before the companion can click or type. Grant it in System Settings > Privacy & Security > Accessibility, then retry."
            case let .appNotFound(name):
                return "No application named \"\(name)\" could be opened."
            case let .invalidAction(detail):
                return "Invalid desktop-control action: \(detail)"
            }
        }
    }

    struct Screenshot {
        let base64PNG: String
        let width: Int
        let height: Int
    }

    struct CursorPosition {
        let x: Int
        let y: Int
    }

    private let displayID = CGMainDisplayID()
    private let maxScreenshotWidth = 1372.0
    // Action coordinates arrive in the pixel space of the most recent
    // screenshot; mapping is proportional so a stale size still lands on the
    // same on-screen location as long as the display resolution is unchanged.
    private var lastScreenshotSize: CGSize

    init() {
        let bounds = CGDisplayBounds(CGMainDisplayID())
        lastScreenshotSize = CGSize(width: bounds.width, height: bounds.height)
    }

    func captureScreenshot() async throws -> Screenshot {
        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: true
        )
        guard let display = content.displays.first(where: { $0.displayID == displayID })
            ?? content.displays.first
        else {
            throw ControlError.screenshotFailed
        }

        let scaleFactor = NSScreen.main?.backingScaleFactor ?? 2.0
        let pixelWidth = Double(display.width) * scaleFactor
        let pixelHeight = Double(display.height) * scaleFactor
        let scale = min(1.0, maxScreenshotWidth / pixelWidth)
        let configuration = SCStreamConfiguration()
        configuration.width = Int((pixelWidth * scale).rounded())
        configuration.height = Int((pixelHeight * scale).rounded())
        configuration.showsCursor = true

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let image = try await SCScreenshotManager.captureImage(
            contentFilter: filter,
            configuration: configuration
        )

        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let png = bitmap.representation(using: .png, properties: [:]) else {
            throw ControlError.screenshotFailed
        }

        lastScreenshotSize = CGSize(width: Double(image.width), height: Double(image.height))
        return Screenshot(
            base64PNG: png.base64EncodedString(),
            width: image.width,
            height: image.height
        )
    }

    func cursorPosition() -> CursorPosition {
        let bounds = CGDisplayBounds(displayID)
        let location = CGEvent(source: nil)?.location ?? CGPoint(x: bounds.midX, y: bounds.midY)
        let x = (location.x - bounds.minX) / bounds.width * lastScreenshotSize.width
        let y = (location.y - bounds.minY) / bounds.height * lastScreenshotSize.height
        return CursorPosition(x: Int(x.rounded()), y: Int(y.rounded()))
    }

    func perform(action: [String: Any]) throws {
        guard let type = action["type"] as? String else {
            throw ControlError.invalidAction("missing type")
        }

        guard ensureAccessibilityTrusted() else {
            throw ControlError.accessibilityNotTrusted
        }

        switch type {
        case "left_click":
            click(at: try point(from: action), button: .left, clickCount: 1)
        case "double_click":
            click(at: try point(from: action), button: .left, clickCount: 2)
        case "right_click":
            click(at: try point(from: action), button: .right, clickCount: 1)
        case "mouse_move":
            moveMouse(to: try point(from: action))
        case "type":
            guard let text = action["text"] as? String else {
                throw ControlError.invalidAction("type requires text")
            }
            typeText(text)
        case "key":
            guard let combo = action["combo"] as? String, !combo.isEmpty else {
                throw ControlError.invalidAction("key requires combo")
            }
            keypress(keys: combo.split(separator: "+").map(String.init))
        case "scroll":
            let target = try point(from: action)
            let amount = max(1, (action["amount"] as? Int) ?? 3)
            let delta = Double(amount) * 40.0
            let (deltaX, deltaY): (Double, Double)
            switch (action["direction"] as? String) ?? "down" {
            case "up":
                (deltaX, deltaY) = (0, -delta)
            case "left":
                (deltaX, deltaY) = (-delta, 0)
            case "right":
                (deltaX, deltaY) = (delta, 0)
            default:
                (deltaX, deltaY) = (0, delta)
            }
            moveMouse(to: target)
            scroll(deltaX: deltaX, deltaY: deltaY)
        default:
            throw ControlError.invalidAction("unsupported type \(type)")
        }
    }

    func openApplication(named name: String) async throws {
        if activateRunningApplication(named: name) {
            return
        }

        let open = Process()
        open.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        open.arguments = ["-a", name]
        try? open.run()
        open.waitUntilExit()
        guard open.terminationStatus == 0 else {
            throw ControlError.appNotFound(name)
        }

        // Best-effort foreground once the app registers as running.
        for _ in 0..<20 {
            if activateRunningApplication(named: name) {
                return
            }
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
    }

    private func activateRunningApplication(named name: String) -> Bool {
        guard let running = NSWorkspace.shared.runningApplications.first(where: {
            $0.localizedName?.caseInsensitiveCompare(name) == .orderedSame
        }) else {
            return false
        }

        running.activate()
        return true
    }

    // MARK: - Coordinate mapping

    private func point(from action: [String: Any]) throws -> CGPoint {
        guard let x = Self.double(action["x"]), let y = Self.double(action["y"]) else {
            throw ControlError.invalidAction("missing x/y coordinates")
        }

        let bounds = CGDisplayBounds(displayID)
        let width = max(1.0, lastScreenshotSize.width)
        let height = max(1.0, lastScreenshotSize.height)
        return CGPoint(
            x: bounds.minX + (x / width) * bounds.width,
            y: bounds.minY + (y / height) * bounds.height
        )
    }

    private static func double(_ value: Any?) -> Double? {
        if let value = value as? Double { return value }
        if let value = value as? Int { return Double(value) }
        if let value = value as? String { return Double(value) }
        return nil
    }

    // MARK: - Input synthesis (mirrors OpenAIComputerUseRunner)

    private func ensureAccessibilityTrusted() -> Bool {
        if AXIsProcessTrusted() {
            return true
        }
        let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
        return AXIsProcessTrusted()
    }

    private func moveMouse(to point: CGPoint) {
        CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?
            .post(tap: .cghidEventTap)
    }

    private func click(at point: CGPoint, button: CGMouseButton, clickCount: Int64) {
        let downType: CGEventType
        let upType: CGEventType

        switch button {
        case .right:
            downType = .rightMouseDown
            upType = .rightMouseUp
        case .center:
            downType = .otherMouseDown
            upType = .otherMouseUp
        default:
            downType = .leftMouseDown
            upType = .leftMouseUp
        }

        moveMouse(to: point)

        for _ in 0..<max(1, clickCount) {
            let down = CGEvent(mouseEventSource: nil, mouseType: downType, mouseCursorPosition: point, mouseButton: button)
            down?.setIntegerValueField(.mouseEventClickState, value: clickCount)
            down?.post(tap: .cghidEventTap)

            let up = CGEvent(mouseEventSource: nil, mouseType: upType, mouseCursorPosition: point, mouseButton: button)
            up?.setIntegerValueField(.mouseEventClickState, value: clickCount)
            up?.post(tap: .cghidEventTap)
        }
    }

    private func scroll(deltaX: Double, deltaY: Double) {
        let wheelX = Int32((-deltaX / 10).rounded())
        let wheelY = Int32((-deltaY / 10).rounded())
        CGEvent(
            scrollWheelEvent2Source: nil,
            units: .pixel,
            wheelCount: 2,
            wheel1: wheelY,
            wheel2: wheelX,
            wheel3: 0
        )?.post(tap: .cghidEventTap)
    }

    private func typeText(_ text: String) {
        for scalar in text.unicodeScalars {
            var value = UniChar(scalar.value)

            let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true)
            down?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &value)
            down?.post(tap: .cghidEventTap)

            let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
            up?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &value)
            up?.post(tap: .cghidEventTap)
        }
    }

    private func keypress(keys: [String]) {
        var keyCodes: [CGKeyCode] = []
        var modifierKeyCodes: [CGKeyCode] = []
        var modifierFlags: CGEventFlags = []

        for key in keys {
            let normalized = key.trimmingCharacters(in: .whitespaces).uppercased()
            if let modifier = Self.modifierKeyCode(for: normalized) {
                modifierKeyCodes.append(modifier)
                modifierFlags.insert(Self.modifierFlag(for: normalized))
            } else if let keyCode = Self.keyCode(for: normalized) {
                keyCodes.append(keyCode)
            }
        }

        for modifier in modifierKeyCodes {
            keyEvent(keyCode: modifier, keyDown: true, flags: modifierFlags)
        }

        for keyCode in keyCodes {
            keyEvent(keyCode: keyCode, keyDown: true, flags: modifierFlags)
            keyEvent(keyCode: keyCode, keyDown: false, flags: modifierFlags)
        }

        for modifier in modifierKeyCodes.reversed() {
            keyEvent(keyCode: modifier, keyDown: false, flags: [])
        }
    }

    private func keyEvent(keyCode: CGKeyCode, keyDown: Bool, flags: CGEventFlags = []) {
        let event = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: keyDown)
        event?.flags = flags
        event?.post(tap: .cghidEventTap)
    }

    private static func modifierKeyCode(for key: String) -> CGKeyCode? {
        switch key {
        case "CTRL", "CONTROL":
            return 0x3B
        case "SHIFT":
            return 0x38
        case "OPTION", "ALT":
            return 0x3A
        case "META", "CMD", "COMMAND":
            return 0x37
        default:
            return nil
        }
    }

    private static func modifierFlag(for key: String) -> CGEventFlags {
        switch key {
        case "CTRL", "CONTROL":
            return .maskControl
        case "SHIFT":
            return .maskShift
        case "OPTION", "ALT":
            return .maskAlternate
        case "META", "CMD", "COMMAND":
            return .maskCommand
        default:
            return []
        }
    }

    private static func keyCode(for key: String) -> CGKeyCode? {
        switch key {
        case "RETURN", "ENTER":
            return 0x24
        case "TAB":
            return 0x30
        case "SPACE":
            return 0x31
        case "DELETE", "BACKSPACE":
            return 0x33
        case "ESC", "ESCAPE":
            return 0x35
        case "LEFT", "ARROWLEFT":
            return 0x7B
        case "RIGHT", "ARROWRIGHT":
            return 0x7C
        case "DOWN", "ARROWDOWN":
            return 0x7D
        case "UP", "ARROWUP":
            return 0x7E
        case "HOME":
            return 0x73
        case "END":
            return 0x77
        case "PAGEUP":
            return 0x74
        case "PAGEDOWN":
            return 0x79
        default:
            return letterOrDigitKeyCode(for: key)
        }
    }

    private static func letterOrDigitKeyCode(for key: String) -> CGKeyCode? {
        let map: [String: CGKeyCode] = [
            "A": 0x00, "S": 0x01, "D": 0x02, "F": 0x03, "H": 0x04, "G": 0x05, "Z": 0x06, "X": 0x07,
            "C": 0x08, "V": 0x09, "B": 0x0B, "Q": 0x0C, "W": 0x0D, "E": 0x0E, "R": 0x0F, "Y": 0x10,
            "T": 0x11, "1": 0x12, "2": 0x13, "3": 0x14, "4": 0x15, "6": 0x16, "5": 0x17, "=": 0x18,
            "9": 0x19, "7": 0x1A, "-": 0x1B, "8": 0x1C, "0": 0x1D, "]": 0x1E, "O": 0x1F, "U": 0x20,
            "[": 0x21, "I": 0x22, "P": 0x23, "L": 0x25, "J": 0x26, "'": 0x27, "K": 0x28, ";": 0x29,
            "\\": 0x2A, ",": 0x2B, "/": 0x2C, "N": 0x2D, "M": 0x2E, ".": 0x2F, "`": 0x32,
        ]

        return map[key]
    }
}
#endif
