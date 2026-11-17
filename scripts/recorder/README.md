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

**One command.** `npm run record -- --brief <post id>`, or
`--asset <photo id> --filter <filter id> --variation <id>`. It fetches the pair,
puts the photo first in the simulator's library, runs the robot user, records
from the moment the app is up until the robot is done, trims the still
stretches and saves the clip to `data/recordings/<pair>/app.mp4` and to the
factory's media as `recordings/<pair>.mp4`. Add `--generate` to make a pair
that does not exist yet (one image). `--app <Opaque.app>` installs a fresh
debug build first.

**The robot user** is a UI test of its own (`robot/Robot.xcodeproj`), not part
of Opaque's project. It launches the installed app by its bundle id in demo
mode and taps things by their label, scrolling to them when needed, so the
order of the tiles does not matter. When it cannot find something it writes
what is on screen to `marks/screen.txt`.

Limits: the filter must exist in the app under the Human tab, with the same
names as the factory's catalogue; the tile it sits under is taken to be the
filter's category (override with `--category`).

`find-text` and `tighten.mjs` are the pieces for driving and cutting a take by hand.
