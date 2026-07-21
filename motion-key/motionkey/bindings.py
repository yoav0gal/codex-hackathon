"""Load/save/validate gesture->key bindings at ~/.motionkey/bindings.json."""
from __future__ import annotations

import json
from pathlib import Path

from .key_injector import normalize_key
from .models import GESTURES, MODES, Binding

VERSION = 1
CONFIG_DIR = Path.home() / ".motionkey"
BINDINGS_PATH = CONFIG_DIR / "bindings.json"


class BindingStore:
    def __init__(self, bindings: dict[str, Binding] | None = None):
        self.bindings: dict[str, Binding] = bindings or {}

    def set(self, gesture: str, key: str, mode: str) -> Binding:
        validate_gesture(gesture)
        validate_mode(mode)
        key = normalize_key(key)  # raises on unsupported key
        b = Binding(key=key, mode=mode, enabled=True)
        self.bindings[gesture] = b
        return b

    def remove(self, gesture: str) -> bool:
        return self.bindings.pop(gesture, None) is not None

    def enabled_items(self):
        return {g: b for g, b in self.bindings.items() if b.enabled}.items()

    def to_dict(self) -> dict:
        return {
            "version": VERSION,
            "bindings": {g: b.to_dict() for g, b in self.bindings.items()},
        }

    @classmethod
    def from_dict(cls, d: dict) -> "BindingStore":
        raw = d.get("bindings", {})
        return cls({g: Binding.from_dict(v) for g, v in raw.items()})


def validate_gesture(gesture: str) -> None:
    if gesture not in GESTURES:
        raise ValueError(f"Unknown gesture {gesture!r}. Known: {', '.join(GESTURES)}")


def validate_mode(mode: str) -> None:
    if mode not in MODES:
        raise ValueError(f"Unknown mode {mode!r}. Known: {', '.join(MODES)}")


def load(path: Path = BINDINGS_PATH) -> BindingStore:
    if not path.exists():
        return BindingStore()
    data = json.loads(path.read_text())
    return BindingStore.from_dict(data)


def save(store: BindingStore, path: Path = BINDINGS_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(store.to_dict(), indent=2))
