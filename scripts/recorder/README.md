# Recording the real app

Screen recordings of Opaque itself, made by running the app in the iOS Simulator
and driving it, for posts that show the product being used.

**The app side.** Opaque has a demo mode in debug builds only
(`Opaque/Support/FactoryDemo.swift`). Launched with

    -factoryDemo YES -factoryDemoResult <after.jpg> -factoryDemoSeconds 11

it skips sign-in, onboarding, the paywall and the store, and instead of calling
the image model it waits the given seconds and shows the image it was handed.
In Pong the paddle follows the ball. Nothing is written to Firebase. A release
build has none of this.

**The simulator.** A device named `Factory Recorder` holds only library photos,
so the photo picker never shows anything personal. Its id is in
`data/recordings/device`.

**A take.**
1. Add the before photo to the device (`xcrun simctl addmedia`), launch in demo
   mode with the matching after, start `xcrun simctl io <device> recordVideo`.
2. Drive the flow: category, filter, variation, Upload a photo, the photo,
   Apply, Play Opaque Pong, tap to serve, Done, drag the compare handle.
   Tile order changes between launches, so each label is located on a
   screenshot first: `find-text <png> 3 "<label>"` prints where it is, in points.
3. Stop the recording and run `node scripts/recorder/tighten.mjs in.mp4 out.mp4`:
   stretches where nothing moves are cut to a beat and the clip is fitted to
   1080×1920.

`find-text` is compiled from `find-text.swift` (`swiftc -O find-text.swift -o ../../data/recordings/find-text`).
