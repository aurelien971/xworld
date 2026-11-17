// Finds a label on a screenshot and prints the middle of it in device points:
//   find-text <png> <scale> <text>   →   "x y"   (exit 1 when the text is not on screen)
// Used to drive an app in the simulator by what is written on the screen, not by
// fixed positions, since a screen's layout can change between launches.
import Foundation
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count >= 4, let image = NSImage(contentsOfFile: args[1]),
      let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil), let scale = Double(args[2]) else {
    FileHandle.standardError.write("usage: find-text <png> <scale> <text>\n".data(using: .utf8)!)
    exit(2)
}
let wanted = args[3].lowercased()
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
let w = Double(cg.width), h = Double(cg.height)
var best: (score: Int, x: Double, y: Double)?
for obs in request.results ?? [] {
    guard let text = obs.topCandidates(1).first?.string.lowercased() else { continue }
    // An exact line beats a line that only contains the words.
    let score = text == wanted ? 2 : text.contains(wanted) ? 1 : 0
    if score == 0 || (best?.score ?? 0) >= score { continue }
    let b = obs.boundingBox
    best = (score, (b.midX * w) / scale, ((1 - b.midY) * h) / scale)
}
guard let hit = best else { exit(1) }
print("\(Int(hit.x.rounded())) \(Int(hit.y.rounded()))")
