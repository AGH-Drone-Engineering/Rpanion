import os
import sys

# GStreamer caps names (video page recording formats) with a V4L2 FOURCC
GST_CAPS_FOURCC = {
    'image/jpeg': 'MJPG',
    'video/x-h264': 'H264',
    'video/x-h265': 'HEVC',
}


def fourcc_from_format(fmt):
    """Returns the 4-character V4L2 code for a format string, or None."""
    if not fmt:
        return None
    if fmt in GST_CAPS_FOURCC:
        return GST_CAPS_FOURCC[fmt]
    if len(fmt) == 4 and fmt.isalnum():
        return fmt
    return None


def fourcc_to_str(value):
    return ''.join(chr((int(value) >> (8 * i)) & 0xFF) for i in range(4))


def ensure_dir(path):
    """Creates the media folder; returns False when that fails."""
    try:
        os.makedirs(path, exist_ok=True)
        return True
    except OSError as e:
        print(f"Error: Could not create directory {path}: {e}", file=sys.stderr, flush=True)
        return False


def _open(cv2, path, fourcc, width, height, fps):
    cam = cv2.VideoCapture(path, cv2.CAP_V4L2)
    if not cam.isOpened():
        return cam
    if fourcc:
        cam.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*fourcc))
    cam.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cam.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    if fps:
        cam.set(cv2.CAP_PROP_FPS, fps)
    return cam


def open_v4l2(cv2, path, fourcc, width, height, fps=None):
    """Opens a V4L2 camera with the requested FOURCC; reopens with the camera default on failure."""
    cam = _open(cv2, path, fourcc, width, height, fps)
    if not fourcc or not cam.isOpened():
        return cam

    actual = fourcc_to_str(cam.get(cv2.CAP_PROP_FOURCC))
    reason = None
    if actual != fourcc:
        reason = f"camera reports {actual!r}"
    else:
        ret, _ = cam.read()
        if not ret:
            reason = "no frame could be read"
    if reason is None:
        return cam

    print(f"Warning: format {fourcc} not usable on {path} ({reason}). Using the camera default format.",
          file=sys.stderr, flush=True)
    cam.release()
    return _open(cv2, path, None, width, height, fps)
