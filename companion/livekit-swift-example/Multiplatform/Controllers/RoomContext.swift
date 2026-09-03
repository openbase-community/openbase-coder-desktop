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

@preconcurrency import LiveKit
import SwiftUI
#if os(macOS)
import AppKit
#endif

// This class contains the logic to control behavior of the whole app.
@MainActor
final class RoomContext: ObservableObject {
    let jsonEncoder = JSONEncoder()
    let jsonDecoder = JSONDecoder()

    private let store: ValueStore<Preferences>

    // Used to show connection error dialog
    // private var didClose: Bool = false
    @Published var shouldShowDisconnectReason: Bool = false
    var latestError: LiveKitError?

    let room = Room()

    @Published var url: String = "" {
        didSet { store.value.url = url }
    }

    @Published var token: String = "" {
        didSet { store.value.token = token }
    }

    @Published var e2eeKey: String = "" {
        didSet { store.value.e2eeKey = e2eeKey }
    }

    @Published var isE2eeEnabled: Bool = false {
        didSet {
            store.value.isE2eeEnabled = isE2eeEnabled
            // room.set(isE2eeEnabled: isE2eeEnabled)
        }
    }

    // RoomOptions
    @Published var simulcast: Bool = true {
        didSet { store.value.simulcast = simulcast }
    }

    @Published var adaptiveStream: Bool = false {
        didSet { store.value.adaptiveStream = adaptiveStream }
    }

    @Published var dynacast: Bool = false {
        didSet { store.value.dynacast = dynacast }
    }

    @Published var reportStats: Bool = false {
        didSet { store.value.reportStats = reportStats }
    }

    @Published var singlePeerConnection: Bool = false {
        didSet { store.value.singlePeerConnection = singlePeerConnection }
    }

    // ConnectOptions
    @Published var autoSubscribe: Bool = true {
        didSet { store.value.autoSubscribe = autoSubscribe }
    }

    @Published var focusParticipant: Participant?

    @Published var showMessagesPanel: Bool = false {
        didSet {
            if showMessagesPanel { showAudioPanel = false }
        }
    }

    @Published var messages: [ExampleRoomMessage] = []

    @Published var textFieldString: String = ""

    @Published var showAudioPanel: Bool = false {
        didSet {
            if showAudioPanel { showMessagesPanel = false }
        }
    }

    @Published var isVideoProcessingEnabled: Bool = false {
        didSet {
            if let track = room.localParticipant.firstCameraVideoTrack as? LocalVideoTrack {
                track.capturer.processor = isVideoProcessingEnabled ? backgroundBlurProcessor : nil
            }
        }
    }

    private lazy var backgroundBlurProcessor: (some VideoProcessor)? = if #available(iOS 15.0, *) {
        BackgroundBlurVideoProcessor()
    } else {
        nil
    }

    var _connectTask: Task<Void, Error>?

    init(store: ValueStore<Preferences>) {
        self.store = store
        room.add(delegate: self)

        url = store.value.url
        token = store.value.token
        isE2eeEnabled = store.value.isE2eeEnabled
        e2eeKey = store.value.e2eeKey
        simulcast = store.value.simulcast
        adaptiveStream = store.value.adaptiveStream
        dynacast = store.value.dynacast
        reportStats = store.value.reportStats
        singlePeerConnection = store.value.singlePeerConnection
        autoSubscribe = store.value.autoSubscribe

        #if os(iOS)
        UIApplication.shared.isIdleTimerDisabled = true
        #endif
    }

    deinit {
        #if os(iOS)
        Task { @MainActor in
            UIApplication.shared.isIdleTimerDisabled = false
        }
        #endif
        print("RoomContext.deinit")
    }

    func cancelConnect() {
        _connectTask?.cancel()
    }

    func connect(entry: ConnectionHistory? = nil) async throws -> Room {
        if let entry {
            url = entry.url
            token = entry.token
            isE2eeEnabled = entry.e2ee
            e2eeKey = entry.e2eeKey
        }

        let connectOptions = ConnectOptions(
            autoSubscribe: autoSubscribe
        )

        var encryptionOptions: EncryptionOptions? = nil
        if isE2eeEnabled {
            let keyProvider = BaseKeyProvider(isSharedKey: true)
            keyProvider.setKey(key: e2eeKey)
            encryptionOptions = EncryptionOptions(keyProvider: keyProvider)
        }

        let roomOptions = RoomOptions(
            defaultCameraCaptureOptions: CameraCaptureOptions(
                dimensions: .h1080_169
            ),
            defaultScreenShareCaptureOptions: ScreenShareCaptureOptions(
                dimensions: .h1080_169,
                appAudio: false,
                useBroadcastExtension: false
            ),
            defaultVideoPublishOptions: VideoPublishOptions(
                simulcast: simulcast
            ),
            adaptiveStream: adaptiveStream,
            dynacast: dynacast,
            encryptionOptions: encryptionOptions,
            reportRemoteTrackStatistics: reportStats,
            singlePeerConnection: singlePeerConnection
        )

        let connectTask = Task.detached { [weak self] in
            guard let self else { return }
            try await room.connect(url: url,
                                   token: token,
                                   connectOptions: connectOptions,
                                   roomOptions: roomOptions)
        }

        _connectTask = connectTask
        try await connectTask.value

        return room
    }

    func disconnect() async {
        await SoundPlayer.shared.stopAll()
        await room.disconnect()
    }

    func sendMessage() {
        // Make sure the message is not empty
        guard !textFieldString.isEmpty else { return }

        let roomMessage = ExampleRoomMessage(messageId: UUID().uuidString,
                                             senderSid: room.localParticipant.sid,
                                             senderIdentity: room.localParticipant.identity,
                                             text: textFieldString)
        textFieldString = ""
        messages.append(roomMessage)

        Task.detached { [weak self] in
            guard let self else { return }
            do {
                let json = try jsonEncoder.encode(roomMessage)
                try await room.localParticipant.publish(data: json)
            } catch {
                print("Failed to encode data \(error)")
            }
        }
    }

    #if os(macOS)
    /// Screen share must never starve voice: coding screens compress well at
    /// low fps, and the low bitrate/network priorities let WebRTC's pacer
    /// favor the audio that STT depends on when uplink gets tight.
    static let screenShareFPS = 10
    static func screenSharePublishOptions() -> VideoPublishOptions {
        VideoPublishOptions(
            screenShareEncoding: VideoEncoding(
                maxBitrate: 1_500_000,
                maxFps: screenShareFPS,
                bitratePriority: .low,
                networkPriority: .low
            ),
            preferredCodec: VideoCodec.h264
        )
    }

    weak var screenShareTrack: LocalTrackPublication?
    private var computerUseTask: Task<Void, Never>?
    private var computerUseSteering: OpenAIComputerUseSteering?
    private var launchedChromeProcess: Process?
    private var claudeCodeProcess: Process?
    private var launchedChromeProfileURL: URL?
    private var shouldTerminateLaunchedChromeProcess = false
    private var isManagedChromeShareActive = false
    private var claudeChromeSessionConfig: ClaudeChromeSessionConfig?
    private var claudeChromeQueuedInstructions: [String] = []
    private let remoteControlInput = RemoteControlInputController()

    private struct ClaudeChromeSessionConfig {
        let targetURL: String
        let command: String?
        let cwd: String?
        let maxTurns: Int?
        let permissionMode: String?
        let allowedTools: [String]?
    }

    @available(macOS 12.3, *)
    func setScreenShareMacOS(isEnabled: Bool, screenShareSource: MacOSScreenCaptureSource? = nil) async throws {
        if isEnabled, let screenShareSource {
            let track = LocalVideoTrack.createMacOSScreenShareTrack(
                source: screenShareSource,
                options: ScreenShareCaptureOptions(fps: Self.screenShareFPS, appAudio: false)
            )
            screenShareTrack = try await room.localParticipant.publish(
                videoTrack: track,
                options: Self.screenSharePublishOptions()
            )
        }

        if !isEnabled, let screenShareTrack {
            try await room.localParticipant.unpublish(publication: screenShareTrack)
            self.screenShareTrack = nil
        }
    }

    @available(macOS 12.3, *)
    func startCompanionDisplayShare(roomUrl: String, token companionToken: String) async throws {
        print("[livekit-companion-swift] livekit-connect starting roomUrl=\(roomUrl) tokenPresent=\(!companionToken.isEmpty)")

        if room.localParticipant.isScreenShareEnabled() {
            try await setScreenShareMacOS(isEnabled: false)
        }

        await disconnect()
        url = roomUrl
        token = companionToken
        autoSubscribe = false
        _ = try await connect()
        print("[livekit-companion-swift] livekit-connect ok localIdentity=\(room.localParticipant.identity?.stringValue ?? "unknown")")

        let display = try await MacOSScreenCapturer.mainDisplaySource()
        guard display.displayID == CGMainDisplayID() else {
            print("[livekit-companion-swift] screen-share permission/source failure: no display source available")
            throw NSError(
                domain: "OpenbaseLiveKitCompanion",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "The main macOS display source was not available. Check Screen Recording permission for the companion app."]
            )
        }

        let track = LocalVideoTrack.createMacOSScreenShareTrack(
            source: display,
            options: ScreenShareCaptureOptions(
                dimensions: .h1080_169,
                fps: Self.screenShareFPS,
                appAudio: false,
                includeCurrentApplication: true
            )
        )
        screenShareTrack = try await room.localParticipant.publish(
            videoTrack: track,
            options: Self.screenSharePublishOptions()
        )
        print("[livekit-companion-swift] screen-share publish ok source=main-display displayID=\(display.displayID)")
    }

    @available(macOS 12.3, *)
    func stopCompanionScreenShare(cancelComputerUse: Bool = true) async throws {
        print("[livekit-companion-swift] screen-share unpublish starting")
        remoteControlInput.disable()
        if cancelComputerUse {
            computerUseTask?.cancel()
            computerUseTask = nil
            computerUseSteering = nil
        }
        if room.localParticipant.isScreenShareEnabled() || screenShareTrack != nil {
            try await setScreenShareMacOS(isEnabled: false)
        }
        await disconnect()
        print("[livekit-companion-swift] screen-share unpublish ok")
    }

    @available(macOS 12.3, *)
    func isCompanionScreenShareActive() -> Bool {
        room.localParticipant.isScreenShareEnabled() && screenShareTrack != nil
    }

    @available(macOS 12.3, *)
    func startCompanionComputerUse(
        instructions: String,
        model: String?,
        maxSteps: Int?,
        onCompletion: @escaping @MainActor (String) -> Void
    ) throws {
        guard isCompanionScreenShareActive() else {
            throw NSError(
                domain: "OpenbaseLiveKitCompanion",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Screen sharing must be active before computer use can start."]
            )
        }

        guard computerUseTask == nil else {
            throw NSError(
                domain: "OpenbaseLiveKitCompanion",
                code: 3,
                userInfo: [NSLocalizedDescriptionKey: "Computer use is already running."]
            )
        }
        remoteControlInput.disable()

        let trimmedInstructions = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedInstructions.isEmpty else {
            throw NSError(
                domain: "OpenbaseLiveKitCompanion",
                code: 4,
                userInfo: [NSLocalizedDescriptionKey: "Computer-use instructions are required."]
            )
        }

        let selectedModel = model?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedModel = selectedModel?.isEmpty == false ? selectedModel! : "gpt-5.5"
        let resolvedMaxSteps = max(maxSteps ?? 30, 1)
        let steering = OpenAIComputerUseSteering()
        computerUseSteering = steering

        computerUseTask = Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                self.computerUseTask = nil
                self.computerUseSteering = nil
            }

            do {
                print("[livekit-companion-swift] computer-use starting model=\(resolvedModel) maxSteps=\(resolvedMaxSteps)")
                let runner = try OpenAIComputerUseRunner(
                    model: resolvedModel,
                    maxSteps: resolvedMaxSteps,
                    steering: steering,
                    screenShareIsActive: { [weak self] in
                        self?.isCompanionScreenShareActive() == true
                    }
                )
                try await runner.run(instructions: trimmedInstructions)
                print("[livekit-companion-swift] computer-use completed")
            } catch is CancellationError {
                print("[livekit-companion-swift] computer-use cancelled")
            } catch {
                print("[livekit-companion-swift] computer-use failed error=\(error.localizedDescription)")
            }

            do {
                try await self.stopCompanionScreenShare(cancelComputerUse: false)
                onCompletion("off")
            } catch {
                print("[livekit-companion-swift] computer-use cleanup failed error=\(error.localizedDescription)")
                onCompletion("error")
            }
        }
    }

    @available(macOS 12.3, *)
    func steerCompanionComputerUse(instructions: String) async throws {
        guard computerUseTask != nil,
              let computerUseSteering
        else {
            throw NSError(
                domain: "OpenbaseLiveKitCompanion",
                code: 5,
                userInfo: [NSLocalizedDescriptionKey: "No active computer-use run is available to steer."]
            )
        }

        let trimmedInstructions = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedInstructions.isEmpty else {
            throw NSError(
                domain: "OpenbaseLiveKitCompanion",
                code: 6,
                userInfo: [NSLocalizedDescriptionKey: "Steering instructions are required."]
            )
        }

        await computerUseSteering.replace(with: trimmedInstructions)
        print("[livekit-companion-swift] computer-use steering replaced")
    }

    @available(macOS 12.3, *)
    func queueCompanionComputerUse(instructions: String) async throws {
        guard computerUseTask != nil,
              let computerUseSteering
        else {
            throw NSError(
                domain: "OpenbaseLiveKitCompanion",
                code: 7,
                userInfo: [NSLocalizedDescriptionKey: "No active computer-use run is available to queue onto."]
            )
        }

        let trimmedInstructions = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedInstructions.isEmpty else {
            throw NSError(
                domain: "OpenbaseLiveKitCompanion",
                code: 8,
                userInfo: [NSLocalizedDescriptionKey: "Queued computer-use instructions are required."]
            )
        }

        await computerUseSteering.enqueue(trimmedInstructions)
        print("[livekit-companion-swift] computer-use instruction queued")
    }

    @available(macOS 12.3, *)
    func interruptCompanionComputerUse() async throws {
        guard computerUseTask != nil else {
            throw NSError(
                domain: "OpenbaseLiveKitCompanion",
                code: 9,
                userInfo: [NSLocalizedDescriptionKey: "No active computer-use run is available to interrupt."]
            )
        }

        computerUseTask?.cancel()
        try await stopCompanionScreenShare(cancelComputerUse: false)
        computerUseTask = nil
        computerUseSteering = nil
        print("[livekit-companion-swift] computer-use interrupted")
    }

    @available(macOS 12.3, *)
    func startCompanionClaudeChromeControl(
        roomUrl: String,
        token companionToken: String,
        instructions: String,
        targetURL: String,
        command: String?,
        cwd: String?,
        maxTurns: Int?,
        permissionMode: String?,
        allowedTools: [String]?,
        chromeProfileDirectory: String?,
        chromeUseDefaultProfile: Bool?
    ) async throws {
        let trimmedInstructions = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedInstructions.isEmpty else {
            throw NSError(
                domain: "OpenbaseLiveKitCompanion",
                code: 10,
                userInfo: [NSLocalizedDescriptionKey: "Claude Chrome instructions are required."]
            )
        }

        guard computerUseTask == nil else {
            throw NSError(
                domain: "OpenbaseLiveKitCompanion",
                code: 11,
                userInfo: [NSLocalizedDescriptionKey: "OpenAI computer use is already running."]
            )
        }

        print("[livekit-companion-swift] claude-chrome connect starting roomUrl=\(roomUrl) tokenPresent=\(!companionToken.isEmpty)")
        await disconnect()
        url = roomUrl
        token = companionToken
        autoSubscribe = false
        _ = try await connect()
        print("[livekit-companion-swift] claude-chrome connect ok localIdentity=\(room.localParticipant.identity?.stringValue ?? "unknown")")

        let config = ClaudeChromeSessionConfig(
            targetURL: targetURL,
            command: command,
            cwd: cwd,
            maxTurns: maxTurns,
            permissionMode: permissionMode,
            allowedTools: allowedTools
        )

        try await launchChromeAndShareWindow(
            targetURL: targetURL,
            claudeCodePrompt: trimmedInstructions,
            claudeCodeCommand: command,
            claudeCodeCWD: cwd,
            claudeCodeMaxTurns: maxTurns,
            claudeCodePermissionMode: permissionMode,
            claudeCodeAllowedTools: allowedTools,
            chromeProfileDirectory: chromeProfileDirectory,
            chromeUseDefaultProfile: chromeUseDefaultProfile,
            continueSession: false
        )
        claudeChromeSessionConfig = config
    }

    @available(macOS 12.3, *)
    func steerCompanionClaudeChromeControl(instructions: String) throws {
        guard isManagedChromeShareActive,
              isCompanionScreenShareActive(),
              let config = claudeChromeSessionConfig
        else {
            throw NSError(
                domain: "OpenbaseLiveKitCompanion",
                code: 12,
                userInfo: [NSLocalizedDescriptionKey: "No active Claude Chrome control run is available to steer."]
            )
        }

        let trimmedInstructions = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedInstructions.isEmpty else {
            throw NSError(
                domain: "OpenbaseLiveKitCompanion",
                code: 13,
                userInfo: [NSLocalizedDescriptionKey: "Claude Chrome steering instructions are required."]
            )
        }

        startClaudeCodeBrowserSession(
            prompt: trimmedInstructions,
            targetURL: config.targetURL,
            command: config.command,
            cwd: config.cwd,
            maxTurns: config.maxTurns,
            permissionMode: config.permissionMode,
            allowedTools: config.allowedTools,
            continueSession: true
        )
        print("[livekit-companion-swift] claude-chrome steering submitted")
    }

    @available(macOS 12.3, *)
    func queueCompanionClaudeChromeControl(instructions: String) throws {
        guard isManagedChromeShareActive,
              isCompanionScreenShareActive(),
              claudeChromeSessionConfig != nil
        else {
            throw NSError(
                domain: "OpenbaseLiveKitCompanion",
                code: 14,
                userInfo: [NSLocalizedDescriptionKey: "No active Claude Chrome control run is available to queue onto."]
            )
        }

        let trimmedInstructions = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedInstructions.isEmpty else {
            throw NSError(
                domain: "OpenbaseLiveKitCompanion",
                code: 15,
                userInfo: [NSLocalizedDescriptionKey: "Queued Claude Chrome instructions are required."]
            )
        }

        claudeChromeQueuedInstructions.append(trimmedInstructions)
        print("[livekit-companion-swift] claude-chrome instruction queued count=\(claudeChromeQueuedInstructions.count)")
    }

    @available(macOS 12.3, *)
    func interruptCompanionClaudeChromeControl() async throws {
        guard isManagedChromeShareActive || claudeCodeProcess != nil || launchedChromeProcess != nil else {
            throw NSError(
                domain: "OpenbaseLiveKitCompanion",
                code: 16,
                userInfo: [NSLocalizedDescriptionKey: "No active Claude Chrome control run is available to interrupt."]
            )
        }

        try await stopManagedShare()
        await disconnect()
        print("[livekit-companion-swift] claude-chrome interrupted")
    }

    @available(macOS 12.3, *)
    func abortCompanionControl() async throws {
        if computerUseTask != nil {
            try await interruptCompanionComputerUse()
            return
        }

        if isManagedChromeShareActive || claudeCodeProcess != nil || launchedChromeProcess != nil {
            try await interruptCompanionClaudeChromeControl()
            return
        }

        throw NSError(
            domain: "OpenbaseLiveKitCompanion",
            code: 17,
            userInfo: [NSLocalizedDescriptionKey: "No active control run is available to abort."]
        )
    }

    @available(macOS 12.3, *)
    func handleRemoteControlMessage(_ message: [String: Any], senderIdentity: String?) {
        guard computerUseTask == nil else {
            print("[livekit-companion-swift] remote-control ignored while computer-use is active")
            return
        }

        remoteControlInput.handle(
            message: message,
            senderIdentity: senderIdentity,
            screenShareActive: isCompanionScreenShareActive()
        )
    }

    @available(macOS 12.3, *)
    private func launchChromeAndShareWindow(
        targetURL: String,
        claudeCodePrompt: String?,
        claudeCodeCommand: String?,
        claudeCodeCWD: String?,
        claudeCodeMaxTurns: Int?,
        claudeCodePermissionMode: String?,
        claudeCodeAllowedTools: [String]?,
        chromeProfileDirectory: String?,
        chromeUseDefaultProfile: Bool?,
        continueSession: Bool
    ) async throws {
        try await stopManagedShare()

        let chromeExecutableURL = URL(fileURLWithPath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
        guard FileManager.default.isExecutableFile(atPath: chromeExecutableURL.path) else {
            throw NSError(
                domain: "OpenbaseLiveKitCompanion",
                code: 18,
                userInfo: [NSLocalizedDescriptionKey: "Google Chrome executable was not found at \(chromeExecutableURL.path)."]
            )
        }

        let prompt = claudeCodePrompt?.trimmingCharacters(in: .whitespacesAndNewlines)
        let useDefaultProfile = chromeUseDefaultProfile ?? (prompt?.isEmpty == false)
        let existingChromeWindowIDs = try await chromeWindowIDs()

        let process = Process()
        process.executableURL = chromeExecutableURL

        var arguments: [String] = []
        if useDefaultProfile {
            if let chromeProfileDirectory,
               !chromeProfileDirectory.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            {
                arguments.append("--profile-directory=\(chromeProfileDirectory)")
            }
            shouldTerminateLaunchedChromeProcess = false
        } else {
            let profileURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("livekit-chrome-share-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: profileURL, withIntermediateDirectories: true)
            launchedChromeProfileURL = profileURL
            arguments.append("--user-data-dir=\(profileURL.path)")
            arguments.append("--no-first-run")
            shouldTerminateLaunchedChromeProcess = true
        }

        arguments.append("--new-window")
        arguments.append(targetURL)
        process.arguments = arguments

        try process.run()
        launchedChromeProcess = process

        guard let chromeWindow = try await waitForChromeWindow(
            processID: process.processIdentifier,
            excludingWindowIDs: existingChromeWindowIDs
        ) else {
            throw NSError(
                domain: "OpenbaseLiveKitCompanion",
                code: 19,
                userInfo: [NSLocalizedDescriptionKey: "Launched Chrome, but no shareable Chrome window appeared."]
            )
        }

        if room.localParticipant.isScreenShareEnabled() {
            try await setScreenShareMacOS(isEnabled: false)
        }

        try await setScreenShareMacOS(isEnabled: true, screenShareSource: chromeWindow)
        isManagedChromeShareActive = true
        let title = chromeWindow.title ?? "(untitled)"
        print("Started Chrome window share for pid \(process.processIdentifier): \(title)")

        if let prompt,
           !prompt.isEmpty
        {
            startClaudeCodeBrowserSession(
                prompt: prompt,
                targetURL: targetURL,
                command: claudeCodeCommand,
                cwd: claudeCodeCWD,
                maxTurns: claudeCodeMaxTurns,
                permissionMode: claudeCodePermissionMode,
                allowedTools: claudeCodeAllowedTools,
                continueSession: continueSession
            )
        }
    }

    @available(macOS 12.3, *)
    private func waitForChromeWindow(
        processID: pid_t,
        excludingWindowIDs: Set<CGWindowID>
    ) async throws -> MacOSWindow? {
        for _ in 0..<20 {
            let windows = try await MacOSScreenCapturer.sources(for: .window)
                .compactMap { $0 as? MacOSWindow }

            if let launchedWindow = windows.first(where: { window in
                window.owningApplication?.processID == processID
                    && window.isOnScreen
                    && !excludingWindowIDs.contains(window.windowID)
            }) {
                return launchedWindow
            }

            if let chromeWindow = windows.first(where: { window in
                window.owningApplication?.bundleIdentifier == "com.google.Chrome"
                    && window.isOnScreen
                    && !excludingWindowIDs.contains(window.windowID)
            }) {
                return chromeWindow
            }

            try? await Task.sleep(for: .milliseconds(500))
        }

        return nil
    }

    @available(macOS 12.3, *)
    private func chromeWindowIDs() async throws -> Set<CGWindowID> {
        let windows = try await MacOSScreenCapturer.sources(for: .window)
            .compactMap { $0 as? MacOSWindow }

        return Set(windows.compactMap { window in
            guard window.owningApplication?.bundleIdentifier == "com.google.Chrome" else {
                return nil
            }

            return window.windowID
        })
    }

    private func startClaudeCodeBrowserSession(
        prompt: String,
        targetURL: String,
        command: String?,
        cwd: String?,
        maxTurns: Int?,
        permissionMode: String?,
        allowedTools: [String]?,
        continueSession: Bool
    ) {
        if let claudeCodeProcess,
           claudeCodeProcess.isRunning
        {
            claudeCodeProcess.terminate()
        }

        let fullPrompt = """
        Use your configured browser tooling for this browser session.

        A Chrome window has already been opened to:
        \(targetURL)

        Prefer that existing Chrome window/profile if your browser tooling supports it. If your configured MCP browser tooling has to attach to Chrome, use it. Do not use Codex Chrome. Do not use OpenAI Computer Use.

        Task:
        \(prompt)
        """

        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(fullPrompt, forType: .string)

        let trimmedCommand = command?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedCommand = trimmedCommand?.isEmpty == false ? trimmedCommand! : "claude"

        let executableURL: URL
        var arguments: [String]
        if resolvedCommand.hasPrefix("/") {
            executableURL = URL(fileURLWithPath: resolvedCommand)
            arguments = []
        } else {
            executableURL = URL(fileURLWithPath: "/usr/bin/env")
            arguments = [resolvedCommand]
        }

        arguments.append("-p")
        arguments.append("--chrome")
        if continueSession {
            arguments.append("--continue")
        }
        if let maxTurns {
            arguments.append(contentsOf: ["--max-turns", "\(maxTurns)"])
        }

        if let permissionMode,
           !permissionMode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        {
            arguments.append(contentsOf: ["--permission-mode", permissionMode])
        }

        if let allowedTools,
           !allowedTools.isEmpty
        {
            arguments.append(contentsOf: ["--allowedTools", allowedTools.joined(separator: ",")])
        }

        let process = Process()
        let workingDirectory = cwd?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let workingDirectory,
           !workingDirectory.isEmpty
        {
            process.currentDirectoryURL = URL(fileURLWithPath: workingDirectory)
        }

        arguments.append(fullPrompt)

        process.executableURL = executableURL
        process.arguments = arguments
        process.terminationHandler = { [weak self] process in
            print("[livekit-companion-swift] claude-chrome process exited status=\(process.terminationStatus)")
            Task { @MainActor [weak self, process] in
                guard let self else { return }
                if self.claudeCodeProcess === process {
                    self.claudeCodeProcess = nil
                    self.startNextQueuedClaudeChromeInstructionIfNeeded()
                }
            }
        }
        claudeCodeProcess = process

        do {
            try process.run()
            print("Started Claude Code browser session with command: \(resolvedCommand)")
        } catch {
            claudeCodeProcess = nil
            print("Could not start Claude Code browser session: \(error.localizedDescription)")
            print("The Claude Code prompt was copied to the clipboard.")
        }
    }

    private func startNextQueuedClaudeChromeInstructionIfNeeded() {
        guard isManagedChromeShareActive,
              isCompanionScreenShareActive(),
              let config = claudeChromeSessionConfig,
              claudeCodeProcess == nil,
              !claudeChromeQueuedInstructions.isEmpty
        else {
            return
        }

        let nextInstructions = claudeChromeQueuedInstructions.removeFirst()
        print("[livekit-companion-swift] claude-chrome starting queued instruction remaining=\(claudeChromeQueuedInstructions.count)")
        startClaudeCodeBrowserSession(
            prompt: nextInstructions,
            targetURL: config.targetURL,
            command: config.command,
            cwd: config.cwd,
            maxTurns: config.maxTurns,
            permissionMode: config.permissionMode,
            allowedTools: config.allowedTools,
            continueSession: true
        )
    }

    private func stopManagedShare() async throws {
        if let claudeCodeProcess,
           claudeCodeProcess.isRunning
        {
            claudeCodeProcess.terminate()
        }
        claudeCodeProcess = nil

        if room.localParticipant.isScreenShareEnabled() {
            try await setScreenShareMacOS(isEnabled: false)
        }
        isManagedChromeShareActive = false

        if shouldTerminateLaunchedChromeProcess,
           let launchedChromeProcess,
           launchedChromeProcess.isRunning
        {
            launchedChromeProcess.terminate()
        }

        launchedChromeProcess = nil
        shouldTerminateLaunchedChromeProcess = false

        if let launchedChromeProfileURL {
            try? FileManager.default.removeItem(at: launchedChromeProfileURL)
        }

        launchedChromeProfileURL = nil
        claudeChromeSessionConfig = nil
        claudeChromeQueuedInstructions = []
        print("Stopped managed screen share.")
    }
    #endif

    #if os(visionOS) && compiler(>=6.0)
    weak var arCameraTrack: LocalTrackPublication?

    func setARCamera(isEnabled: Bool) async throws {
        if #available(visionOS 2.0, *) {
            if isEnabled {
                let track = LocalVideoTrack.createARCameraTrack()
                arCameraTrack = try await room.localParticipant.publish(videoTrack: track)
            }
        }

        if !isEnabled, let arCameraTrack {
            try await room.localParticipant.unpublish(publication: arCameraTrack)
            self.arCameraTrack = nil
        }
    }
    #endif
}

extension RoomContext: RoomDelegate {
    func room(_: Room, track publication: TrackPublication, didUpdateE2EEState e2eeState: E2EEState) {
        print("Did update e2eeState = [\(String(describing: e2eeState))] for publication \(publication.sid)")
    }

    nonisolated func room(_ room: Room, didUpdateConnectionState connectionState: ConnectionState, from oldValue: ConnectionState) {
        print("Did update connectionState \(oldValue) -> \(connectionState)")

        if case .disconnected = connectionState,
           let error = room.disconnectError,
           error.type != .cancelled
        {
            Task { @MainActor [weak self] in
                guard let self else { return }
                latestError = room.disconnectError
                shouldShowDisconnectReason = true
                // Reset state
                focusParticipant = nil
                showMessagesPanel = false
                showAudioPanel = false
                textFieldString = ""
                messages.removeAll()
                // self.objectWillChange.send()
            }
        }
    }

    nonisolated func room(_: Room, participantDidDisconnect participant: RemoteParticipant) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            if let focusParticipant, focusParticipant.identity == participant.identity {
                self.focusParticipant = nil
            }
        }
    }

    nonisolated func room(_: Room, participant: RemoteParticipant?, didReceiveData data: Data, forTopic _: String, encryptionType _: EncryptionType) {
        if let controlMessage = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           controlMessage["type"] as? String == "openbase.computer_use.interrupt"
        {
            Task { @MainActor [weak self] in
                guard let self else { return }
                do {
                    print("[livekit-companion-swift] control abort received from LiveKit data message")
                    try await self.abortCompanionControl()
                } catch {
                    print("[livekit-companion-swift] LiveKit control abort ignored error=\(error.localizedDescription)")
                }
            }
            return
        }

        if let remoteControlMessage = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let type = remoteControlMessage["type"] as? String,
           type.hasPrefix("openbase.remote_control.")
        {
            let senderIdentity = participant?.identity?.stringValue
            let messageData = data
            Task { @MainActor [weak self] in
                guard let self else { return }
                if #available(macOS 12.3, *),
                   let controlMessage = try? JSONSerialization.jsonObject(with: messageData) as? [String: Any]
                {
                    self.handleRemoteControlMessage(controlMessage, senderIdentity: senderIdentity)
                }
            }
            return
        }

        do {
            let roomMessage = try jsonDecoder.decode(ExampleRoomMessage.self, from: data)
            // Update UI from main queue
            Task { @MainActor [weak self] in
                guard let self else { return }

                withAnimation {
                    // Add messages to the @Published messages property
                    // which will trigger the UI to update
                    self.messages.append(roomMessage)
                    // Show the messages view when new messages arrive
                    self.showMessagesPanel = true
                }
            }

        } catch {
            print("Failed to decode data \(error)")
        }
    }

    nonisolated func room(_: Room, participant _: Participant, trackPublication _: TrackPublication, didReceiveTranscriptionSegments segments: [TranscriptionSegment]) {
        print("didReceiveTranscriptionSegments: \(segments.map { "(\($0.id): \($0.text), \($0.firstReceivedTime)-\($0.lastReceivedTime), \($0.isFinal))" }.joined(separator: ", "))")
    }

    nonisolated func room(_: Room, trackPublication _: TrackPublication, didUpdateE2EEState state: E2EEState) {
        print("didUpdateE2EEState: \(state)")
    }

    nonisolated func room(_: Room, participant _: LocalParticipant, didPublishTrack publication: LocalTrackPublication) {
        print("didPublishTrack: \(publication)")
        guard let localVideoTrack = publication.track as? LocalVideoTrack, localVideoTrack.source == .camera else { return }

        Task { @MainActor in
            localVideoTrack.capturer.processor = isVideoProcessingEnabled ? backgroundBlurProcessor : nil
        }
    }
}
