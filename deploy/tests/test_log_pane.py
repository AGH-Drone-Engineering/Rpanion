import importlib.util
import os
import sys
import tempfile
import types
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


class FakeDisk:
    def __init__(self, free):
        self.free = free
        self.calls = 0

    def __call__(self, path):
        self.calls += 1
        return types.SimpleNamespace(f_bavail=self.free, f_frsize=1)


class PaneLoggerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        self.clock = Clock()

    def tearDown(self):
        self.tmp.cleanup()

    def make(self, **kw):
        kw.setdefault('clock', self.clock)
        kw.setdefault('statvfs', FakeDisk(10 ** 12))
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

    def touch(self, name, age, size=10):
        p = os.path.join(self.dir, name)
        with open(p, 'wb') as f:
            f.write(b'x' * size)
        os.utime(p, (self.clock() - age, self.clock() - age))
        return p

    def disk_freed_by_deletion(self, start):
        # Free space grows by the file size on every unlink
        disk = FakeDisk(start)
        real_unlink = os.unlink

        def unlink(path):
            disk.free += os.path.getsize(path)
            real_unlink(path)
        return disk, unlink

    def test_free_space_rule_deletes_oldest_unused_files_first(self):
        self.touch('2026-01-01_00-00-00_100_p1.log', 500)
        self.touch('2026-01-02_00-00-00_100_p1.log', 400)
        self.touch('2026-01-03_00-00-00_999_p2.log', 300)
        disk, unlink = self.disk_freed_by_deletion(95)
        lg = self.make(min_free=100, statvfs=disk)
        with mock.patch('os.unlink', unlink):
            lg.write(b'data')
        lg.close()
        names = self.logs()
        self.assertNotIn('2026-01-01_00-00-00_100_p1.log', names)
        self.assertIn('2026-01-02_00-00-00_100_p1.log', names)
        self.assertIn('2026-01-03_00-00-00_999_p2.log', names)
        self.assertFalse(lg.paused)

    def test_newest_file_of_each_pane_of_this_tmux_server_is_kept(self):
        old_part = '2026-01-01_00-00-00_123_p1.log'
        new_part = '2026-01-01_00-00-00_123_p1-2.log'
        other_pane = '2026-01-01_00-00-00_123_p2.log'
        other_pid = '2026-01-01_00-00-00_456_p1.log'
        for name, age in ((old_part, 500), (new_part, 400), (other_pane, 450), (other_pid, 300)):
            self.touch(name, age)
        lg = self.make(min_free=10 ** 13, statvfs=FakeDisk(0))
        lg.write(b'data')
        self.assertTrue(lg.paused)
        self.assertEqual(sorted(self.logs()), sorted([new_part, other_pane]))

    def test_pauses_discarding_data_until_space_returns(self):
        disk = FakeDisk(50)
        lg = self.make(min_free=100, statvfs=disk)
        lg.write(b'lost')
        self.assertTrue(lg.paused)
        self.assertEqual(self.logs(), [])
        self.clock.now += 6
        lg.write(b'still lost')
        self.assertEqual(self.logs(), [])
        disk.free = 200
        self.clock.now += 6
        lg.write(b'kept')
        lg.close()
        self.assertFalse(lg.paused)
        names = self.logs()
        self.assertEqual(len(names), 1)
        with open(os.path.join(self.dir, names[0]), 'rb') as f:
            self.assertEqual(f.read(), b'kept')

    def test_space_checked_on_tick_while_file_is_open(self):
        disk = FakeDisk(500)
        lg = self.make(min_free=100, statvfs=disk)
        lg.write(b'a')
        disk.free = 10
        lg.write(b'b')
        self.assertFalse(lg.paused)
        self.clock.now += 6
        lg.check_space()
        self.assertTrue(lg.paused)
        lg.write(b'c')
        lg.close()
        with open(os.path.join(self.dir, self.logs()[0]), 'rb') as f:
            self.assertEqual(f.read(), b'ab')

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
