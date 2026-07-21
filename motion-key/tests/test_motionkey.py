"""Runnable checks: pytest OR `python tests/test_motionkey.py`.

Covers fist transitions, debouncing, binding validation, and the guarantee
that all held keys release on shutdown / tracking loss. No camera, no pyobjc.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from motionkey.bindings import BindingStore, load, save
from motionkey.gesture_engine import Debouncer, GestureEngine, derive_active
from motionkey.models import HandObs
from motionkey.hand_detector import classify_fist, classify_static_gestures


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


def _with_thumb(pts, tip):
    pts = list(pts)
    pts[1] = (0.5, 0.65)
    pts[2] = (0.5, 0.58)
    pts[3] = ((pts[2][0] + tip[0]) / 2, (pts[2][1] + tip[1]) / 2)
    pts[4] = tip
    return pts


def _pointing_up_hand():
    pts = _closed_hand()
    pts[6] = (0.4, 0.56)
    pts[8] = (0.4, 0.24)
    return pts


def _victory_hand():
    pts = _closed_hand()
    pts[6] = (0.4, 0.56)
    pts[8] = (0.4, 0.24)
    pts[10] = (0.45, 0.56)
    pts[12] = (0.45, 0.22)
    return pts


def _i_love_you_hand():
    pts = _closed_hand()
    pts[6] = (0.4, 0.56)
    pts[8] = (0.4, 0.24)
    pts[18] = (0.55, 0.56)
    pts[20] = (0.55, 0.24)
    return _with_thumb(pts, (0.22, 0.58))


def _thumb_hand(direction):
    pts = _closed_hand()
    return _with_thumb(pts, (0.5, 0.25 if direction == "up" else 0.9))


def test_fist_classification():
    assert classify_fist(_open_hand())[0] is False
    assert classify_fist(_closed_hand())[0] is True


def test_static_gesture_classification():
    assert "open-palm" in classify_static_gestures(_open_hand())
    assert classify_static_gestures(_pointing_up_hand()) == {"pointing-up"}
    assert classify_static_gestures(_victory_hand()) == {"victory"}
    assert "i-love-you" in classify_static_gestures(_i_love_you_hand())
    assert classify_static_gestures(_thumb_hand("up")) == {"thumb-up"}
    assert classify_static_gestures(_thumb_hand("down")) == {"thumb-down"}


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


def test_derive_active_added_static_gestures():
    assert derive_active([HandObs("right", False, 1.0, _pointing_up_hand())])["pointing-up"]
    assert derive_active([HandObs("right", False, 1.0, _victory_hand())])["victory"]
    assert derive_active([HandObs("right", False, 1.0, _i_love_you_hand())])["i-love-you"]
    assert derive_active([HandObs("right", False, 1.0, _thumb_hand("up"))])["thumb-up"]
    assert derive_active([HandObs("right", False, 1.0, _thumb_hand("down"))])["thumb-down"]


def test_left_fist_right_finger_joystick():
    active = derive_active([
        HandObs("left", True, 1.0, _closed_hand()),
        HandObs("right", False, 1.0, _pointing_up_hand()),
    ])

    assert active["left-fist-right-finger-up"]
    assert not active["left-fist"]

    right = _pointing_up_hand()
    right[5] = (0.5, 0.5)
    right[8] = (0.1, 0.5)
    active = derive_active([
        HandObs("left", True, 1.0, _closed_hand()),
        HandObs("right", False, 1.0, right),
    ])
    assert active["left-fist-right-finger-right"]


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
    s.set("victory", "right", "tap")
    assert s.bindings["victory"].key == "right"


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
