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
MAX_DIR_BYTES = int(os.environ.get('RPANION_TERMINAL_LOG_MAX_DIR', 200 * 1024 * 1024))
SYNC_INTERVAL = 5
RECENT_SECONDS = 60


class PaneLogger:
    def __init__(self, directory, tmux_pid, pane_id, max_file=MAX_FILE_BYTES, max_dir=MAX_DIR_BYTES,
                 sync_interval=SYNC_INTERVAL, clock=time.time):
        self.directory = directory
        self.pane = re.sub(r'\D', '', pane_id) or '0'
        self.tmux_pid = tmux_pid
        self.max_file = max_file
        self.max_dir = max_dir
        self.sync_interval = sync_interval
        self.clock = clock
        self.fd = None
        self.size = 0
        self.seq = 0
        self.stamp = None
        self.path = None
        self.dirty = False
        self.disabled = False
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

    def log_files(self):
        files = []
        for name in os.listdir(self.directory):
            if not name.endswith('.log'):
                continue
            path = os.path.join(self.directory, name)
            try:
                st = os.stat(path)
            except OSError:
                continue
            files.append((st.st_mtime, st.st_size, path))
        return sorted(files)

    def enforce_dir_limit(self):
        files = self.log_files()
        total = sum(f[1] for f in files)
        now = self.clock()
        for mtime, size, path in files:
            if total <= self.max_dir:
                break
            if path == self.path or now - mtime < RECENT_SECONDS:
                continue
            try:
                os.unlink(path)
                total -= size
            except OSError:
                pass

    def open_next(self):
        self.close()
        if self.stamp is None:
            self.stamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
        self.enforce_dir_limit()
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

    def write(self, data):
        self.check_flag()
        if self.disabled:
            return
        while data:
            if self.fd is None or self.size >= self.max_file:
                self.open_next()
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
                logger.sync()
    finally:
        logger.close()


if __name__ == '__main__':
    main()
