import ClipCore
import Foundation

let commands = [
    ClipCommand.captureFull(),
    ClipCommand.captureWindow(),
    ClipCommand.captureRegion(),
    ClipCommand.shareClipboard(),
    ClipCommand.openRecent()
]

for command in commands {
    precondition(command.executable == "clip")
    precondition(!command.arguments.isEmpty)
}

print("SMOKE OK")
