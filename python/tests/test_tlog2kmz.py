import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import tlog2kmz


class ConvertTlogFilesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = os.path.join(self.tmp.name, 'telemetry')
        self.kmzdir = os.path.join(self.tmp.name, 'kmz')
        os.makedirs(self.folder)
        os.makedirs(self.kmzdir)

    def tearDown(self):
        self.tmp.cleanup()

    def touch(self, directory, name):
        path = os.path.join(directory, name)
        open(path, 'w').close()
        return path

    def convert(self, ctimes):
        converted = []

        def fake_run(cmd, *args, **kwargs):
            if isinstance(cmd, list):
                converted.append(os.path.basename(cmd[-1]))

        with mock.patch('tlog2kmz.run_cmd', fake_run), \
                mock.patch('tlog2kmz.mavtogpx_filepath', return_value='mavtogpx.py'), \
                mock.patch('os.path.getctime', lambda p: ctimes[os.path.basename(p)]):
            tlog2kmz.convert_tlog_files(self.folder, self.kmzdir)
        return converted

    def test_suffixed_name_is_not_confused_with_base_name(self):
        for name in ('a.tlog', 'a-2.tlog', 'b.tlog'):
            self.touch(self.folder, name)
        self.touch(self.kmzdir, 'a-2.tlog.kmz')
        converted = self.convert({'a.tlog': 1, 'a-2.tlog': 2, 'b.tlog': 3})
        self.assertEqual(converted, ['a.tlog'])

    def test_latest_file_is_skipped_by_exact_name(self):
        self.touch(self.folder, 'a.tlog')
        self.touch(self.folder, 'a-2.tlog')
        converted = self.convert({'a.tlog': 1, 'a-2.tlog': 2})
        self.assertEqual(converted, ['a.tlog'])


if __name__ == '__main__':
    unittest.main()
