"""MediaPipe hand landmarks + an explainable open/closed (fist) heuristic.

Uses the MediaPipe Tasks HandLandmarker (the `solutions` legacy API was removed
in recent mediapipe builds). The model file is downloaded once to
~/.motionkey/hand_landmarker.task. Frames are processed locally only; nothing is
stored or uploaded.
"""
from __future__ import annotations

import math
import urllib.request
from pathlib import Path

from .models import HandObs

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)
MODEL_PATH = Path.home() / ".motionkey" / "hand_landmarker.task"

WRIST = 0
# (mcp, pip, tip) for index, middle, ring, pinky. Thumb ignored (unreliable).
FINGERS = [(5, 6, 8), (9, 10, 12), (13, 14, 16), (17, 18, 20)]


def _dist(a, b) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def fist_score(pts) -> float:
    """Fraction (0..1) of the four fingers that are curled.

    A finger is curled when its tip sits closer to the wrist than its PIP
    joint does — i.e. it has folded back toward the palm.
    """
    wrist = pts[WRIST]
    folded = 0
    for _mcp, pip, tip in FINGERS:
        if _dist(pts[tip], wrist) < _dist(pts[pip], wrist):
            folded += 1
    return folded / len(FINGERS)


def classify_fist(pts, threshold: float = 0.75):
    """Return (is_fist, confidence, raw_score)."""
    score = fist_score(pts)
    is_fist = score >= threshold
    conf = score if is_fist else 1.0 - score
    return is_fist, conf, score


def _ensure_model() -> Path:
    if not MODEL_PATH.exists():
        MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
        try:
            urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
        except Exception as e:  # pragma: no cover - network path
            raise RuntimeError(
                f"Could not download the hand model from {MODEL_URL}: {e}"
            ) from e
    return MODEL_PATH


class HandDetector:
    def __init__(self, max_hands: int = 2, min_conf: float = 0.6,
                 fist_threshold: float = 0.75):
        try:
            import mediapipe as mp  # type: ignore
            from mediapipe.tasks.python import BaseOptions
            from mediapipe.tasks.python.vision import (
                HandLandmarker, HandLandmarkerOptions, RunningMode,
            )
        except ImportError as e:  # pragma: no cover - env specific
            raise RuntimeError(
                "mediapipe is required for detection. Install deps (see README)."
            ) from e
        self._mp = mp
        opts = HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(_ensure_model())),
            running_mode=RunningMode.IMAGE,
            num_hands=max_hands,
            min_hand_detection_confidence=min_conf,
            min_tracking_confidence=min_conf,
        )
        self._lm = HandLandmarker.create_from_options(opts)
        self.fist_threshold = fist_threshold

    # We mirror the frame (selfie view) for a natural preview. MediaPipe reports
    # handedness relative to that mirrored image, which is the OPPOSITE of the
    # user's physical hand, so we swap the label to match the real hand.
    _SWAP = {"left": "right", "right": "left"}

    def detect(self, rgb_frame) -> list[HandObs]:
        """rgb_frame: an already-mirrored uint8 RGB image. Returns detected hands.

        `handedness` is the user's PHYSICAL hand (label swapped to undo mirror).
        """
        mp_image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB,
                                  data=rgb_frame)
        res = self._lm.detect(mp_image)
        out: list[HandObs] = []
        for i, lm in enumerate(res.hand_landmarks or []):
            pts = [(p.x, p.y) for p in lm]
            label = "right"
            if res.handedness and i < len(res.handedness):
                raw = res.handedness[i][0].category_name.lower()
                label = self._SWAP.get(raw, raw)
            is_fist, conf, _ = classify_fist(pts, self.fist_threshold)
            out.append(HandObs(handedness=label, is_fist=is_fist,
                               confidence=conf, landmarks=pts))
        return out

    def close(self) -> None:
        try:
            self._lm.close()
        except Exception:
            pass
