# Phosphor Ace

An original first-person WWI dogfight in the style of late-70s / early-80s
vector arcade cabinets: glowing wireframe graphics, a biplane cockpit view,
and synthesized sound. Plain HTML5 canvas, no dependencies or build step.

## Play

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8765
```

then visit http://localhost:8765.

## Controls

| Key | Action |
| --- | --- |
| Arrows / WASD | Bank and pitch (banking turns the plane) |
| Space (or J) | Fire twin machine guns |
| P / Esc | Pause |
| M | Sound on/off |
| I | Invert pitch (flight-stick style: up dives) |

A gamepad also works (left stick to fly, A / RB / RT to fire, Start to pause).

## iPad / tablets

Touch devices get their own controls automatically (pressing a key switches back
to keyboard mode):

- **Tilt to fly** (default). Hold the iPad in landscape like a tray or a steering
  wheel. Tip it sideways to bank; tilt the top edge toward you to climb, away to
  dive. Whatever angle you hold it at when you take off (or resume, or respawn)
  becomes "level".
- **Hold a finger anywhere on the screen to fire.** The FIRE button marks the spot.
- **Touch stick** fallback: drag on the left half to fly, hold the right half to
  fire. It's used automatically if tilt isn't available or permission is denied.
- The pause button sits at the top centre. The title and pause screens have
  buttons for CONTROLS (tilt / stick), INVERT and SOUND.

Tilt needs two things from Safari:

1. **An `https://` address.** iPadOS only gives motion data to secure pages, so
   host the game on GitHub Pages, Netlify, itch.io or similar. Opening it over
   plain `http://` on your local network falls back to the touch stick.
2. **Motion permission.** Safari asks the first time you tap to take off. Tap
   *Allow*. If you tapped *Don't Allow*, quit and reopen Safari to be asked again.

Tip: use *Share > Add to Home Screen* to run it full screen, and turn on rotation
lock so the screen doesn't flip while you tilt.

## Scoring

| Target | Points |
| --- | --- |
| Enemy biplane | 200 |
| Enemy ace (red) | 750 |
| Observation balloon | 300 |
| Fuel tank | 150 |
| Zeppelin | 1500 |
| Wave clear | 250 x wave |

An extra plane is awarded every 15,000 points. Guns overheat if you hold the
trigger too long and will jam until they cool. Clearing a wave patches up some
hull damage. The scope (bottom left) and edge arrows point to enemies.
