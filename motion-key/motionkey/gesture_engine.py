"""Turns per-frame raw gesture activity into debounced key events.

Fully camera-independent and time-injected, so it is unit-testable. The run
loop feeds it `active` (gesture -> raw bool this frame) plus a timestamp.
"""
from __future__ import annotations

import logging
import math
import time

from .bindings import BindingStore

log = logging.getLogger("motionkey.engine")


class Debouncer:
    """Asymmetric hysteresis debounce.

    A raw value must persist for `up_delay` seconds to activate and
    `down_delay` seconds to deactivate. down_delay also serves as the
    brief tracking-loss timeout: when the hand vanishes raw goes False and
    the key releases after down_delay.
    """

    def __init__(self, up_delay: float = 0.08, down_delay: float = 0.12):
        self.up_delay = up_delay
        self.down_delay = down_delay
        self._stable = False
        self._candidate = False
        self._since = 0.0

    def update(self, raw: bool, now: float) -> bool:
        if raw != self._candidate:
            self._candidate = raw
            self._since = now
        delay = self.up_delay if self._candidate else self.down_delay
        if self._candidate != self._stable and (now - self._since) >= delay:
            self._stable = self._candidate
        return self._stable


class GestureEngine:
    def __init__(self, store: BindingStore, injector, up_delay: float = 0.08,
                 down_delay: float = 0.12):
        self.store = store
        self.injector = injector
        self._deb: dict[str, Debouncer] = {
            g: Debouncer(up_delay, down_delay) for g, _ in store.enabled_items()
        }
        self._stable: dict[str, bool] = {g: False for g in self._deb}
        self._held: dict[str, str] = {}  # gesture -> key currently down (hold mode)

    def _log(self, gesture: str, action: str, key: str) -> None:
        tag = "DRY-RUN" if getattr(self.injector, "dry_run", False) else "LIVE"
        log.info("%-7s %-16s %-8s %s", tag, gesture, action, key)

    def update(self, active: dict[str, bool], now: float) -> None:
        for gesture, binding in self.store.enabled_items():
            deb = self._deb[gesture]
            stable = deb.update(bool(active.get(gesture, False)), now)
            prev = self._stable[gesture]
            if stable == prev:
                continue
            self._stable[gesture] = stable
            if binding.mode == "hold":
                if stable:
                    self._log(gesture, "key-down", binding.key)  # once, rising edge
                    self.injector.key_down(binding.key)
                    self._held[gesture] = binding.key
                else:
                    self._log(gesture, "key-up", binding.key)    # once, falling edge
                    self.injector.key_up(binding.key)
                    self._held.pop(gesture, None)
            elif binding.mode == "tap":
                if stable:                                       # one press per activation
                    self._log(gesture, "tap", binding.key)
                    self.injector.tap(binding.key)
                # release (stable->False) re-arms; nothing emitted

    @property
    def stable(self) -> dict[str, bool]:
        return dict(self._stable)

    def release_all(self) -> None:
        """Release every held key. Idempotent — safe to call on any shutdown path."""
        for gesture, key in list(self._held.items()):
            try:
                self._log(gesture, "key-up", key)
                self.injector.key_up(key)
            except Exception:  # never let cleanup raise
                log.exception("failed releasing %s", key)
            self._held.pop(gesture, None)


# A hand counts as "raised" when it is open and held in the upper part of the
# frame (normalized wrist y below this line; y=0 is the top).
RAISE_Y = 0.4


def derive_active(hands, raise_y: float = RAISE_Y) -> dict[str, bool]:
    """Map detected hands -> raw gesture activity for one frame."""
    left_fist = right_fist = left_raise = right_raise = False
    for h in hands:
        wrist_y = h.landmarks[0][1] if h.landmarks else 1.0
        raised = (not h.is_fist) and wrist_y < raise_y
        if h.handedness == "left":
            left_fist |= h.is_fist
            left_raise |= raised
        else:
            right_fist |= h.is_fist
            right_raise |= raised
    both = left_fist and right_fist
    return {
        # both-fists is exclusive: when both hands are closed only it fires,
        # not the individual left/right fists (avoids 3 keys at once).
        "left-fist": left_fist and not both,
        "right-fist": right_fist and not both,
        "both-fists": both,
        "raise-left-hand": left_raise,
        "raise-right-hand": right_raise,
    }


JOYSTICK_DIRS = ("joystick-left", "joystick-right", "joystick-up", "joystick-down")
# Wrist-to-wrist gap (normalized) at or below which the two hands count as a
# clap, and displacement past which the right hand steers. Both are physical
# calibration knobs — vary with camera FOV and how close the user sits.
CLAP_DIST = 0.20
DEADZONE = 0.06


def _wrist(hands, side: str):
    for h in hands:
        if h.handedness == side and h.landmarks:
            return h.landmarks[0]
    return None


class JoystickTracker:
    """Right hand as a virtual 4-way joystick, toggled by a clap.

    A clap (both wrists within `clap_dist`) toggles joystick mode on its rising
    edge — one clap on, another off. While on, the right hand's displacement
    from a center (captured the frame the mode turns on) drives the
    joystick-* pseudo-gestures: past `deadzone` in a direction holds that
    direction's key; diagonals hold two. Losing the right hand -> neutral.
    Frames are mirrored (selfie), so +x is the user's right and +y is down.
    """

    DIRS = JOYSTICK_DIRS

    def __init__(self, deadzone: float = DEADZONE, clap_dist: float = CLAP_DIST,
                 cooldown: float = 0.6, debug: bool = False):
        self.deadzone = deadzone
        self.clap_dist = clap_dist
        self.cooldown = cooldown  # ignore claps for this long after a toggle
        self.debug = debug
        self.on = False
        self._center = None       # (x, y) neutral origin, or None until captured
        self._clap_prev = False   # rising-edge detector for the clap
        self._last_toggle = float("-inf")

    def _clap(self, hands) -> bool:
        # Handedness-independent: near-touching hands get mislabeled, so just
        # measure the gap between the two closest wrists of any two hands.
        wrists = [h.landmarks[0] for h in hands if h.landmarks]
        gap = None
        if len(wrists) >= 2:
            gap = min(math.hypot(a[0] - b[0], a[1] - b[1])
                      for i, a in enumerate(wrists) for b in wrists[i + 1:])
        if self.debug:
            log.info("clap: %d hand(s), gap=%s (threshold %.3f)",
                     len(wrists), f"{gap:.3f}" if gap is not None else "n/a",
                     self.clap_dist)
        return gap is not None and gap <= self.clap_dist

    def update(self, hands, now: float | None = None) -> dict[str, bool]:
        if now is None:
            now = time.monotonic()
        clap = self._clap(hands)
        # Rising edge toggles, but a cooldown swallows the detection flicker
        # (hands occlude mid-clap -> 2->1->2 hands) so one clap == one toggle.
        if clap and not self._clap_prev and (now - self._last_toggle) >= self.cooldown:
            self.on = not self.on
            self._center = None
            self._last_toggle = now
        self._clap_prev = clap

        out = {d: False for d in JOYSTICK_DIRS}
        if not self.on:
            return out
        r = _wrist(hands, "right")
        if r is None:
            return out                     # hand gone -> neutral, keys release
        if self._center is None:
            self._center = r               # capture origin on first sighting
            return out
        dx, dy = r[0] - self._center[0], r[1] - self._center[1]
        if dx > self.deadzone:
            out["joystick-right"] = True
        elif dx < -self.deadzone:
            out["joystick-left"] = True
        if dy > self.deadzone:
            out["joystick-down"] = True
        elif dy < -self.deadzone:
            out["joystick-up"] = True
        return out

    def merge(self, active: dict[str, bool], hands,
              now: float | None = None) -> dict[str, bool]:
        """Fold joystick activity into base gesture activity.

        Joystick mode is exclusive: while on (or on the clap frame that toggles
        it) every base gesture is suppressed so steering can't leak stray keys.
        """
        js = self.update(hands, now)
        merged = dict(active)
        if self.on or self._clap_prev:
            merged = {g: False for g in merged}
        merged.update(js)
        return merged
