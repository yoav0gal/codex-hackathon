# MotionKey

Webcam hand gestures → **system-wide** macOS keyboard events. MotionKey watches
your webcam, recognizes a few built-in hand gestures, and injects normal
keystrokes into the general macOS input stream via Quartz `CGEventCreateKeyboardEvent`
+ `CGEventPost`. Whatever app is **focused** receives the keys — it does not
target any specific app or game.

Demo: control a browser **Snake** game with your fists.

- Close **physical left** hand → hold `A`
- Open left hand → release `A`
- Close **physical right** hand → hold `D`
- Open right hand → release `D`

> macOS only. Camera frames stay entirely local — nothing is saved or uploaded.

## Requirements

- macOS
- Python 3.11+
- A webcam

## Setup

```bash
cd MotionKey
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## macOS permissions

MotionKey needs two permissions for the terminal app you run it from
(Terminal / iTerm / VS Code):

1. **Accessibility** — required to inject keystrokes.
   System Settings → Privacy & Security → **Accessibility** → enable your terminal.
   Without this, keys are silently dropped by macOS.
2. **Camera** — System Settings → Privacy & Security → **Camera** → enable your terminal.

Test without any permission using `--dry-run` (logs keys instead of sending them).

On first `run`, MotionKey downloads the MediaPipe hand model (~8 MB) to
`~/.motionkey/hand_landmarker.task`.

## Commands

```bash
python -m motionkey gestures list
python -m motionkey bind left-fist a --mode hold
python -m motionkey bind right-fist d --mode hold
python -m motionkey bindings list
python -m motionkey unbind left-fist
python -m motionkey run --preview
python -m motionkey run --preview --dry-run   # logs keys, sends nothing
```

### Gesture bank (built-in — no recording)

`left-fist`, `right-fist`, `both-fists`, `raise-left-hand`, `raise-right-hand`,
`both-hands-raised`, `clap`, `finger-snap`, `head-lean-left`, and
`head-lean-right`.
`bind` only maps a known gesture to a supported key; MotionKey does not record
or learn gestures.

A hand is "raised" when it is **open** and held in the upper part of the frame
(so a raised open hand is distinct from a closed fist).

A **finger snap** is recognized when the thumb and middle-finger tips meet on
an open hand. It uses tap mode by default and is bound to `space`.

### Modes

- `--mode hold` — key-down once when the gesture becomes active, key-up once when
  it goes inactive (used for Snake steering).
- `--mode tap` — one press per activation; you must open the hand before it fires
  again.

### Supported keys

`A–Z`, `0–9`, arrows (`left/right/up/down`), `space`, `enter`, `escape`, `tab`,
`backspace`.

## Left vs right

Left/right refer to your **physical hands**. The frame is mirrored (selfie view)
before detection so MediaPipe handedness lines up with your real hands.

## How fist detection works

For each of the four fingers (thumb ignored), the finger is "curled" when its
fingertip is closer to the wrist than its PIP joint is. A hand is a fist when
≥3 of 4 fingers are curled. Classification is debounced over time so landmark
jitter can't rapidly toggle a key, and if tracking is lost the raw state goes
inactive and held keys release after a brief timeout. The preview shows the
detected state and confidence per hand.

**Safety:** every held key is released if tracking is lost, the webcam closes,
the program exits, you press Ctrl+C / `q`, or an error occurs.

## Snake demo walkthrough

1. `pip install -r requirements.txt`
2. Grant **Accessibility** + **Camera** to your terminal (see above).
3. Bind the controls:
   ```bash
   python -m motionkey bind left-fist a --mode hold
   python -m motionkey bind right-fist d --mode hold
   ```
4. Open a Snake game that uses `A`/`D` to steer (e.g. search "snake game" and
   click into the game so it is focused).
5. Dry-run first to confirm gestures fire:
   ```bash
   python -m motionkey run --preview --dry-run
   ```
   Close your left fist → see `DRY-RUN key-down a`; open it → `key-up a`.
6. Go live and click the game window to focus it:
   ```bash
   python -m motionkey run --preview
   ```
   Close left fist to turn left (A), close right fist to turn right (D).

## Bindings file

`~/.motionkey/bindings.json`

```json
{
  "version": 1,
  "bindings": {
    "left-fist":  { "key": "a", "mode": "hold", "enabled": true },
    "right-fist": { "key": "d", "mode": "hold", "enabled": true }
  }
}
```

## Tests

```bash
python tests/test_motionkey.py      # no deps needed
# or
pytest
```

Covers fist state transitions, debouncing, binding validation, and the
release-all-held-keys guarantee on shutdown / tracking loss.

## Project layout

```
motionkey/
  __main__.py cli.py camera.py hand_detector.py
  gesture_engine.py key_injector.py bindings.py models.py
tests/  README.md  requirements.txt
```
