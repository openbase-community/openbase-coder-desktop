#if os(macOS)
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

@available(macOS 12.3, *)
actor OpenAIComputerUseSteering {
    private var latestInstructions: String?
    private var queuedInstructions: [String] = []

    func replace(with instructions: String) {
        latestInstructions = instructions
    }

    func enqueue(_ instructions: String) {
        queuedInstructions.append(instructions)
    }

    func takeLatest() -> String? {
        defer { latestInstructions = nil }
        return latestInstructions
    }

    func takeNextQueued() -> String? {
        guard !queuedInstructions.isEmpty else {
            return nil
        }
        return queuedInstructions.removeFirst()
    }
}

@available(macOS 12.3, *)
final class OpenAIComputerUseRunner {
    enum RunnerError: Error, LocalizedError {
        case missingAPIKey
        case invalidScreenshot
        case invalidResponse
        case screenShareInactive
        case apiError(Int, String)

        var errorDescription: String? {
            switch self {
            case .missingAPIKey:
                return "OPENAI_API_KEY was not found in the process environment or ~/.openbase/.env."
            case .invalidScreenshot:
                return "Unable to capture the macOS display screenshot."
            case .invalidResponse:
                return "OpenAI returned a response shape the app could not parse."
            case .screenShareInactive:
                return "Computer use stopped because LiveKit screen sharing is no longer active."
            case let .apiError(statusCode, body):
                return "OpenAI API error \(statusCode): \(body)"
            }
        }
    }

    private let apiKey: String
    private let model: String
    private let maxSteps: Int
    private let session: URLSession
    private let displayID: CGDirectDisplayID
    private let steering: OpenAIComputerUseSteering?
    private let screenShareIsActive: @MainActor () -> Bool

    init(
        model: String = "gpt-5.5",
        maxSteps: Int = 30,
        displayID: CGDirectDisplayID = CGMainDisplayID(),
        session: URLSession = .shared,
        steering: OpenAIComputerUseSteering? = nil,
        screenShareIsActive: @escaping @MainActor () -> Bool = { true }
    ) throws {
        guard let apiKey = Self.loadAPIKey() else {
            throw RunnerError.missingAPIKey
        }

        self.apiKey = apiKey
        self.model = model
        self.maxSteps = max(1, maxSteps)
        self.displayID = displayID
        self.session = session
        self.steering = steering
        self.screenShareIsActive = screenShareIsActive
    }

    func run(instructions: String) async throws {
        if !AXIsProcessTrusted() {
            print("OpenAI Computer Use needs Accessibility permission before it can click or type.")
        }

        var currentInstructions: String? = instructions
        while let activeInstructions = currentInstructions {
            currentInstructions = nil
            try await ensureScreenShareIsActive()
            var response = try await createInitialResponse(instructions: activeInstructions)
            var completedCurrentInstruction = false

            for step in 1...maxSteps {
                try Task.checkCancellation()
                try await ensureScreenShareIsActive()

                guard let computerCall = response.computerCall else {
                    completedCurrentInstruction = true
                    print("OpenAI Computer Use finished.")
                    if let finalText = response.finalText {
                        print(finalText)
                    }
                    if let queuedInstructions = await steering?.takeNextQueued() {
                        print("OpenAI Computer Use starting queued instruction.")
                        currentInstructions = queuedInstructions
                    }
                    break
                }

                print("OpenAI Computer Use step \(step): executing \(computerCall.actions.count) action(s).")
                try await execute(actions: computerCall.actions)

                try await ensureScreenShareIsActive()
                let screenshotBase64 = try captureScreenshotBase64()
                let steeringInstructions = await steering?.takeLatest()
                response = try await sendScreenshot(
                    previousResponseID: response.id,
                    callID: computerCall.callID,
                    screenshotBase64: screenshotBase64,
                    steeringInstructions: steeringInstructions
                )
            }

            if !completedCurrentInstruction {
                print("OpenAI Computer Use stopped after reaching max_steps=\(maxSteps).")
                return
            }
        }
    }

    private func ensureScreenShareIsActive() async throws {
        guard await screenShareIsActive() else {
            throw RunnerError.screenShareInactive
        }
    }

    private static func loadAPIKey() -> String? {
        if let value = ProcessInfo.processInfo.environment["OPENAI_API_KEY"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !value.isEmpty
        {
            return value
        }

        let envURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".openbase/.env")
        return loadEnvValue(named: "OPENAI_API_KEY", from: envURL)
    }

    private static func loadEnvValue(named name: String, from url: URL) -> String? {
        guard let contents = try? String(contentsOf: url, encoding: .utf8) else {
            return nil
        }

        for rawLine in contents.components(separatedBy: .newlines) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.isEmpty || line.hasPrefix("#") {
                continue
            }

            let assignment = line.hasPrefix("export ")
                ? String(line.dropFirst("export ".count)).trimmingCharacters(in: .whitespacesAndNewlines)
                : line
            let parts = assignment.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard parts.count == 2,
                  parts[0].trimmingCharacters(in: .whitespacesAndNewlines) == name
            else {
                continue
            }

            let value = unquoteEnvValue(String(parts[1]).trimmingCharacters(in: .whitespacesAndNewlines))
            if !value.isEmpty {
                return value
            }
        }

        return nil
    }

    private static func unquoteEnvValue(_ value: String) -> String {
        guard value.count >= 2,
              let first = value.first,
              let last = value.last,
              (first == "\"" && last == "\"") || (first == "'" && last == "'")
        else {
            return value
        }

        let inner = String(value.dropFirst().dropLast())
        if first == "\"" {
            return inner
                .replacingOccurrences(of: "\\n", with: "\n")
                .replacingOccurrences(of: "\\\"", with: "\"")
                .replacingOccurrences(of: "\\\\", with: "\\")
        }
        return inner
    }

    private func createInitialResponse(instructions: String) async throws -> OpenAIComputerResponse {
        let body: [String: Any] = [
            "model": model,
            "tools": [
                ["type": "computer"],
            ],
            "input": "\(instructions)\n\nUse the computer tool for UI interaction on the visible macOS desktop. Do not use browser automation or shell commands.",
        ]

        return try await createResponse(body: body)
    }

    private func sendScreenshot(
        previousResponseID: String,
        callID: String,
        screenshotBase64: String,
        steeringInstructions: String?
    ) async throws -> OpenAIComputerResponse {
        var input: [[String: Any]] = [
            [
                "type": "computer_call_output",
                "call_id": callID,
                "output": [
                    "type": "computer_screenshot",
                    "image_url": "data:image/png;base64,\(screenshotBase64)",
                    "detail": "original",
                ],
            ],
        ]

        if let steeringInstructions,
           !steeringInstructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        {
            input.append(
                [
                    "role": "user",
                    "content": [
                        [
                            "type": "input_text",
                            "text": "Steering update for the active computer-use run:\n\(steeringInstructions)",
                        ],
                    ],
                ]
            )
        }

        let body: [String: Any] = [
            "model": model,
            "tools": [
                ["type": "computer"],
            ],
            "previous_response_id": previousResponseID,
            "input": input,
        ]

        return try await createResponse(body: body)
    }

    private func createResponse(body: [String: Any]) async throws -> OpenAIComputerResponse {
        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/responses")!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, urlResponse) = try await session.data(for: request)
        guard let httpResponse = urlResponse as? HTTPURLResponse else {
            throw RunnerError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? "<non-UTF8 response>"
            throw RunnerError.apiError(httpResponse.statusCode, body)
        }

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let response = OpenAIComputerResponse(json: json)
        else {
            throw RunnerError.invalidResponse
        }

        return response
    }

    private func captureScreenshotBase64() throws -> String {
        guard let image = CGDisplayCreateImage(displayID) else {
            throw RunnerError.invalidScreenshot
        }

        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let png = bitmap.representation(using: .png, properties: [:]) else {
            throw RunnerError.invalidScreenshot
        }

        return png.base64EncodedString()
    }

    private func execute(actions: [ComputerAction]) async throws {
        for action in actions {
            try Task.checkCancellation()
            try await ensureScreenShareIsActive()

            switch action {
            case .click(let x, let y, let button, let keys):
                withModifierKeys(keys) {
                    click(at: displayPoint(x: x, y: y), button: button, clickCount: 1)
                }
            case .doubleClick(let x, let y, let button, let keys):
                withModifierKeys(keys) {
                    click(at: displayPoint(x: x, y: y), button: button, clickCount: 2)
                }
            case .drag(let path, let keys):
                withModifierKeys(keys) {
                    drag(points: path.map { displayPoint(x: $0.x, y: $0.y) })
                }
            case .move(let x, let y, let keys):
                withModifierKeys(keys) {
                    moveMouse(to: displayPoint(x: x, y: y))
                }
            case .scroll(let x, let y, let scrollX, let scrollY, let keys):
                withModifierKeys(keys) {
                    moveMouse(to: displayPoint(x: x, y: y))
                    scroll(deltaX: scrollX, deltaY: scrollY)
                }
            case .type(let text):
                typeText(text)
            case .keypress(let keys):
                keypress(keys)
            case .wait:
                try await Task.sleep(for: .seconds(2))
            case .screenshot:
                break
            }

            try await ensureScreenShareIsActive()
        }
    }

    private func displayPoint(x: Double, y: Double) -> CGPoint {
        let bounds = CGDisplayBounds(displayID)
        let pixelWidth = Double(CGDisplayPixelsWide(displayID))
        let pixelHeight = Double(CGDisplayPixelsHigh(displayID))
        let pointX = bounds.minX + (x / pixelWidth) * bounds.width
        let pointY = bounds.minY + (y / pixelHeight) * bounds.height
        return CGPoint(x: pointX, y: pointY)
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

    private func drag(points: [CGPoint]) {
        guard let first = points.first else { return }

        moveMouse(to: first)
        CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: first, mouseButton: .left)?
            .post(tap: .cghidEventTap)

        for point in points.dropFirst() {
            CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: point, mouseButton: .left)?
                .post(tap: .cghidEventTap)
        }

        let last = points.last ?? first
        CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: last, mouseButton: .left)?
            .post(tap: .cghidEventTap)
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

    private func keypress(_ keys: [String]) {
        var keyCodes: [CGKeyCode] = []
        var modifierKeyCodes: [CGKeyCode] = []
        var modifierFlags: CGEventFlags = []

        for key in keys {
            let normalized = key.uppercased()
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

    private func withModifierKeys(_ keys: [String], perform: () -> Void) {
        let modifiers = keys.compactMap { Self.modifierKeyCode(for: $0.uppercased()) }

        for modifier in modifiers {
            keyEvent(keyCode: modifier, keyDown: true)
        }

        perform()

        for modifier in modifiers.reversed() {
            keyEvent(keyCode: modifier, keyDown: false)
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
            return Self.letterOrDigitKeyCode(for: key)
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

@available(macOS 12.3, *)
private struct OpenAIComputerResponse {
    let id: String
    let output: [[String: Any]]

    var computerCall: ComputerCall? {
        for item in output {
            guard item["type"] as? String == "computer_call",
                  let callID = item["call_id"] as? String ?? item["callId"] as? String,
                  let rawActions = item["actions"] as? [[String: Any]]
            else {
                continue
            }

            return ComputerCall(callID: callID, actions: rawActions.compactMap(ComputerAction.init(json:)))
        }

        return nil
    }

    var finalText: String? {
        output.compactMap { item in
            guard item["type"] as? String == "message",
                  let content = item["content"] as? [[String: Any]]
            else {
                return nil
            }

            return content.compactMap { part in
                part["text"] as? String
            }.joined(separator: "\n")
        }
        .filter { !$0.isEmpty }
        .joined(separator: "\n")
    }

    init?(json: [String: Any]) {
        guard let id = json["id"] as? String,
              let output = json["output"] as? [[String: Any]]
        else {
            return nil
        }

        self.id = id
        self.output = output
    }
}

@available(macOS 12.3, *)
private struct ComputerCall {
    let callID: String
    let actions: [ComputerAction]
}

@available(macOS 12.3, *)
private enum ComputerAction {
    struct Point {
        let x: Double
        let y: Double
    }

    case click(x: Double, y: Double, button: CGMouseButton, keys: [String])
    case doubleClick(x: Double, y: Double, button: CGMouseButton, keys: [String])
    case drag(path: [Point], keys: [String])
    case move(x: Double, y: Double, keys: [String])
    case scroll(x: Double, y: Double, scrollX: Double, scrollY: Double, keys: [String])
    case type(text: String)
    case keypress(keys: [String])
    case wait
    case screenshot

    init?(json: [String: Any]) {
        guard let type = json["type"] as? String else {
            return nil
        }

        switch type {
        case "click":
            self = .click(
                x: json.double("x"),
                y: json.double("y"),
                button: json.mouseButton,
                keys: json.stringArray("keys")
            )
        case "double_click":
            self = .doubleClick(
                x: json.double("x"),
                y: json.double("y"),
                button: json.mouseButton,
                keys: json.stringArray("keys")
            )
        case "drag":
            self = .drag(path: json.dragPath, keys: json.stringArray("keys"))
        case "move":
            self = .move(x: json.double("x"), y: json.double("y"), keys: json.stringArray("keys"))
        case "scroll":
            self = .scroll(
                x: json.double("x"),
                y: json.double("y"),
                scrollX: json.double("scrollX"),
                scrollY: json.double("scrollY"),
                keys: json.stringArray("keys")
            )
        case "type":
            self = .type(text: json["text"] as? String ?? "")
        case "keypress":
            let keys = json.stringArray("keys")
            self = .keypress(keys: keys.isEmpty ? json.stringArray("key") : keys)
        case "wait":
            self = .wait
        case "screenshot":
            self = .screenshot
        default:
            print("Ignoring unsupported OpenAI Computer Use action: \(type)")
            return nil
        }
    }
}

@available(macOS 12.3, *)
private extension Dictionary where Key == String, Value == Any {
    func double(_ key: String) -> Double {
        if let value = self[key] as? Double {
            return value
        }

        if let value = self[key] as? Int {
            return Double(value)
        }

        if let value = self[key] as? String,
           let double = Double(value)
        {
            return double
        }

        return 0
    }

    func stringArray(_ key: String) -> [String] {
        if let values = self[key] as? [String] {
            return values
        }

        if let value = self[key] as? String {
            return [value]
        }

        return []
    }

    var mouseButton: CGMouseButton {
        switch (self["button"] as? String)?.lowercased() {
        case "right":
            return .right
        case "middle", "center":
            return .center
        default:
            return .left
        }
    }

    var dragPath: [ComputerAction.Point] {
        guard let rawPath = self["path"] as? [Any] else {
            return []
        }

        return rawPath.compactMap { rawPoint in
            if let point = rawPoint as? [String: Any] {
                return ComputerAction.Point(x: point.double("x"), y: point.double("y"))
            }

            if let point = rawPoint as? [Double],
               point.count >= 2
            {
                return ComputerAction.Point(x: point[0], y: point[1])
            }

            if let point = rawPoint as? [Int],
               point.count >= 2
            {
                return ComputerAction.Point(x: Double(point[0]), y: Double(point[1]))
            }

            return nil
        }
    }
}

final class RemoteControlInputController {
    private var authorizedIdentity: String?
    private var accessibilityWarningLogged = false
    private(set) var isEnabled = false

    func disable() {
        authorizedIdentity = nil
        isEnabled = false
    }

    func handle(message: [String: Any], senderIdentity: String?, screenShareActive: Bool) {
        guard let type = message["type"] as? String else { return }

        if type == "openbase.remote_control.set_enabled" {
            setEnabled(
                message["enabled"] as? Bool == true,
                senderIdentity: senderIdentity,
                screenShareActive: screenShareActive
            )
            return
        }

        guard type == "openbase.remote_control.input" else { return }
        guard screenShareActive else {
            print("[livekit-companion-swift] remote-control input ignored because screen share is inactive")
            disable()
            return
        }
        guard isEnabled, senderIdentity == authorizedIdentity else {
            print("[livekit-companion-swift] remote-control input ignored because sender is not authorized")
            return
        }
        guard ensureAccessibilityTrusted(prompt: true) else { return }

        switch message["action"] as? String {
        case "move":
            moveMouseBy(deltaX: message.double("deltaX"), deltaY: message.double("deltaY"))
        case "click":
            click(button: message.remoteMouseButton)
        case "scroll":
            scroll(deltaX: message.double("deltaX"), deltaY: message.double("deltaY"))
        case "type":
            typeText(String((message["text"] as? String ?? "").prefix(1000)))
        case "keypress":
            keypress(keys: Array(message.stringArray("keys").prefix(8)))
        default:
            print("[livekit-companion-swift] remote-control unsupported action=\(message["action"] as? String ?? "unknown")")
        }
    }

    private func setEnabled(_ enabled: Bool, senderIdentity: String?, screenShareActive: Bool) {
        guard enabled else {
            if senderIdentity == authorizedIdentity || authorizedIdentity == nil {
                disable()
                print("[livekit-companion-swift] remote-control disabled")
            }
            return
        }

        guard screenShareActive else {
            print("[livekit-companion-swift] remote-control enable ignored because screen share is inactive")
            disable()
            return
        }

        guard let senderIdentity, !senderIdentity.isEmpty else {
            print("[livekit-companion-swift] remote-control enable ignored because sender identity is missing")
            return
        }

        authorizedIdentity = senderIdentity
        isEnabled = true
        let accessibilityTrusted = ensureAccessibilityTrusted(prompt: true)
        print("[livekit-companion-swift] remote-control enabled sender=\(senderIdentity) accessibilityTrusted=\(accessibilityTrusted)")
    }

    private func ensureAccessibilityTrusted(prompt: Bool) -> Bool {
        if AXIsProcessTrusted() {
            accessibilityWarningLogged = false
            return true
        }

        if prompt {
            let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
        }

        if !accessibilityWarningLogged {
            print("[livekit-companion-swift] remote-control input blocked: Accessibility permission is required for mouse and keyboard control")
            accessibilityWarningLogged = true
        }
        return false
    }

    private func moveMouseBy(deltaX: Double, deltaY: Double) {
        let current = currentMouseLocation()
        let point = CGPoint(
            x: current.x + clamp(deltaX, limit: 90) * 1.35,
            y: current.y + clamp(deltaY, limit: 90) * 1.35
        )
        moveMouse(to: constrainedToMainDisplay(point))
    }

    private func moveMouse(to point: CGPoint) {
        CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?
            .post(tap: .cghidEventTap)
    }

    private func click(button: CGMouseButton) {
        let point = currentMouseLocation()
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

        CGEvent(mouseEventSource: nil, mouseType: downType, mouseCursorPosition: point, mouseButton: button)?
            .post(tap: .cghidEventTap)
        CGEvent(mouseEventSource: nil, mouseType: upType, mouseCursorPosition: point, mouseButton: button)?
            .post(tap: .cghidEventTap)
    }

    private func scroll(deltaX: Double, deltaY: Double) {
        let wheelX = Int32(clamp(-deltaX * 2.4, limit: 180).rounded())
        let wheelY = Int32(clamp(-deltaY * 2.4, limit: 180).rounded())
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
            let normalized = key.uppercased()
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

    private func currentMouseLocation() -> CGPoint {
        CGEvent(source: nil)?.location ?? CGPoint(x: CGDisplayBounds(CGMainDisplayID()).midX, y: CGDisplayBounds(CGMainDisplayID()).midY)
    }

    private func constrainedToMainDisplay(_ point: CGPoint) -> CGPoint {
        let bounds = CGDisplayBounds(CGMainDisplayID())
        return CGPoint(
            x: min(max(point.x, bounds.minX), bounds.maxX - 1),
            y: min(max(point.y, bounds.minY), bounds.maxY - 1)
        )
    }

    private func clamp(_ value: Double, limit: Double) -> Double {
        min(max(value, -limit), limit)
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

private extension Dictionary where Key == String, Value == Any {
    var remoteMouseButton: CGMouseButton {
        switch (self["button"] as? String)?.lowercased() {
        case "right":
            return .right
        case "middle", "center":
            return .center
        default:
            return .left
        }
    }
}
#endif
