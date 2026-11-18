/*
 * Polls the oom_kill counter of the session slice and reports each increase. The first reading
 * is the baseline, so kills from before this process started are not reported.
 */
function createOomWatch ({ readOomKills, onKill, intervalMs = 5000 }) {
  let last = null
  let timer = null
  let reading = false

  async function check () {
    if (reading) return
    reading = true
    try {
      const count = await readOomKills()
      if (count === null || count === undefined) return
      if (last !== null && count > last) {
        onKill(count - last, count)
      }
      last = count
    } catch (err) {
      console.error(`Reading oom_kill failed: ${err.message || err}`)
    } finally {
      reading = false
    }
  }

  return {
    check,
    start () {
      if (timer) return
      check()
      timer = setInterval(check, intervalMs)
      timer.unref()
    },
    stop () {
      clearInterval(timer)
      timer = null
    }
  }
}

module.exports = { createOomWatch }
