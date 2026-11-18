const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createTerminalLogs, stripAnsi } = require('./terminalLogs')

describe('terminal logs', function () {
  let dir

  beforeEach(function () {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'termlogs-'))
  })

  afterEach(function () {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const put = (name, text = 'x') => fs.writeFileSync(path.join(dir, name), text)
  const A = '2026-11-18_10-00-00_812_p0.log'
  const A2 = '2026-11-18_10-00-00_812_p0-2.log'
  const B = '2026-11-18_10-05-00_812_p3.log'
  const OLD = '2026-11-17_09-00-00_500_p0.log'

  describe('stripAnsi()', function () {
    it('removes colour, cursor and title sequences', function () {
      assert.strictEqual(stripAnsi('\x1b[01;32mpi@host\x1b[00m:\x1b[01;34m~\x1b[00m$ ls\x1b[K'), 'pi@host:~$ ls')
      assert.strictEqual(stripAnsi('\x1b]0;title\x07prompt\x1b[?2004h'), 'prompt')
      assert.strictEqual(stripAnsi('\x1b]0;title\x1b\\prompt'), 'prompt')
      assert.strictEqual(stripAnsi('\x1b(Btext\x1b='), 'text')
    })

    it('keeps CRLF and lets a bare CR overwrite the line', function () {
      assert.strictEqual(stripAnsi('one\r\ntwo\r\n'), 'one\r\ntwo\r\n')
      assert.strictEqual(stripAnsi('10%\r50%\r100%\r\nnext'), '100%\r\nnext')
      assert.strictEqual(stripAnsi('hello\rHE\r\n'), 'HEllo\r\n')
    })

    it('applies backspace and drops other control characters', function () {
      assert.strictEqual(stripAnsi('abc\b\bX\x07\x00'), 'aXc')
      assert.strictEqual(stripAnsi('a\tb'), 'a\tb')
    })
  })

  describe('files', function () {
    it('lists only log files, newest first', async function () {
      put(OLD)
      put(B)
      put('notes.txt')
      put('.disabled')
      fs.utimesSync(path.join(dir, OLD), 1000, 1000)
      const logs = createTerminalLogs({ dir })
      assert.deepStrictEqual((await logs.list()).map(f => f.name), [B, OLD])
    })

    it('returns an empty list when the directory is missing', async function () {
      const logs = createTerminalLogs({ dir: path.join(dir, 'missing') })
      assert.deepStrictEqual(await logs.list(), [])
      assert.deepStrictEqual(await logs.clear(), { deleted: 0, skipped: 0 })
    })

    it('marks the newest file of a piped pane as active', async function () {
      put(A)
      put(A2)
      put(B)
      put(OLD)
      const logs = createTerminalLogs({
        dir,
        listPanes: async () => [{ pid: '812', pane: '0', piped: true }, { pid: '812', pane: '3', piped: false }]
      })
      const active = (await logs.list()).filter(f => f.active).map(f => f.name)
      assert.deepStrictEqual(active, [A2])
    })

    it('clear() keeps active files and counts them', async function () {
      put(A)
      put(A2)
      put(B)
      put(OLD)
      put('.disabled')
      const logs = createTerminalLogs({ dir, listPanes: async () => [{ pid: '812', pane: '3', piped: true }] })
      assert.deepStrictEqual(await logs.clear(), { deleted: 3, skipped: 1 })
      assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['.disabled', B])
    })

    it('treats every file as inactive when no tmux server is running', async function () {
      put(A)
      for (const message of ['no server running on /run/x.sock', 'error connecting to /run/x.sock (No such file or directory)']) {
        const logs = createTerminalLogs({ dir, listPanes: async () => { throw new Error(message) } })
        assert.deepStrictEqual(await logs.list().then(l => l.map(f => f.active)), [false])
      }
      const logs = createTerminalLogs({ dir, listPanes: async () => { throw new Error('no server running') } })
      assert.deepStrictEqual(await logs.clear(), { deleted: 1, skipped: 0 })
    })

    it('clear() fails without deleting and list() marks all active on other tmux errors', async function () {
      put(A)
      put(B)
      const logs = createTerminalLogs({ dir, listPanes: async () => { throw new Error('sudo: a password is required') } })
      await assert.rejects(() => logs.clear(), /password is required/)
      assert.strictEqual(fs.readdirSync(dir).length, 2)
      assert.deepStrictEqual((await logs.list()).map(f => f.active), [true, true])
    })

    it('skips files that vanish while listing', async function () {
      put(A)
      put(B)
      const realStat = fs.statSync
      fs.statSync = (p, ...rest) => {
        if (String(p).endsWith(B)) {
          const e = new Error('gone')
          e.code = 'ENOENT'
          throw e
        }
        return realStat(p, ...rest)
      }
      try {
        const logs = createTerminalLogs({ dir })
        assert.deepStrictEqual((await logs.list()).map(f => f.name), [A])
        assert.deepStrictEqual(await logs.clear(), { deleted: 1, skipped: 0 })
      } finally {
        fs.statSync = realStat
      }
    })
  })

  describe('setting', function () {
    it('is enabled unless .disabled exists', function () {
      const logs = createTerminalLogs({ dir })
      assert.strictEqual(logs.isEnabled(), true)
      logs.setEnabled(false)
      assert.ok(fs.existsSync(path.join(dir, '.disabled')))
      assert.strictEqual(logs.isEnabled(), false)
      logs.setEnabled(false)
      logs.setEnabled(true)
      assert.strictEqual(logs.isEnabled(), true)
      logs.setEnabled(true)
    })
  })

  describe('read()', function () {
    const slurp = (stream) => new Promise((resolve, reject) => {
      let out = ''
      stream.on('data', c => { out += c })
      stream.on('end', () => resolve(out))
      stream.on('error', reject)
    })

    it('streams the text without escape sequences', async function () {
      put(A, '\x1b[1mbold\x1b[0m\r\nline\r\n10%\r100%\r\ntail')
      assert.strictEqual(await slurp(createTerminalLogs({ dir }).read(A)), 'bold\r\nline\r\n100%\r\ntail')
    })

    it('keeps multibyte characters and long files intact', async function () {
      const line = 'zażółć gęślą jaźń\r\n'
      put(A, line.repeat(20000))
      assert.strictEqual(await slurp(createTerminalLogs({ dir }).read(A)), line.repeat(20000))
    })

    it('rejects names that are not log files and reports a missing file', function () {
      const logs = createTerminalLogs({ dir })
      for (const name of ['../x.log', 'a.log', '.disabled', `${A}/..`, undefined]) {
        assert.throws(() => logs.read(name), (e) => e.status === 400)
      }
      assert.throws(() => logs.read(B), (e) => e.status === 404)
    })
  })
})
