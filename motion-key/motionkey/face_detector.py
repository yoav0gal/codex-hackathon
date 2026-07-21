"""MediaPipe face detection -> head roll, for the head-lean gestures.

Uses the MediaPipe Tasks FaceDetector (BlazeFace). The model file is downloaded
once to ~/.motionkey/blaze_face_short_range.tflite. Frames are processed locally
only; nothing is stored or uploaded.
"""
from __future__ import annotations

import math
import urllib.request
from pathlib import Path

from .models import HeadObs

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_short_range/float16/1/blaze_face_short_range.tflite"
)
MODEL_PATH = Path.home() / ".motionkey" / "blaze_face_short_range.tflite"

# BlazeFace keypoint order: 0=right eye, 1=left eye, 2=nose, 3=mouth, 4/5=ears.
RIGHT_EYE, LEFT_EYE = 0, 1


def _ensure_model() -> Path:
    if not MODEL_PATH.exists():
        MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
        try:
            urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
        except Exception as e:  # pragma: no cover - network path
            raise RuntimeError(
                f"Could not download the face model from {MODEL_URL}: {e}"
            ) from e
    return MODEL_PATH


class FaceDetector:
    def __init__(self, min_conf: float = 0.5):
        try:
            import mediapipe as mp  # type: ignore
            from mediapipe.tasks.python import BaseOptions
            from mediapipe.tasks.python.vision import (
                FaceDetector as MPFaceDetector, FaceDetectorOptions, RunningMode,
            )
        except ImportError as e:  # pragma: no cover - env specific
            raise RuntimeError(
                "mediapipe is required for detection. Install deps (see README)."
            ) from e
        self._mp = mp
        opts = FaceDetectorOptions(
            base_options=BaseOptions(model_asset_path=str(_ensure_model())),
            running_mode=RunningMode.IMAGE,
            min_detection_confidence=min_conf,
        )
        self._fd = MPFaceDetector.create_from_options(opts)

    def detect(self, rgb_frame) -> HeadObs | None:
        """rgb_frame: already-mirrored uint8 RGB image. Returns head pose or None.

        roll_deg comes from the eye line: negative = tilted toward the user's
        left, positive = toward the right. If the two head-lean gestures feel
        swapped, flip their bindings — it's a one-line calibration.
        """
        mp_image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB,
                                  data=rgb_frame)
        res = self._fd.detect(mp_image)
        if not res.detections:
            return None
        kp = res.detections[0].keypoints
        if len(kp) <= LEFT_EYE:
            return None
        r, l = kp[RIGHT_EYE], kp[LEFT_EYE]
        # Mirrored selfie frame: the user's left eye sits at the larger x, so a
        # head tilt toward their left drives dy the negative way -> roll < 0.
        roll = math.degrees(math.atan2(l.y - r.y, l.x - r.x))
        return HeadObs(roll_deg=roll)

    def close(self) -> None:
        try:
            self._fd.close()
        except Exception:
            pass
