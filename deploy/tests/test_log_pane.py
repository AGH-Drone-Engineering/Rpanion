import importlib.util
import os
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    'log_pane', os.path.join(HERE, '..', 'rpanion-terminal-log-pane.py'))
log_pane = importlib.util.module_from_spec(spec)
spec.loader.exec_module(log_pane)


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class PaneLoggerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        self.clock = Clock()

    def tearDown(self):
        self.tmp.cleanup()

    def make(self, **kw):
        kw.setdefault('clock', self.clock)
        return log_pane.PaneLogger(self.dir, '123', '%7', **kw)

    def logs(self):
        return sorted(f for f in os.listdir(self.dir) if f.endswith('.log'))

    def test_file_name_and_content(self):
        lg = self.make()
        lg.write(b'hello\r\n')
        lg.close()
        names = self.logs()
        self.assertEqual(len(names), 1)
        self.assertRegex(names[0], r'^\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d_123_p7\.log$')
        with open(os.path.join(self.dir, names[0]), 'rb') as f:
            self.assertEqual(f.read(), b'hello\r\n')
        self.assertEqual(os.stat(os.path.join(self.dir, names[0])).st_mode & 0o777, 0o644 & ~os.umask(0))

    def test_file_size_cap_splits_into_suffixed_files(self):
        lg = self.make(max_file=10)
        lg.write(b'a' * 25)
        lg.close()
        names = sorted(self.logs(), key=lambda n: (len(n), n))
        self.assertEqual(len(names), 3)
        self.assertTrue(names[0].endswith('_p7.log'))
        self.assertTrue(names[1].endswith('_p7-2.log'))
        self.assertTrue(names[2].endswith('_p7-3.log'))
        sizes = [os.path.getsize(os.path.join(self.dir, n)) for n in names]
        self.assertEqual(sizes, [10, 10, 5])

    def test_dir_cap_removes_oldest_inactive_files(self):
        for i, age in enumerate((500, 400, 300)):
            p = os.path.join(self.dir, f'old{i}.log')
            with open(p, 'wb') as f:
                f.write(b'x' * 10)
            os.utime(p, (self.clock() - age, self.clock() - age))
        recent = os.path.join(self.dir, 'recent.log')
        with open(recent, 'wb') as f:
            f.write(b'x' * 10)
        os.utime(recent, (self.clock() - 5, self.clock() - 5))
        lg = self.make(max_dir=25)
        lg.write(b'data')
        lg.close()
        names = self.logs()
        self.assertNotIn('old0.log', names)
        self.assertNotIn('old1.log', names)
        self.assertIn('recent.log', names)
        self.assertEqual(len(names), 3)

    def test_disabled_flag_discards_and_resumes(self):
        lg = self.make()
        lg.write(b'before')
        flag = os.path.join(self.dir, '.disabled')
        open(flag, 'w').close()
        self.clock.now += 6
        lg.write(b'dropped')
        self.assertIsNone(lg.fd)
        names = self.logs()
        self.assertEqual(len(names), 1)
        with open(os.path.join(self.dir, names[0]), 'rb') as f:
            self.assertEqual(f.read(), b'before')
        os.unlink(flag)
        self.clock.now += 6
        lg.write(b'after')
        lg.close()
        self.assertEqual(len(self.logs()), 2)

    def test_disabled_flag_checked_every_interval_only(self):
        lg = self.make()
        lg.write(b'a')
        open(os.path.join(self.dir, '.disabled'), 'w').close()
        self.clock.now += 1
        lg.write(b'b')
        self.assertFalse(lg.disabled)
        lg.close()

    def test_fsync_every_interval_only_with_new_data(self):
        lg = self.make()
        with mock.patch('os.fsync') as fs:
            lg.write(b'a')
            lg.write(b'b')
            self.assertEqual(fs.call_count, 0)
            self.clock.now += 5
            lg.sync()
            self.assertEqual(fs.call_count, 1)
            self.clock.now += 10
            lg.sync()
            self.assertEqual(fs.call_count, 1)
            lg.write(b'c')
            self.assertEqual(fs.call_count, 2)
            lg.close()
            self.assertEqual(fs.call_count, 2)

    def test_fsync_on_close_with_pending_data(self):
        lg = self.make()
        with mock.patch('os.fsync') as fs:
            lg.write(b'a')
            self.assertEqual(fs.call_count, 0)
            lg.close()
            self.assertEqual(fs.call_count, 1)


if __name__ == '__main__':
    unittest.main()
