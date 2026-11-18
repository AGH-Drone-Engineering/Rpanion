import os
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

try:
    from pymavlink import mavutil
    import dflogger
except ImportError:
    dflogger = None

ARMED = 128


class FakeHeartbeat:
    def __init__(self, base_mode):
        self.base_mode = base_mode


class FakeMaster:
    def probably_vehicle_heartbeat(self, msg):
        return True


@unittest.skipIf(dflogger is None, 'pymavlink not installed')
class DFLoggerTlogTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.tlogdir = os.path.join(self.tmp.name, 'telemetry')
        self.bindir = os.path.join(self.tmp.name, 'bin')
        self.logger = dflogger.DataFlashLogger(
            'udp:127.0.0.1:0', tlogdir=self.tlogdir, bindir=self.bindir)
        self.logger.master = FakeMaster()

    def tearDown(self):
        if self.logger.tlogfile is not None:
            self.logger.tlogfile.close()
        self.tmp.cleanup()

    def test_directories_created(self):
        self.assertTrue(os.path.isdir(self.tlogdir))
        self.assertTrue(os.path.isdir(self.bindir))

    def test_logdir_fallback(self):
        d = os.path.join(self.tmp.name, 'both')
        lg = dflogger.DataFlashLogger('udp:127.0.0.1:0', logdir=d)
        self.assertEqual(lg.tlogdir, d)
        self.assertEqual(lg.bindir, d)

    def test_rotates_on_disarm_only(self):
        lg = self.logger
        lg.open_tlog()
        first = lg.tlogfile.name
        # Distinct timestamp for the next file name
        with mock.patch('dflogger.datetime') as dt:
            dt.now.return_value.strftime.return_value = '2000-01-01_00-00-00'
            lg.handle_tlog_heartbeat(FakeHeartbeat(0))
            self.assertEqual(lg.tlogfile.name, first)
            lg.handle_tlog_heartbeat(FakeHeartbeat(ARMED))
            self.assertEqual(lg.tlogfile.name, first)
            lg.handle_tlog_heartbeat(FakeHeartbeat(ARMED | 1))
            self.assertEqual(lg.tlogfile.name, first)
            lg.handle_tlog_heartbeat(FakeHeartbeat(1))
        self.assertNotEqual(lg.tlogfile.name, first)
        self.assertTrue(lg.tlogfile.name.endswith('2000-01-01_00-00-00.tlog'))
        self.assertEqual(os.path.dirname(lg.tlogfile.name), self.tlogdir)

    def test_same_second_name_not_reused(self):
        lg = self.logger
        lg.open_tlog()
        first = lg.tlogfile.name
        lg.open_tlog()
        self.assertNotEqual(lg.tlogfile.name, first)
        self.assertTrue(os.path.exists(first))

    def test_non_autopilot_heartbeat_ignored(self):
        lg = self.logger
        lg.master.probably_vehicle_heartbeat = lambda m: False
        lg.open_tlog()
        first = lg.tlogfile.name
        lg.tlog_armed = True
        lg.handle_tlog_heartbeat(FakeHeartbeat(0))
        self.assertEqual(lg.tlogfile.name, first)

    def test_fsync_only_when_dirty(self):
        lg = self.logger
        lg.open_tlog()
        with mock.patch('os.fsync') as fs:
            lg.last_sync_time = time.time() - 6
            lg.sync_files()
            fs.assert_not_called()
            lg.tlog_dirty = True
            lg.last_sync_time = time.time() - 6
            lg.sync_files()
            self.assertEqual(fs.call_count, 1)
            self.assertFalse(lg.tlog_dirty)
            lg.tlog_dirty = True
            lg.sync_files()
            fs.assert_called_once()

    def test_fsync_on_rotation(self):
        lg = self.logger
        lg.open_tlog()
        with mock.patch('os.fsync') as fs:
            lg.tlog_armed = True
            lg.handle_tlog_heartbeat(FakeHeartbeat(0))
            self.assertEqual(fs.call_count, 1)


if __name__ == '__main__':
    unittest.main()
