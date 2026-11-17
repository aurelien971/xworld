import XCTest

/// A robot user for Opaque. It opens the app in its demo mode and goes through
/// it the way a person would: category, filter, variation, upload a photo, apply,
/// a round of Pong while it generates, then the result and a drag across the
/// before and after. Everything it taps, it finds by what is written on it, so
/// it does not care where a tile happens to be.
///
/// What to do comes from the environment (set by scripts/recorder/record.ts):
///   CATEGORY, FILTER, VARIATION   the labels to tap, as the app shows them
///   RESULT                        the image the app shows as the result
///   WAIT, RALLY                   seconds the app "generates", seconds of Pong
///   MARKS                         a folder where "start" and "done" are written,
///                                 so the recording can begin and end on cue
final class RobotTests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment
    private var app: XCUIApplication!

    override func setUp() { continueAfterFailure = false }

    func testWalkthrough() throws {
        let category = env["CATEGORY"] ?? "Style"
        let filter = env["FILTER"] ?? "Cinematic"
        let variation = env["VARIATION"] ?? ""
        let rally = Double(env["RALLY"] ?? "7") ?? 7

        app = XCUIApplication(bundleIdentifier: "aaan.Opaque")
        app.launchArguments = ["-factoryDemo", "YES", "-factoryDemoResult", env["RESULT"] ?? "", "-factoryDemoSeconds", env["WAIT"] ?? "11"]
        app.terminate()
        app.launch()
        // The recording begins once the app is up, so it never shows the phone's home screen.
        mark("start")
        if !tile(category).waitForExistence(timeout: 20) { dump(); XCTFail("The home screen never showed \(category).") }
        beat(1.4)

        try press(category)
        beat(1.0)
        try press(filter)
        beat(1.0)
        // A filter with one look opens straight away; one with several shows them first.
        let upload = tile("Upload a photo")
        if !upload.waitForExistence(timeout: 1.5) {
            try press(variation)
            XCTAssertTrue(upload.waitForExistence(timeout: 8), "The filter never opened.")
        }
        beat(1.5)
        upload.tap()

        // The system's photo picker: the newest photo is the first one, top left.
        beat(2.4)
        at(0.165, 0.24).tap()
        let apply = tile("Apply")
        XCTAssertTrue(apply.waitForExistence(timeout: 10), "The photo never loaded.")
        beat(1.6)
        apply.tap()

        let pong = tile("Play Opaque Pong while you wait")
        XCTAssertTrue(pong.waitForExistence(timeout: 6), "Pong was never offered.")
        beat(1.3)
        pong.tap()
        beat(1.6)
        at(0.5, 0.62).tap()          // serve
        beat(rally)
        // If a point ended, serve again so the court is never left waiting.
        if tile("Tap to start").exists { at(0.5, 0.62).tap(); beat(2.5) }
        tile("Done").tap()

        XCTAssertTrue(tile("Save").waitForExistence(timeout: 20), "The result never arrived.")
        beat(1.8)
        // Drag the handle across to show the before, hold, and bring it back.
        let left = at(0.135, 0.5), right = at(0.78, 0.5)
        left.press(forDuration: 0.15, thenDragTo: right, withVelocity: 380, thenHoldForDuration: 0.7)
        beat(0.3)
        right.press(forDuration: 0.1, thenDragTo: left, withVelocity: 380, thenHoldForDuration: 0.3)
        beat(1.8)
        mark("done")
    }

    // MARK: Finding things by what they say

    /// Whatever on screen is called exactly this: a tile's title, a button, a line of text.
    private func tile(_ name: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label ==[c] %@", name)).firstMatch
    }

    /// Tap something by name, scrolling down to it if it is below the fold or under the prompt bar.
    private func press(_ name: String) throws {
        let el = tile(name)
        let floor = app.windows.firstMatch.frame.height - 150
        for _ in 0..<7 {
            if el.exists, el.isHittable, el.frame.midY < floor, el.frame.midY > 150 {
                el.tap()
                return
            }
            at(0.5, 0.68).press(forDuration: 0.05, thenDragTo: at(0.5, 0.42), withVelocity: 600, thenHoldForDuration: 0.1)
            beat(0.5)
        }
        XCTFail("Nothing on screen is called \(name).")
        throw XCTSkip("")
    }

    private func at(_ x: Double, _ y: Double) -> XCUICoordinate {
        app.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y))
    }
    /// What is on screen, written beside the marks, for when something cannot be found.
    private func dump() {
        guard let dir = env["MARKS"] else { return }
        try? app.debugDescription.write(toFile: "\(dir)/screen.txt", atomically: true, encoding: .utf8)
    }
    private func beat(_ seconds: Double) { Thread.sleep(forTimeInterval: seconds) }
    private func mark(_ name: String) {
        guard let dir = env["MARKS"] else { return }
        FileManager.default.createFile(atPath: "\(dir)/\(name)", contents: Data())
    }
}
