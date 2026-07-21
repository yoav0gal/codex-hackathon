"""macOS system-wide keyboard event injection via Quartz CGEvent.

Sends events into the general macOS input stream (not any specific app), so the
frontmost app receives them as normal keystrokes. Requires Accessibility
permission (System Settings -> Privacy & Security -> Accessibility).
"""
from __future__ import annotations

import logging

log = logging.getLogger("motionkey.key")

# key name -> macOS virtual keycode. Only "safe" single keys are allowed.
KEYCODES: dict[str, int] = {
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8,
    "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
    "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45,
    "m": 46,
    "1": 18, "2": 19, "3": 20, "4": 21, "5": 23, "6": 22, "7": 26, "8": 28,
    "9": 25, "0": 29,
    "enter": 36, "tab": 48, "space": 49, "backspace": 51, "escape": 53,
    "left": 123, "right": 124, "down": 125, "up": 126,
}

_ALIASES = {
    "return": "enter", "esc": "escape", "delete": "backspace", "spacebar": "space",
    "arrowleft": "left", "arrowright": "right", "arrowup": "up", "arrowdown": "down",
}

SUPPORTED_KEYS = set(KEYCODES)


def normalize_key(key: str) -> str:
    """Lower-case and resolve aliases. Raises ValueError if unsupported."""
    k = key.strip().lower()
    k = _ALIASES.get(k, k)
    if k not in SUPPORTED_KEYS:
        raise ValueError(
            f"Unsupported key {key!r}. Allowed: A-Z, 0-9, arrows, "
            "space, enter, escape, tab, backspace."
        )
    return k


class KeyInjector:
    """Injects key-down / key-up events. dry_run logs instead of emitting."""

    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run
        self._quartz = None

    def _q(self):
        # Lazy import so dry-run and tests work without pyobjc installed.
        if self._quartz is None:
            try:
                import Quartz  # type: ignore
            except ImportError as e:  # pragma: no cover - env specific
                raise RuntimeError(
                    "pyobjc-framework-Quartz is required for real key injection. "
                    "Install deps or use --dry-run."
                ) from e
            self._quartz = Quartz
        return self._quartz

    def _post(self, keycode: int, down: bool) -> None:
        Q = self._q()
        ev = Q.CGEventCreateKeyboardEvent(None, keycode, down)
        Q.CGEventPost(Q.kCGHIDEventTap, ev)

    def key_down(self, key: str) -> None:
        code = KEYCODES[normalize_key(key)]
        if self.dry_run:
            log.debug("DRY-RUN key-down %s (code %d)", key, code)
            return
        self._post(code, True)

    def key_up(self, key: str) -> None:
        code = KEYCODES[normalize_key(key)]
        if self.dry_run:
            log.debug("DRY-RUN key-up %s (code %d)", key, code)
            return
        self._post(code, False)

    def tap(self, key: str) -> None:
        self.key_down(key)
        self.key_up(key)
