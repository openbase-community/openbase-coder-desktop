/*
 * Copyright 2026 LiveKit
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Foundation
import KeychainAccess
import LiveKit
#if os(macOS)
import AppKit
import Darwin
@preconcurrency import Network
#endif
import SwiftUI

@MainActor let sync = ValueStore<Preferences>(store: Keychain(service: "tech.openbase.coder.LiveKitCompanion"),
                                              key: "preferences",
                                              default: Preferences())

@main
struct LiveKitExample: App {
    @StateObject private var appCtx: AppContext
    @StateObject private var roomCtx: RoomContext

    #if os(macOS)
    private let companionCommandServer: CompanionCommandServer
    #endif

    #if os(visionOS)
    @Environment(\.openWindow) var openWindow
    #endif

    var body: some Scene {
        WindowGroup {
            CompanionStatusView()
                .environmentObject(appCtx)
                .environmentObject(roomCtx)
                .environmentObject(roomCtx.room)
        }
        #if !os(tvOS)
        .handlesExternalEvents(matching: Set(arrayLiteral: "*"))
        #endif
        #if os(macOS)
        .windowStyle(.hiddenTitleBar)
        .windowToolbarStyle(.unifiedCompact)
        #endif

        #if os(visionOS)
        ImmersiveSpace(id: "ImmersiveSpace") {
            ImmersiveView()
        }
        .immersionStyle(selection: .constant(.full), in: .full)
        #endif
    }

    init() {
        #if os(macOS)
        CompanionFileLogging.installFromCommandLine()
        #endif

        let appContext = AppContext(store: sync)
        let roomContext = RoomContext(store: sync)
        _appCtx = StateObject(wrappedValue: appContext)
        _roomCtx = StateObject(wrappedValue: roomContext)

        #if os(macOS)
        companionCommandServer = CompanionCommandServer(roomContext: roomContext)
        companionCommandServer.startFromCommandLine()
        NSApplication.shared.setActivationPolicy(.accessory)
        #endif

        LiveKitSDK.setLogLevel(.debug)
    }
}

struct CompanionStatusView: View {
    @EnvironmentObject var roomCtx: RoomContext

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Openbase Screen Share Companion")
                .font(.headline)
            Text("Waiting for Electron screen-share commands.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .frame(width: 320)
        #if os(macOS)
        .onAppear {
            NSApplication.shared.hide(nil)
        }
        #endif
    }
}

#if os(macOS)
private enum CompanionFileLogging {
    static func installFromCommandLine() {
        let explicitPath = CommandLine.arguments.value(after: "--openbase-log-path")
        let environmentPath = ProcessInfo.processInfo.environment["OPENBASE_LIVEKIT_COMPANION_LOG_PATH"]
        let logPath = explicitPath ?? environmentPath ?? defaultLogPath()
        let expandedLogPath = (logPath as NSString).expandingTildeInPath
        let logUrl = URL(fileURLWithPath: expandedLogPath)

        do {
            try FileManager.default.createDirectory(
                at: logUrl.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
        } catch {
            fputs("[livekit-companion-swift] failed to create log directory: \(error.localizedDescription)\n", stderr)
            return
        }

        let mode = mode_t(S_IRUSR | S_IWUSR | S_IRGRP | S_IROTH)
        let fileDescriptor = open(logUrl.path, O_CREAT | O_WRONLY | O_APPEND, mode)
        guard fileDescriptor >= 0 else {
            fputs("[livekit-companion-swift] failed to open log file path=\(logUrl.path)\n", stderr)
            return
        }

        _ = dup2(fileDescriptor, STDOUT_FILENO)
        _ = dup2(fileDescriptor, STDERR_FILENO)
        close(fileDescriptor)
        setvbuf(stdout, nil, _IOLBF, 0)
        setvbuf(stderr, nil, _IONBF, 0)

        print("[\(ISO8601DateFormatter().string(from: Date()))] [livekit-companion-swift] file-logging path=\(logUrl.path)")
    }

    private static func defaultLogPath() -> String {
        (NSHomeDirectory() as NSString).appendingPathComponent(".openbase/logs/livekit-companion.log")
    }
}

private final class CompanionCommandServer: @unchecked Sendable {
    private let roomContext: RoomContext
    private let jsonDecoder = JSONDecoder()
    private let jsonEncoder = JSONEncoder()
    private var listener: NWListener?
    private var state = "off"
    // Stored as Any because the executor is @available(macOS 14.0, *) while
    // the app's deployment target is 13.0.
    private var desktopControlStorage: Any?

    @available(macOS 14.0, *)
    private var desktopControl: OpenbaseDesktopControlExecutor {
        if let existing = desktopControlStorage as? OpenbaseDesktopControlExecutor {
            return existing
        }
        let created = OpenbaseDesktopControlExecutor()
        desktopControlStorage = created
        return created
    }

    init(roomContext: RoomContext) {
        self.roomContext = roomContext
    }

    func startFromCommandLine() {
        let arguments = CommandLine.arguments
        let port = arguments.value(after: "--openbase-ipc-port").flatMap(UInt16.init) ?? 39281
        let secret = arguments.value(after: "--openbase-ipc-secret") ?? ""

        guard !secret.isEmpty else {
            print("[livekit-companion-swift] ipc-server not started: missing secret")
            return
        }

        do {
            let listener = try NWListener(using: .tcp, on: NWEndpoint.Port(rawValue: port)!)
            self.listener = listener
            listener.newConnectionHandler = { [weak self] connection in
                self?.handle(connection: connection, secret: secret)
            }
            listener.stateUpdateHandler = { listenerState in
                print("[livekit-companion-swift] ipc-listener state=\(listenerState)")
            }
            listener.start(queue: .global(qos: .userInitiated))
            print("[livekit-companion-swift] ipc-server listening port=\(port)")
        } catch {
            print("[livekit-companion-swift] ipc-server failed: \(error.localizedDescription)")
        }
    }

    private func handle(connection: NWConnection, secret: String) {
        CompanionConnectionHandler(server: self, connection: connection, secret: secret).start()
    }

    private final class CompanionConnectionHandler: @unchecked Sendable {
        private let server: CompanionCommandServer
        private let connection: NWConnection
        private let secret: String
        private let queue = DispatchQueue(label: "tech.openbase.coder.companion.ipc.connection", qos: .userInitiated)
        private var buffer = Data()

        init(server: CompanionCommandServer, connection: NWConnection, secret: String) {
            self.server = server
            self.connection = connection
            self.secret = secret
        }

        func start() {
            connection.start(queue: queue)
            receive()
        }

        private func receive() {
            connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [self] data, _, isComplete, error in
                if let data {
                    self.buffer.append(data)
                }

                if let error {
                    print("[livekit-companion-swift] ipc-receive error=\(error.localizedDescription)")
                    self.server.send(connection: self.connection, statusCode: 500, body: Response(ok: false, state: self.server.state, error: error.localizedDescription))
                    return
                }

                if let request = HTTPRequest.parse(self.buffer) {
                    self.server.route(request: request, connection: self.connection, secret: self.secret)
                    return
                }

                if isComplete {
                    self.server.send(connection: self.connection, statusCode: 400, body: Response(ok: false, state: self.server.state, error: "Incomplete request"))
                    return
                }

                self.receive()
            }
        }
    }

    private func route(request: HTTPRequest, connection: NWConnection, secret: String) {
        guard request.headers["x-openbase-companion-secret"] == secret else {
            send(connection: connection, statusCode: 401, body: Response(ok: false, state: state, error: "Unauthorized"))
            return
        }

        print("[livekit-companion-swift] ipc-request method=\(request.method) path=\(request.path)")

        if request.method == "GET", request.path == "/status" {
            send(connection: connection, statusCode: 200, body: Response(ok: true, state: state, error: nil))
            return
        }

        if request.method == "POST", request.path == "/screen-share/start" {
            handleStart(request: request, connection: connection)
            return
        }

        if request.method == "POST", request.path == "/screen-share/stop" {
            handleStop(connection: connection)
            return
        }

        if request.method == "POST", request.path == "/computer-use/start" {
            handleComputerUseStart(request: request, connection: connection)
            return
        }

        if request.method == "POST", request.path == "/computer-use/steer" {
            handleComputerUseSteer(request: request, connection: connection)
            return
        }

        if request.method == "POST", request.path == "/computer-use/queue" {
            handleComputerUseQueue(request: request, connection: connection)
            return
        }

        if request.method == "POST", request.path == "/computer-use/interrupt" {
            handleComputerUseInterrupt(connection: connection)
            return
        }

        if request.method == "POST", request.path == "/claude-chrome/start" {
            handleClaudeChromeStart(request: request, connection: connection)
            return
        }

        if request.method == "POST", request.path == "/claude-chrome/steer" {
            handleClaudeChromeSteer(request: request, connection: connection)
            return
        }

        if request.method == "POST", request.path == "/claude-chrome/queue" {
            handleClaudeChromeQueue(request: request, connection: connection)
            return
        }

        if request.method == "POST", request.path == "/claude-chrome/abort" {
            handleClaudeChromeAbort(connection: connection)
            return
        }

        if request.method == "POST", request.path == "/desktop-control/screenshot" {
            handleDesktopControlScreenshot(connection: connection)
            return
        }

        if request.method == "POST", request.path == "/desktop-control/action" {
            handleDesktopControlAction(request: request, connection: connection)
            return
        }

        if request.method == "POST", request.path == "/desktop-control/open-app" {
            handleDesktopControlOpenApp(request: request, connection: connection)
            return
        }

        if request.method == "GET", request.path == "/desktop-control/cursor" {
            handleDesktopControlCursor(connection: connection)
            return
        }

        send(connection: connection, statusCode: 404, body: Response(ok: false, state: state, error: "Unknown route"))
    }

    private func handleStart(request: HTTPRequest, connection: NWConnection) {
        do {
            let payload = try jsonDecoder.decode(StartScreenShareRequest.self, from: request.body)
            let sourceType = payload.sourceType ?? "display"
            guard sourceType == "display" else {
                state = "error"
                send(connection: connection, statusCode: 400, body: Response(ok: false, state: state, error: "Unsupported screen-share sourceType: \(sourceType)"))
                return
            }

            state = "starting"
            print("[livekit-companion-swift] start-screen-share received roomUrl=\(payload.roomUrl) tokenPresent=\(!payload.token.isEmpty) identity=\(payload.identity ?? "unknown") sourceType=\(sourceType)")

            Task { @MainActor in
                do {
                    try await self.roomContext.startCompanionDisplayShare(roomUrl: payload.roomUrl, token: payload.token)
                    self.state = "sharing"
                    self.send(connection: connection, statusCode: 200, body: Response(ok: true, state: self.state, error: nil))
                } catch {
                    self.state = "error"
                    print("[livekit-companion-swift] start-screen-share failed error=\(error.localizedDescription)")
                    self.send(connection: connection, statusCode: 500, body: Response(ok: false, state: self.state, error: error.localizedDescription))
                }
            }
        } catch {
            state = "error"
            send(connection: connection, statusCode: 400, body: Response(ok: false, state: state, error: "Invalid start payload: \(error.localizedDescription)"))
        }
    }

    private func handleStop(connection: NWConnection) {
        state = "stopping"
        print("[livekit-companion-swift] stop-screen-share received")

        Task { @MainActor in
            do {
                try await self.roomContext.stopCompanionScreenShare()
                self.state = "off"
                self.send(connection: connection, statusCode: 200, body: Response(ok: true, state: self.state, error: nil))
            } catch {
                self.state = "error"
                print("[livekit-companion-swift] stop-screen-share failed error=\(error.localizedDescription)")
                self.send(connection: connection, statusCode: 500, body: Response(ok: false, state: self.state, error: error.localizedDescription))
            }
        }
    }

    private func handleComputerUseStart(request: HTTPRequest, connection: NWConnection) {
        do {
            let payload = try jsonDecoder.decode(ComputerUseStartRequest.self, from: request.body)
            state = "starting-control"
            print("[livekit-companion-swift] computer-use start received model=\(payload.model ?? "default") maxSteps=\(payload.maxSteps ?? 30)")

            Task { @MainActor in
                do {
                    try self.roomContext.startCompanionComputerUse(
                        instructions: payload.instructions,
                        model: payload.model,
                        maxSteps: payload.maxSteps
                    ) { finalState in
                        self.state = finalState
                    }
                    self.state = "controlling"
                    self.send(connection: connection, statusCode: 200, body: Response(ok: true, state: self.state, error: nil))
                } catch {
                    if self.state == "starting-control" {
                        self.state = self.roomContext.isCompanionScreenShareActive() ? "sharing" : "off"
                    }
                    print("[livekit-companion-swift] computer-use start failed error=\(error.localizedDescription)")
                    self.send(connection: connection, statusCode: 409, body: Response(ok: false, state: self.state, error: error.localizedDescription))
                }
            }
        } catch {
            state = "error"
            send(connection: connection, statusCode: 400, body: Response(ok: false, state: state, error: "Invalid computer-use start payload: \(error.localizedDescription)"))
        }
    }

    private func handleComputerUseSteer(request: HTTPRequest, connection: NWConnection) {
        do {
            let payload = try jsonDecoder.decode(ComputerUseSteerRequest.self, from: request.body)
            print("[livekit-companion-swift] computer-use steer received")

            Task { @MainActor in
                do {
                    try await self.roomContext.steerCompanionComputerUse(instructions: payload.instructions)
                    self.state = "controlling"
                    self.send(connection: connection, statusCode: 200, body: Response(ok: true, state: self.state, error: nil))
                } catch {
                    print("[livekit-companion-swift] computer-use steer failed error=\(error.localizedDescription)")
                    self.send(connection: connection, statusCode: 409, body: Response(ok: false, state: self.state, error: error.localizedDescription))
                }
            }
        } catch {
            send(connection: connection, statusCode: 400, body: Response(ok: false, state: state, error: "Invalid computer-use steer payload: \(error.localizedDescription)"))
        }
    }

    private func handleComputerUseQueue(request: HTTPRequest, connection: NWConnection) {
        do {
            let payload = try jsonDecoder.decode(ComputerUseSteerRequest.self, from: request.body)
            print("[livekit-companion-swift] computer-use queue received")

            Task { @MainActor in
                do {
                    try await self.roomContext.queueCompanionComputerUse(instructions: payload.instructions)
                    self.state = "controlling"
                    self.send(connection: connection, statusCode: 200, body: Response(ok: true, state: self.state, error: nil))
                } catch {
                    print("[livekit-companion-swift] computer-use queue failed error=\(error.localizedDescription)")
                    self.send(connection: connection, statusCode: 409, body: Response(ok: false, state: self.state, error: error.localizedDescription))
                }
            }
        } catch {
            send(connection: connection, statusCode: 400, body: Response(ok: false, state: state, error: "Invalid computer-use queue payload: \(error.localizedDescription)"))
        }
    }

    private func handleComputerUseInterrupt(connection: NWConnection) {
        state = "interrupting-control"
        print("[livekit-companion-swift] computer-use interrupt received")

        Task { @MainActor in
            do {
                try await self.roomContext.interruptCompanionComputerUse()
                self.state = "off"
                self.send(connection: connection, statusCode: 200, body: Response(ok: true, state: self.state, error: nil))
            } catch {
                self.state = "error"
                print("[livekit-companion-swift] computer-use interrupt failed error=\(error.localizedDescription)")
                self.send(connection: connection, statusCode: 409, body: Response(ok: false, state: self.state, error: error.localizedDescription))
            }
        }
    }

    private func handleClaudeChromeStart(request: HTTPRequest, connection: NWConnection) {
        do {
            let payload = try jsonDecoder.decode(ClaudeChromeStartRequest.self, from: request.body)
            state = "starting-chrome-control"
            print("[livekit-companion-swift] claude-chrome start received url=\(payload.targetURL) maxTurns=\(payload.maxTurns ?? 0)")

            Task { @MainActor in
                do {
                    try await self.roomContext.startCompanionClaudeChromeControl(
                        roomUrl: payload.roomUrl,
                        token: payload.token,
                        instructions: payload.instructions,
                        targetURL: payload.targetURL,
                        command: payload.command,
                        cwd: payload.cwd,
                        maxTurns: payload.maxTurns,
                        permissionMode: payload.permissionMode,
                        allowedTools: payload.allowedTools,
                        chromeProfileDirectory: payload.chromeProfileDirectory,
                        chromeUseDefaultProfile: payload.chromeUseDefaultProfile
                    )
                    self.state = "chrome-controlling"
                    self.send(connection: connection, statusCode: 200, body: Response(ok: true, state: self.state, error: nil))
                } catch {
                    self.state = "off"
                    print("[livekit-companion-swift] claude-chrome start failed error=\(error.localizedDescription)")
                    self.send(connection: connection, statusCode: 409, body: Response(ok: false, state: self.state, error: error.localizedDescription))
                }
            }
        } catch {
            state = "error"
            send(connection: connection, statusCode: 400, body: Response(ok: false, state: state, error: "Invalid claude-chrome start payload: \(error.localizedDescription)"))
        }
    }

    private func handleClaudeChromeSteer(request: HTTPRequest, connection: NWConnection) {
        do {
            let payload = try jsonDecoder.decode(ClaudeChromeSteerRequest.self, from: request.body)
            print("[livekit-companion-swift] claude-chrome steer received")

            Task { @MainActor in
                do {
                    try self.roomContext.steerCompanionClaudeChromeControl(instructions: payload.instructions)
                    self.state = "chrome-controlling"
                    self.send(connection: connection, statusCode: 200, body: Response(ok: true, state: self.state, error: nil))
                } catch {
                    print("[livekit-companion-swift] claude-chrome steer failed error=\(error.localizedDescription)")
                    self.send(connection: connection, statusCode: 409, body: Response(ok: false, state: self.state, error: error.localizedDescription))
                }
            }
        } catch {
            send(connection: connection, statusCode: 400, body: Response(ok: false, state: state, error: "Invalid claude-chrome steer payload: \(error.localizedDescription)"))
        }
    }

    private func handleClaudeChromeQueue(request: HTTPRequest, connection: NWConnection) {
        do {
            let payload = try jsonDecoder.decode(ClaudeChromeSteerRequest.self, from: request.body)
            print("[livekit-companion-swift] claude-chrome queue received")

            Task { @MainActor in
                do {
                    try self.roomContext.queueCompanionClaudeChromeControl(instructions: payload.instructions)
                    self.state = "chrome-controlling"
                    self.send(connection: connection, statusCode: 200, body: Response(ok: true, state: self.state, error: nil))
                } catch {
                    print("[livekit-companion-swift] claude-chrome queue failed error=\(error.localizedDescription)")
                    self.send(connection: connection, statusCode: 409, body: Response(ok: false, state: self.state, error: error.localizedDescription))
                }
            }
        } catch {
            send(connection: connection, statusCode: 400, body: Response(ok: false, state: state, error: "Invalid claude-chrome queue payload: \(error.localizedDescription)"))
        }
    }

    private func handleClaudeChromeAbort(connection: NWConnection) {
        state = "interrupting-chrome-control"
        print("[livekit-companion-swift] claude-chrome abort received")

        Task { @MainActor in
            do {
                try await self.roomContext.interruptCompanionClaudeChromeControl()
                self.state = "off"
                self.send(connection: connection, statusCode: 200, body: Response(ok: true, state: self.state, error: nil))
            } catch {
                self.state = "error"
                print("[livekit-companion-swift] claude-chrome abort failed error=\(error.localizedDescription)")
                self.send(connection: connection, statusCode: 409, body: Response(ok: false, state: self.state, error: error.localizedDescription))
            }
        }
    }

    private func handleDesktopControlScreenshot(connection: NWConnection) {
        guard #available(macOS 14.0, *) else {
            send(connection: connection, statusCode: 409, body: Response(ok: false, state: state, error: "Desktop control requires macOS 14 or newer."))
            return
        }

        Task { @MainActor in
            guard self.roomContext.isCompanionScreenShareActive() else {
                self.sendDesktopControlInactive(connection: connection)
                return
            }

            do {
                let screenshot = try await self.desktopControl.captureScreenshot()
                self.send(connection: connection, statusCode: 200, payload: ScreenshotResponse(
                    ok: true,
                    image: screenshot.base64PNG,
                    width: screenshot.width,
                    height: screenshot.height
                ))
            } catch {
                print("[livekit-companion-swift] desktop-control screenshot failed error=\(error.localizedDescription)")
                self.send(connection: connection, statusCode: 500, body: Response(ok: false, state: self.state, error: error.localizedDescription))
            }
        }
    }

    private func handleDesktopControlAction(request: HTTPRequest, connection: NWConnection) {
        guard #available(macOS 14.0, *) else {
            send(connection: connection, statusCode: 409, body: Response(ok: false, state: state, error: "Desktop control requires macOS 14 or newer."))
            return
        }

        guard let action = (try? JSONSerialization.jsonObject(with: request.body)) as? [String: Any] else {
            send(connection: connection, statusCode: 400, body: Response(ok: false, state: state, error: "Invalid desktop-control action payload"))
            return
        }

        print("[livekit-companion-swift] desktop-control action received type=\(action["type"] as? String ?? "unknown")")

        Task { @MainActor in
            guard self.roomContext.isCompanionScreenShareActive() else {
                self.sendDesktopControlInactive(connection: connection)
                return
            }

            do {
                try self.desktopControl.perform(action: action)
                self.send(connection: connection, statusCode: 200, body: Response(ok: true, state: self.state, error: nil))
            } catch {
                print("[livekit-companion-swift] desktop-control action failed error=\(error.localizedDescription)")
                self.send(connection: connection, statusCode: 409, body: Response(ok: false, state: self.state, error: error.localizedDescription))
            }
        }
    }

    private func handleDesktopControlOpenApp(request: HTTPRequest, connection: NWConnection) {
        guard #available(macOS 14.0, *) else {
            send(connection: connection, statusCode: 409, body: Response(ok: false, state: state, error: "Desktop control requires macOS 14 or newer."))
            return
        }

        guard let payload = (try? JSONSerialization.jsonObject(with: request.body)) as? [String: Any],
              let name = payload["name"] as? String,
              !name.isEmpty
        else {
            send(connection: connection, statusCode: 400, body: Response(ok: false, state: state, error: "Invalid desktop-control open-app payload"))
            return
        }

        print("[livekit-companion-swift] desktop-control open-app received name=\(name)")

        Task { @MainActor in
            guard self.roomContext.isCompanionScreenShareActive() else {
                self.sendDesktopControlInactive(connection: connection)
                return
            }

            do {
                try await self.desktopControl.openApplication(named: name)
                self.send(connection: connection, statusCode: 200, body: Response(ok: true, state: self.state, error: nil))
            } catch {
                print("[livekit-companion-swift] desktop-control open-app failed error=\(error.localizedDescription)")
                self.send(connection: connection, statusCode: 409, body: Response(ok: false, state: self.state, error: error.localizedDescription))
            }
        }
    }

    private func handleDesktopControlCursor(connection: NWConnection) {
        guard #available(macOS 14.0, *) else {
            send(connection: connection, statusCode: 409, body: Response(ok: false, state: state, error: "Desktop control requires macOS 14 or newer."))
            return
        }

        Task { @MainActor in
            guard self.roomContext.isCompanionScreenShareActive() else {
                self.sendDesktopControlInactive(connection: connection)
                return
            }

            let position = self.desktopControl.cursorPosition()
            self.send(connection: connection, statusCode: 200, payload: CursorResponse(ok: true, x: position.x, y: position.y))
        }
    }

    private func sendDesktopControlInactive(connection: NWConnection) {
        send(connection: connection, statusCode: 409, body: Response(
            ok: false,
            state: state,
            error: "Screen sharing is not active. Run `openbase-coder desktop screen-share start` yourself now (the user watches live and can stop it), then retry. Do not ask the user to start it."
        ))
    }

    private func send(connection: NWConnection, statusCode: Int, body: Response) {
        send(connection: connection, statusCode: statusCode, payload: body)
    }

    private struct StartScreenShareRequest: Decodable {
        let roomUrl: String
        let token: String
        let identity: String?
        let name: String?
        let sourceType: String?
    }

    private struct ComputerUseStartRequest: Decodable {
        let instructions: String
        let model: String?
        let maxSteps: Int?
    }

    private struct ComputerUseSteerRequest: Decodable {
        let instructions: String
    }

    private struct ClaudeChromeStartRequest: Decodable {
        let roomUrl: String
        let token: String
        let identity: String?
        let name: String?
        let instructions: String
        let targetURL: String
        let command: String?
        let cwd: String?
        let maxTurns: Int?
        let permissionMode: String?
        let allowedTools: [String]?
        let chromeProfileDirectory: String?
        let chromeUseDefaultProfile: Bool?
    }

    private struct ClaudeChromeSteerRequest: Decodable {
        let instructions: String
    }

    private struct Response: Encodable {
        let ok: Bool
        let state: String
        let error: String?
    }

    private struct ScreenshotResponse: Encodable {
        let ok: Bool
        let image: String
        let width: Int
        let height: Int
    }

    private struct CursorResponse: Encodable {
        let ok: Bool
        let x: Int
        let y: Int
    }

    private func send<T: Encodable>(connection: NWConnection, statusCode: Int, payload: T) {
        let statusText = statusCode == 200 ? "OK" : "Error"
        let body = (try? jsonEncoder.encode(payload)) ?? Data(#"{"ok":false,"error":"Encoding failed"}"#.utf8)
        var response = Data("HTTP/1.1 \(statusCode) \(statusText)\r\n".utf8)
        response.append(Data("Content-Type: application/json\r\n".utf8))
        response.append(Data("Content-Length: \(body.count)\r\n".utf8))
        response.append(Data("Connection: close\r\n\r\n".utf8))
        response.append(body)

        connection.send(content: response, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }
}

private struct HTTPRequest {
    let method: String
    let path: String
    let headers: [String: String]
    let body: Data

    static func parse(_ data: Data) -> HTTPRequest? {
        guard let separatorRange = data.range(of: Data("\r\n\r\n".utf8)) else {
            return nil
        }

        let headerData = data[..<separatorRange.lowerBound]
        guard let headerText = String(data: headerData, encoding: .utf8) else {
            return nil
        }

        let lines = headerText.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else {
            return nil
        }

        let requestParts = requestLine.split(separator: " ", maxSplits: 2).map(String.init)
        guard requestParts.count >= 2 else {
            return nil
        }

        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            let parts = line.split(separator: ":", maxSplits: 1).map(String.init)
            guard parts.count == 2 else { continue }
            headers[parts[0].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()] =
                parts[1].trimmingCharacters(in: .whitespacesAndNewlines)
        }

        let contentLength = headers["content-length"].flatMap(Int.init) ?? 0
        let bodyStart = separatorRange.upperBound
        guard data.count >= bodyStart + contentLength else {
            return nil
        }

        return HTTPRequest(
            method: requestParts[0],
            path: requestParts[1],
            headers: headers,
            body: Data(data[bodyStart ..< bodyStart + contentLength])
        )
    }
}

private extension Array where Element == String {
    func value(after flag: String) -> String? {
        guard let index = firstIndex(of: flag) else {
            return nil
        }

        let valueIndex = self.index(after: index)
        guard indices.contains(valueIndex) else {
            return nil
        }

        return self[valueIndex]
    }
}
#endif
