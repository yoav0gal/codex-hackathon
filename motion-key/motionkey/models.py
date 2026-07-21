from __future__ import annotations

from dataclasses import dataclass

# Built-in gesture bank for the MVP. No recording, no learning.
# joystick-* are driven by JoystickTracker (right hand as a virtual joystick,
# toggled with both-fists). Binding any of them arms joystick mode.
GESTURES = (
    "left-fist",
    "right-fist",
    "both-fists",
    "raise-left-hand",
    "raise-right-hand",
    "joystick-left",
    "joystick-right",
    "joystick-up",
    "joystick-down",
)
MODES = ("hold", "tap")


@dataclass
class Binding:
    key: str
    mode: str = "hold"
    enabled: bool = True

    def to_dict(self) -> dict:
        return {"key": self.key, "mode": self.mode, "enabled": self.enabled}

    @classmethod
    def from_dict(cls, d: dict) -> "Binding":
        return cls(key=d["key"], mode=d.get("mode", "hold"), enabled=d.get("enabled", True))


@dataclass
class HandObs:
    """One detected hand for a single frame."""
    handedness: str          # user's physical hand: "left" | "right"
    is_fist: bool
    confidence: float        # 0..1
    landmarks: list          # list[(x, y)] normalized, for preview
