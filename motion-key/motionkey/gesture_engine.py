"""Turns per-frame raw gesture activity into debounced key events.

Fully camera-independent and time-injected, so it is unit-testable. The run
loop feeds it `active` (gesture -> raw bool this frame) plus a timestamp.
"""
from __future__ import annotations

import logging

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
