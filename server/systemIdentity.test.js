const assert = require('assert')
const { createSystemIdentity } = require('./systemIdentity')

// execFile stub recording calls; `failWith` makes the helper exit non-zero
function stubExec ({ failWith } = {}) {
  const calls = []
  const execFile = (cmd, args, callback) => {
    const call = { cmd, args, stdin: undefined }
    calls.push(call)
    setImmediate(() => {
      if (failWith) callback(new Error('exit 2'), '', failWith)
      else callback(null, '', '')
    })
    return { stdin: { end: (data) => { call.stdin = data } } }
  }
  return { execFile, calls }
}

describe('systemIdentity', function () {
  it('getIdentity returns the system hostname and the SSH user', function () {
    const { execFile } = stubExec()
    const identity = createSystemIdentity({ execFile, getHostname: () => 'rpanion' })
    assert.deepStrictEqual(identity.getIdentity(), { hostname: 'rpanion', sshUser: 'pi' })
  })

  it('setHostname calls the helper through sudo with the name as argument', async function () {
    const { execFile, calls } = stubExec()
    await createSystemIdentity({ execFile }).setHostname('rpanion-07')
    assert.strictEqual(calls.length, 1)
    assert.strictEqual(calls[0].cmd, 'sudo')
    assert.deepStrictEqual(calls[0].args, ['-n', '/usr/local/sbin/rpanion-system', 'hostname', 'rpanion-07'])
  })

  it('setHostname rejects invalid names with status 422 and does not run the helper', async function () {
    const { execFile, calls } = stubExec()
    const identity = createSystemIdentity({ execFile })
    for (const name of ['', 'Rpanion', '-drone', 'drone-', 'dro ne', 'dro_ne', 'a.b', 'x'.repeat(33), 'drone; reboot', 'localhost', '1234', undefined, 5]) {
      await assert.rejects(identity.setHostname(name), (err) => err.status === 422, `name: ${String(name)}`)
    }
    assert.strictEqual(calls.length, 0)
  })

  it('setHostname accepts a 32 character name and digits mixed with letters', async function () {
    const { execFile, calls } = stubExec()
    const identity = createSystemIdentity({ execFile })
    await identity.setHostname('a'.repeat(32))
    await identity.setHostname('7drones')
    assert.strictEqual(calls.length, 2)
  })

  it('setHostname rejects with the helper stderr text on failure', async function () {
    const { execFile } = stubExec({ failWith: 'Failed to set hostname\n' })
    await assert.rejects(createSystemIdentity({ execFile }).setHostname('rpanion-07'), /Failed to set hostname/)
  })

  it('setSshPassword sends the password on stdin, not in argv', async function () {
    const { execFile, calls } = stubExec()
    await createSystemIdentity({ execFile }).setSshPassword('s3cret-pass')
    assert.deepStrictEqual(calls[0].args, ['-n', '/usr/local/sbin/rpanion-system', 'sshpassword'])
    assert.strictEqual(calls[0].stdin, 's3cret-pass\n')
  })

  it('setSshPassword rejects too short, too long and control characters', async function () {
    const { execFile, calls } = stubExec()
    const identity = createSystemIdentity({ execFile })
    for (const pw of ['short', 'x'.repeat(65), 'valid-pass\nroot:x', 'tab\tpassword', '', undefined]) {
      await assert.rejects(identity.setSshPassword(pw), (err) => err.status === 422)
    }
    assert.strictEqual(calls.length, 0)
  })
})
