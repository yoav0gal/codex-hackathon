"""Runnable checks: pytest OR `python tests/test_motionkey.py`.

Covers fist transitions, debouncing, binding validation, and the guarantee
that all held keys release on shutdown / tracking loss. No camera, no pyobjc.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from motionkey.bindings import BindingStore, load, save
from motionkey.gesture_engine import (
    Debouncer, GestureEngine, JoystickTracker, derive_active,
)
from motionkey.models import HandObs
from motionkey.hand_detector import classify_fist


class FakeInjector:
    def __init__(self):
        self.events = []  # list of ("down"|"up"|"tap", key)

    def key_down(self, k): self.events.append(("down", k))
    def key_up(self, k): self.events.append(("up", k))
    def tap(self, k): self.events.append(("tap", k))


def _store(mode="hold"):
    s = BindingStore()
    s.set("left-fist", "a", mode)
    return s


# ---- fist heuristic ----

def _open_hand():
    # wrist at bottom, fingers extended upward (tips far from wrist)
    pts = [(0.5, 1.0)] * 21
    for i, (mcp, pip, tip) in enumerate([(5, 6, 8), (9, 10, 12), (13, 14, 16), (17, 18, 20)]):
        pts[pip] = (0.4 + i * 0.05, 0.6)
        pts[tip] = (0.4 + i * 0.05, 0.3)   # tip higher -> far from wrist
    return pts


def _closed_hand():
    pts = [(0.5, 1.0)] * 21
    for i, (mcp, pip, tip) in enumerate([(5, 6, 8), (9, 10, 12), (13, 14, 16), (17, 18, 20)]):
        pts[pip] = (0.4 + i * 0.05, 0.6)
        pts[tip] = (0.4 + i * 0.05, 0.75)  # tip curled back toward wrist
    return pts


def test_fist_classification():
    assert classify_fist(_open_hand())[0] is False
    assert classify_fist(_closed_hand())[0] is True


# ---- debounce ----

def test_debounce_requires_persistence():
    d = Debouncer(up_delay=0.1, down_delay=0.1)
    assert d.update(True, 0.0) is False        # not long enough
    assert d.update(True, 0.05) is False
    assert d.update(True, 0.11) is True        # persisted past up_delay
    # jitter: a single False frame should not flip it back immediately
    assert d.update(False, 0.13) is True
    assert d.update(True, 0.14) is True


# ---- hold mode transitions + no duplicate key-down ----

def test_hold_single_down_and_up():
    inj = FakeInjector()
    eng = GestureEngine(_store("hold"), inj, up_delay=0.0, down_delay=0.0)
    eng.update({"left-fist": True}, 0.0)   # rising edge -> down
    eng.update({"left-fist": True}, 0.1)   # still held -> nothing
    eng.update({"left-fist": True}, 0.2)
    eng.update({"left-fist": False}, 0.3)  # falling edge -> up
    assert inj.events == [("down", "a"), ("up", "a")]


# ---- tap mode: one press per activation, require release ----

def test_tap_one_press_per_activation():
    inj = FakeInjector()
    eng = GestureEngine(_store("tap"), inj, up_delay=0.0, down_delay=0.0)
    eng.update({"left-fist": True}, 0.0)
    eng.update({"left-fist": True}, 0.1)   # no repeat while held
    eng.update({"left-fist": False}, 0.2)  # release re-arms
    eng.update({"left-fist": True}, 0.3)
    assert inj.events == [("tap", "a"), ("tap", "a")]


# ---- release-all on shutdown / tracking loss ----

def test_release_all_on_shutdown():
    inj = FakeInjector()
    eng = GestureEngine(_store("hold"), inj, up_delay=0.0, down_delay=0.0)
    eng.update({"left-fist": True}, 0.0)   # key down, held
    eng.release_all()                      # e.g. Ctrl+C / exit
    assert ("up", "a") in inj.events
    eng.release_all()                      # idempotent
    assert inj.events.count(("up", "a")) == 1


def test_tracking_loss_releases_key():
    inj = FakeInjector()
    eng = GestureEngine(_store("hold"), inj, up_delay=0.0, down_delay=0.1)
    eng.update({"left-fist": True}, 0.0)   # down
    # hand disappears -> raw False; after down_delay the key must release
    eng.update({}, 0.05)
    assert ("up", "a") not in inj.events   # not yet (within timeout)
    eng.update({}, 0.2)
    assert ("up", "a") in inj.events


# ---- derive gesture activity from hands (incl. raised hands) ----

def _hand(handed, is_fist, wrist_y):
    lm = [(0.5, 1.0)] * 21
    lm[0] = (0.5, wrist_y)
    return HandObs(handedness=handed, is_fist=is_fist, confidence=1.0, landmarks=lm)


def test_derive_active():
    # left fist low + right open high
    a = derive_active([_hand("left", True, 0.9), _hand("right", False, 0.2)])
    assert a["left-fist"] and not a["right-fist"]
    assert a["raise-right-hand"] and not a["raise-left-hand"]
    assert not a["both-fists"]
    # a fist is never "raised" even when high
    b = derive_active([_hand("left", True, 0.1)])
    assert b["left-fist"] and not b["raise-left-hand"]
    # both fists -> exclusive: only both-fists, singles suppressed
    c = derive_active([_hand("left", True, 0.9), _hand("right", True, 0.9)])
    assert c["both-fists"]
    assert not c["left-fist"] and not c["right-fist"]


# ---- clap-toggled joystick ----

def _at(handed, x, y):
    lm = [(0.5, 1.0)] * 21
    lm[0] = (x, y)  # wrist
    return HandObs(handedness=handed, is_fist=False, confidence=1.0, landmarks=lm)


def test_joystick_clap_toggle_and_steer():
    t = JoystickTracker(deadzone=0.06, clap_dist=0.15, cooldown=0.6)
    apart = [_at("left", 0.2, 0.5), _at("right", 0.8, 0.5)]

    # not clapped, mode off -> all directions false
    assert t.update(apart, 0.0) == {d: False for d in JoystickTracker.DIRS}

    # clap (wrists together) toggles mode on; center captured this frame
    together = [_at("left", 0.49, 0.5), _at("right", 0.51, 0.5)]
    t.update(together, 1.0)
    assert t.on
    assert t.update([_at("right", 0.51, 0.5)], 1.1) == {d: False for d in JoystickTracker.DIRS}

    # move right hand right & up past deadzone -> holds both, others false
    out = t.update([_at("right", 0.51 + 0.2, 0.5 - 0.2)], 1.2)
    assert out["joystick-right"] and out["joystick-up"]
    assert not out["joystick-left"] and not out["joystick-down"]

    # inside deadzone -> neutral
    assert not any(t.update([_at("right", 0.52, 0.51)], 1.3).values())

    # a flicker back to together within the cooldown must NOT re-toggle
    t.update(apart, 1.35)                       # release clap edge
    t.update(together, 1.4)                      # within 0.6s of last toggle
    assert t.on                                  # still on

    # clap again after cooldown toggles off -> base gestures resume
    t.update(apart, 2.0)
    t.update(together, 2.1)
    assert not t.on
    merged = t.merge({"left-fist": True}, apart, 2.2)
    assert merged["left-fist"] and not any(merged[d] for d in JoystickTracker.DIRS)


# ---- binding validation ----

def test_binding_validation():
    s = BindingStore()
    for bad in [("nope", "a", "hold"), ("left-fist", "F13", "hold"),
                ("left-fist", "a", "wiggle")]:
        try:
            s.set(*bad)
            assert False, f"expected rejection for {bad}"
        except ValueError:
            pass
    s.set("left-fist", "A", "hold")        # normalizes case
    assert s.bindings["left-fist"].key == "a"


def test_persistence_roundtrip(tmp_path=None):
    import tempfile
    p = Path(tempfile.mkdtemp()) / "bindings.json"
    s = _store()
    save(s, p)
    again = load(p)
    assert again.bindings["left-fist"].key == "a"


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} checks passed")
