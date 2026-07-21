from __future__ import annotations

from dataclasses import dataclass

# Built-in gesture bank for the MVP. No recording, no learning.
GESTURES = (
    "left-fist",
    "right-fist",
    "both-fists",
    "raise-left-hand",
    "raise-right-hand",
    "open-palm",
    "pointing-up",
    "thumb-down",
    "thumb-up",
    "victory",
    "i-love-you",
    "left-fist-right-finger-up",
    "left-fist-right-finger-down",
    "left-fist-right-finger-left",
    "left-fist-right-finger-right",
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
