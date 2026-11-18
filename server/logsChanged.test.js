const assert = require('assert')
const { EventEmitter } = require('events')
const { forwardLogsChanged } = require('./logsChanged')

describe('logs:changed forwarding', function () {
  it('emits one socket event per source event with its type', function () {
    const sent = []
    const io = { sockets: { emit: (name, payload) => sent.push([name, payload]) } }
    const video = new EventEmitter()
    const fc = new EventEmitter()
    const converter = new EventEmitter()
    forwardLogsChanged(io, [video, fc, converter])

    video.emit('logschanged', 'media')
    fc.emit('logschanged', 'telemetry')
    fc.emit('logschanged', 'bin')
    converter.emit('logschanged', 'kmz')

    assert.deepEqual(sent, [
      ['logs:changed', { type: 'media' }],
      ['logs:changed', { type: 'telemetry' }],
      ['logs:changed', { type: 'bin' }],
      ['logs:changed', { type: 'kmz' }]
    ])
  })

  it('keeps forwarding after a failed emit', function () {
    let calls = 0
    const io = { sockets: { emit: () => { calls++; if (calls === 1) throw new Error('closed') } } }
    const source = new EventEmitter()
    forwardLogsChanged(io, [source])
    source.emit('logschanged', 'media')
    source.emit('logschanged', 'media')
    assert.equal(calls, 2)
  })
})
