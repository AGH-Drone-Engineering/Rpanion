#!/usr/bin/env python3
"""Writes the text of one tmux pane to a file in the terminal log directory.

Started by pipe-pane from log.conf: log-pane.py <tmux pid> <pane id>
"""

import os
import re
import select
import sys
import time
from datetime import datetime

LOG_DIR = os.environ.get('RPANION_TERMINAL_LOG_DIR', '/etc/rpanion-server/logs/terminal')
MAX_FILE_BYTES = int(os.environ.get('RPANION_TERMINAL_LOG_MAX_FILE', 20 * 1024 * 1024))
MIN_FREE_BYTES = int(os.environ.get('RPANION_TERMINAL_LOG_MIN_FREE', 2 * 1024 ** 3))
SYNC_INTERVAL = 5
LOG_NAME = re.compile(r'^\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d_(\d+)_p(\d+)(?:-(\d+))?\.log$')


class PaneLogger:
    def __init__(self, directory, tmux_pid, pane_id, max_file=MAX_FILE_BYTES, min_free=MIN_FREE_BYTES,
                 sync_interval=SYNC_INTERVAL, clock=time.time, statvfs=os.statvfs):
        self.directory = directory
        self.pane = re.sub(r'\D', '', pane_id) or '0'
        self.tmux_pid = tmux_pid
        self.max_file = max_file
        self.min_free = min_free
        self.statvfs = statvfs
        self.sync_interval = sync_interval
        self.clock = clock
        self.fd = None
        self.size = 0
        self.seq = 0
        self.stamp = None
        self.path = None
        self.dirty = False
        self.disabled = False
        self.paused = False
        self.last_space_check = None
        self.last_sync = clock()
        self.last_flag_check = 0

    def flag_path(self):
        return os.path.join(self.directory, '.disabled')

    def check_flag(self, force=False):
        now = self.clock()
        if not force and now - self.last_flag_check < self.sync_interval:
            return
        self.last_flag_check = now
        self.disabled = os.path.exists(self.flag_path())
        if self.disabled:
            self.close()

    def free_bytes(self):
        st = self.statvfs(self.directory)
        return st.f_bavail * st.f_frsize

    def deletable_files(self):
        parsed = []
        for name in os.listdir(self.directory):
            m = LOG_NAME.match(name)
            if not m:
                continue
            path = os.path.join(self.directory, name)
            try:
                mtime = os.stat(path).st_mtime
            except OSError:
                continue
            parsed.append((m.group(1), m.group(2), int(m.group(3) or 1), mtime, path))
        newest = {}
        for pid, pane, seq, _, _ in parsed:
            if pid == self.tmux_pid and seq > newest.get(pane, 0):
                newest[pane] = seq
        files = [(mtime, path) for pid, pane, seq, mtime, path in parsed
                 if not (pid == self.tmux_pid and seq == newest[pane]) and path != self.path]
        return [path for _, path in sorted(files)]

    # Deletes the oldest unused logs until free space reaches min_free; False if it cannot
    def ensure_free_space(self):
        if self.free_bytes() >= self.min_free:
            return True
        for path in self.deletable_files():
            try:
                os.unlink(path)
            except OSError:
                continue
            if self.free_bytes() >= self.min_free:
                return True
        return False

    def check_space(self, force=False):
        now = self.clock()
        if not force and self.last_space_check is not None and now - self.last_space_check < self.sync_interval:
            return
        self.last_space_check = now
        self.paused = not self.ensure_free_space()

    def open_next(self):
        self.close()
        if self.stamp is None:
            self.stamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
        self.check_space(force=True)
        if self.paused:
            return False
        while True:
            self.seq += 1
            suffix = '' if self.seq == 1 else f'-{self.seq}'
            path = os.path.join(self.directory, f'{self.stamp}_{self.tmux_pid}_p{self.pane}{suffix}.log')
            try:
                self.fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
                break
            except FileExistsError:
                continue
        self.path = path
        self.size = 0
        self.dirty = False
        return True

    def write(self, data):
        self.check_flag()
        if self.disabled:
            return
        self.check_space()
        while data and not self.paused:
            if self.fd is None or self.size >= self.max_file:
                if not self.open_next():
                    return
            chunk = data[:self.max_file - self.size]
            os.write(self.fd, chunk)
            self.size += len(chunk)
            self.dirty = True
            data = data[len(chunk):]
        self.sync()

    def sync(self, force=False):
        now = self.clock()
        if self.fd is None or not self.dirty:
            return
        if force or now - self.last_sync >= self.sync_interval:
            os.fsync(self.fd)
            self.dirty = False
            self.last_sync = now

    def close(self):
        if self.fd is not None:
            try:
                self.sync(force=True)
            finally:
                os.close(self.fd)
                self.fd = None


def main():
    if len(sys.argv) != 3:
        sys.exit('usage: log-pane.py <tmux pid> <pane id>')
    logger = PaneLogger(LOG_DIR, sys.argv[1], sys.argv[2])
    stdin = sys.stdin.fileno()
    logger.check_flag(force=True)
    try:
        while True:
            ready, _, _ = select.select([stdin], [], [], 1)
            if ready:
                data = os.read(stdin, 65536)
                if not data:
                    break
                logger.write(data)
            else:
                logger.check_flag()
                logger.check_space()
                logger.sync()
    finally:
        logger.close()


if __name__ == '__main__':
    main()
