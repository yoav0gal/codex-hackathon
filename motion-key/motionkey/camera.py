"""Local webcam capture + optional OpenCV preview. Frames never leave the machine."""
from __future__ import annotations


class CameraError(RuntimeError):
    pass


class Camera:
    def __init__(self, index: int = 0):
        try:
            import cv2  # type: ignore
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("opencv-python is required (see README).") from e
        self.cv2 = cv2
        self.cap = cv2.VideoCapture(index)
        if not self.cap.isOpened():
            raise CameraError(
                f"Cannot open camera {index}. Check it is connected and that "
                "the terminal has Camera permission in System Settings."
            )

    def read_mirrored_rgb(self):
        """Return (bgr_mirror, rgb_mirror) or (None, None) on a dropped frame.

        Frame is mirrored horizontally (selfie view) so MediaPipe handedness
        maps to the user's physical hands and the preview feels natural.
        """
        ok, frame = self.cap.read()
        if not ok:
            return None, None
        bgr = self.cv2.flip(frame, 1)
        rgb = self.cv2.cvtColor(bgr, self.cv2.COLOR_BGR2RGB)
        return bgr, rgb

    def show(self, bgr, hands, stable_state) -> bool:
        """Draw detection state; return False if the user pressed q/ESC."""
        cv2 = self.cv2
        y = 24
        for h in hands:
            txt = f"{h.handedness}: {'FIST' if h.is_fist else 'open'} ({h.confidence:.2f})"
            cv2.putText(bgr, txt, (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                        (0, 255, 0) if h.is_fist else (200, 200, 200), 2)
            y += 26
        active = ", ".join(g for g, on in stable_state.items() if on) or "none"
        cv2.putText(bgr, f"active: {active}", (10, y + 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 255), 2)
        cv2.imshow("MotionKey (q to quit)", bgr)
        k = cv2.waitKey(1) & 0xFF
        return k not in (ord("q"), 27)

    def release(self) -> None:
        try:
            self.cap.release()
            self.cv2.destroyAllWindows()
        except Exception:
            pass
