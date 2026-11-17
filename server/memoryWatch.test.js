const assert = require('assert')
const { createOomWatch } = require('./memoryWatch')

describe('oom watch', function () {
  function setup (readings) {
    const kills = []
    const queue = [...readings]
    const watch = createOomWatch({
      readOomKills: async () => { const v = queue.shift(); if (v instanceof Error) throw v; return v },
      onKill: (delta, total) => kills.push([delta, total])
    })
    return { watch, kills }
  }

  it('uses the first reading as the baseline', async function () {
    const { watch, kills } = setup([3, 3])
    await watch.check()
    await watch.check()
    assert.deepStrictEqual(kills, [])
  })

  it('reports each increase once', async function () {
    const { watch, kills } = setup([0, 1, 1, 3, 3])
    for (let i = 0; i < 5; i++) await watch.check()
    assert.deepStrictEqual(kills, [[1, 1], [2, 3]])
  })

  it('ignores an unavailable counter and read errors', async function () {
    const { watch, kills } = setup([null, 0, new Error('boom'), 0, 1])
    const errors = console.error
    console.error = () => {}
    try {
      for (let i = 0; i < 5; i++) await watch.check()
    } finally {
      console.error = errors
    }
    assert.deepStrictEqual(kills, [[1, 1]])
  })

  it('start() and stop() do not leave a timer behind', async function () {
    const { watch } = setup([0, 0, 0])
    watch.start()
    watch.start()
    watch.stop()
  })
})
