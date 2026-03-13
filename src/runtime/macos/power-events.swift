import AppKit
import Foundation

struct EventPayload: Encodable {
  let event: String
  let ts: String
}

let encoder = JSONEncoder()
let formatter = ISO8601DateFormatter()

func emit(_ event: String) {
  let payload = EventPayload(
    event: event,
    ts: formatter.string(from: Date())
  )

  guard
    let data = try? encoder.encode(payload),
    let text = String(data: data, encoding: .utf8)
  else {
    return
  }

  print(text)
  fflush(stdout)
}

let workspaceCenter = NSWorkspace.shared.notificationCenter
let distributedCenter = DistributedNotificationCenter.default()
var observers: [NSObjectProtocol] = []

observers.append(workspaceCenter.addObserver(
  forName: NSWorkspace.willSleepNotification,
  object: nil,
  queue: nil
) { _ in
  emit("system_will_sleep")
})

observers.append(workspaceCenter.addObserver(
  forName: NSWorkspace.didWakeNotification,
  object: nil,
  queue: nil
) { _ in
  emit("system_did_wake")
})

observers.append(distributedCenter.addObserver(
  forName: Notification.Name("com.apple.screenIsLocked"),
  object: nil,
  queue: nil
) { _ in
  emit("screen_locked")
})

observers.append(distributedCenter.addObserver(
  forName: Notification.Name("com.apple.screenIsUnlocked"),
  object: nil,
  queue: nil
) { _ in
  emit("screen_unlocked")
})

emit("monitor_started")
RunLoop.main.run()
