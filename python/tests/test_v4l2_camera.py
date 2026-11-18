import io
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import v4l2_camera


def code(s):
    return sum(ord(c) << (8 * i) for i, c in enumerate(s))


class FakeCv2:
    CAP_V4L2 = 200
    CAP_PROP_FOURCC = 6
    CAP_PROP_FRAME_WIDTH = 3
    CAP_PROP_FRAME_HEIGHT = 4
    CAP_PROP_FPS = 5

    def __init__(self, accepted=('MJPG', 'YUYV'), default='YUYV', frames=True):
        self.accepted = accepted
        self.default = default
        self.frames = frames
        self.cams = []

    def VideoWriter_fourcc(self, *chars):
        return code(''.join(chars))

    def VideoCapture(self, path, backend):
        cam = FakeCam(self, path)
        self.cams.append(cam)
        return cam


class FakeCam:
    def __init__(self, cv2, path):
        self.cv2 = cv2
        self.path = path
        self.calls = []
        self.fourcc = code(cv2.default)
        self.released = False

    def isOpened(self):
        return True

    def set(self, prop, value):
        self.calls.append((prop, value))
        if prop == FakeCv2.CAP_PROP_FOURCC:
            if any(code(a) == value for a in self.cv2.accepted):
                self.fourcc = value
        return True

    def get(self, prop):
        return self.fourcc

    def read(self):
        return self.cv2.frames, None

    def release(self):
        self.released = True


class FourccFromFormatTest(unittest.TestCase):
    def test_camera_code_is_passed_through(self):
        self.assertEqual(v4l2_camera.fourcc_from_format('MJPG'), 'MJPG')
        self.assertEqual(v4l2_camera.fourcc_from_format('YUYV'), 'YUYV')

    def test_gstreamer_caps_names(self):
        self.assertEqual(v4l2_camera.fourcc_from_format('image/jpeg'), 'MJPG')
        self.assertEqual(v4l2_camera.fourcc_from_format('video/x-h264'), 'H264')

    def test_formats_without_camera_code(self):
        for fmt in (None, '', 'video/x-raw', 'YUV420', 'RGB888'):
            self.assertIsNone(v4l2_camera.fourcc_from_format(fmt))


class OpenV4l2Test(unittest.TestCase):
    def test_sets_fourcc_before_size(self):
        cv2 = FakeCv2()
        cam = v4l2_camera.open_v4l2(cv2, '/dev/video0', 'MJPG', 2592, 1944)
        props = [p for p, _ in cam.calls]
        self.assertEqual(props[0], FakeCv2.CAP_PROP_FOURCC)
        self.assertIn((FakeCv2.CAP_PROP_FRAME_WIDTH, 2592), cam.calls)
        self.assertIn((FakeCv2.CAP_PROP_FRAME_HEIGHT, 1944), cam.calls)
        self.assertEqual(len(cv2.cams), 1)

    def test_fps_is_set_when_given(self):
        cam = v4l2_camera.open_v4l2(FakeCv2(), '/dev/video0', 'MJPG', 640, 480, 30)
        self.assertIn((FakeCv2.CAP_PROP_FPS, 30), cam.calls)

    def test_no_fourcc_leaves_camera_default(self):
        cv2 = FakeCv2()
        cam = v4l2_camera.open_v4l2(cv2, '/dev/video0', None, 640, 480)
        self.assertNotIn(FakeCv2.CAP_PROP_FOURCC, [p for p, _ in cam.calls])

    def test_rejected_fourcc_falls_back_with_warning(self):
        cv2 = FakeCv2(accepted=('YUYV',))
        err = io.StringIO()
        with redirect_stderr(err):
            cam = v4l2_camera.open_v4l2(cv2, '/dev/video0', 'MJPG', 2592, 1944)
        self.assertEqual(len(cv2.cams), 2)
        self.assertTrue(cv2.cams[0].released)
        self.assertNotIn(FakeCv2.CAP_PROP_FOURCC, [p for p, _ in cam.calls])
        self.assertIn((FakeCv2.CAP_PROP_FRAME_WIDTH, 2592), cam.calls)
        self.assertIn('Warning', err.getvalue())
        self.assertIn('MJPG', err.getvalue())

    def test_unreadable_frames_fall_back_with_warning(self):
        cv2 = FakeCv2(frames=False)
        err = io.StringIO()
        with redirect_stderr(err):
            v4l2_camera.open_v4l2(cv2, '/dev/video0', 'MJPG', 640, 480)
        self.assertEqual(len(cv2.cams), 2)
        self.assertIn('no frame', err.getvalue())


class EnsureDirTest(unittest.TestCase):
    def test_recreates_deleted_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'media', 'sub')
            self.assertTrue(v4l2_camera.ensure_dir(path))
            os.rmdir(path)
            self.assertTrue(v4l2_camera.ensure_dir(path))
            self.assertTrue(os.path.isdir(path))

    def test_failure_is_reported_not_raised(self):
        err = io.StringIO()
        with mock.patch('os.makedirs', side_effect=PermissionError('denied')), redirect_stderr(err):
            self.assertFalse(v4l2_camera.ensure_dir('/nonexistent/x'))
        self.assertIn('denied', err.getvalue())


if __name__ == '__main__':
    unittest.main()
