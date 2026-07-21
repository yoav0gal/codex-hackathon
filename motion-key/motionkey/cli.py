"""MotionKey CLI (argparse, stdlib)."""
from __future__ import annotations

import argparse
import logging
import sys
import time

from . import bindings as bindings_mod
from .gesture_engine import (
    DEADZONE, JOYSTICK_DIRS, GestureEngine, JoystickTracker, derive_active,
)
from .key_injector import SUPPORTED_KEYS
from .models import GESTURES, MODES


def _print_gestures() -> int:
    print("Gesture bank (built-in, no recording):")
    for g in GESTURES:
        print(f"  {g}")
    return 0


def _bind(args) -> int:
    store = bindings_mod.load()
    try:
        b = store.set(args.gesture, args.key, args.mode)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    bindings_mod.save(store)
    print(f"bound {args.gesture} -> {b.key} ({b.mode})")
    return 0


def _unbind(args) -> int:
    store = bindings_mod.load()
    if store.remove(args.gesture):
        bindings_mod.save(store)
        print(f"unbound {args.gesture}")
        return 0
    print(f"no binding for {args.gesture}", file=sys.stderr)
    return 1


def _list_bindings(_args) -> int:
    store = bindings_mod.load()
    if not store.bindings:
        print("no bindings. Try: python -m motionkey bind left-fist a --mode hold")
        return 0
    for g, b in store.bindings.items():
        state = "" if b.enabled else " (disabled)"
        print(f"  {g} -> {b.key} [{b.mode}]{state}")
    return 0


def _run(args) -> int:
    log = logging.getLogger("motionkey")
    store = bindings_mod.load()
    if not store.bindings:
        print("no bindings configured. Bind a gesture first.", file=sys.stderr)
        return 1

    from .key_injector import KeyInjector
    injector = KeyInjector(dry_run=args.dry_run)
    engine = GestureEngine(store, injector)

    # Arm the clap-toggled joystick only if the user bound a direction.
    tracker = (JoystickTracker(deadzone=args.joystick_deadzone,
                               debug=args.joystick_debug)
               if set(store.bindings) & set(JOYSTICK_DIRS) else None)
    if tracker:
        print("Joystick armed: clap to toggle, right hand steers.")

    # Import heavy/native deps only when actually running.
    try:
        from .camera import Camera
        from .hand_detector import HandDetector
    except RuntimeError as e:
        print(f"error: {e}", file=sys.stderr)
        return 3

    try:
        camera = Camera(args.camera)
    except Exception as e:
        print(f"camera error: {e}", file=sys.stderr)
        return 3

    detector = HandDetector()
    mode = "DRY-RUN (no keys sent)" if args.dry_run else "LIVE"
    print(f"MotionKey running [{mode}]. Ctrl+C or q to stop.")
    if not args.dry_run:
        print("If nothing types, grant Accessibility permission in System Settings.")

    try:
        while True:
            bgr, rgb = camera.read_mirrored_rgb()
            if rgb is None:
                continue
            hands = detector.detect(rgb)
            now = time.time()
            active = derive_active(hands)
            if tracker:
                was_on = tracker.on
                active = tracker.merge(active, hands, now)
                if tracker.on != was_on:
                    log.info("JOYSTICK %s (clap)", "ON" if tracker.on else "OFF")
            engine.update(active, now)
            if args.preview:
                if not camera.show(bgr, hands, engine.stable):
                    break
    except KeyboardInterrupt:
        pass
    except Exception:  # pragma: no cover - runtime hardware path
        log.exception("run loop failed")
    finally:
        engine.release_all()   # guarantee: never leave a key stuck down
        detector.close()
        camera.release()
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="motionkey", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("gestures", help="gesture bank")
    gsub = g.add_subparsers(dest="sub", required=True)
    gsub.add_parser("list", help="list built-in gestures").set_defaults(
        func=lambda a: _print_gestures())

    b = sub.add_parser("bind", help="map a gesture to a key")
    b.add_argument("gesture", choices=GESTURES)
    b.add_argument("key", help="target key (A-Z, 0-9, arrows, space, enter, ...)")
    b.add_argument("--mode", choices=MODES, default="hold")
    b.set_defaults(func=_bind)

    u = sub.add_parser("unbind", help="remove a binding")
    u.add_argument("gesture", choices=GESTURES)
    u.set_defaults(func=_unbind)

    bl = sub.add_parser("bindings", help="stored bindings")
    blsub = bl.add_subparsers(dest="sub", required=True)
    blsub.add_parser("list", help="list bindings").set_defaults(func=_list_bindings)

    r = sub.add_parser("run", help="start webcam gesture control")
    r.add_argument("--preview", action="store_true", help="show OpenCV camera preview")
    r.add_argument("--dry-run", action="store_true",
                   help="log intended key events without sending them")
    r.add_argument("--camera", type=int, default=0, help="camera index (default 0)")
    r.add_argument("--joystick-deadzone", type=float, default=DEADZONE,
                   help="neutral radius around center before steering (0..1)")
    r.add_argument("--joystick-debug", action="store_true",
                   help="log the wrist-to-wrist gap each frame to tune the clap")
    r.set_defaults(func=_run)

    return p


def main(argv=None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    args = build_parser().parse_args(argv)
    return args.func(args)


# tiny sanity for the key allowlist used by argparse help text
assert {"a", "d", "space", "left", "right"} <= SUPPORTED_KEYS
