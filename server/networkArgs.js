/*
 * Pure helpers that translate between NetworkManager/iw output and the
 * settings used by networkManager.js. No process execution here.
 */

// Parses `iw list` / `iw phy` frequency lines such as
// "* 2412.0 MHz [1] (20.0 dBm)". Disabled channels are skipped and
// duplicates (several phys) are removed.
function parseIwChannels (iwText) {
  const channels = []
  const seen = new Set()
  for (const line of iwText.split('\n')) {
    const match = line.trim().match(/^\*\s+([\d.]+)\s+MHz\s+\[(\d+)\](.*)$/)
    if (!match || /\(disabled\)/.test(match[3])) continue
    const value = parseInt(match[2], 10)
    if (seen.has(value)) continue
    seen.add(value)
    channels.push({
      value,
      freq: match[1],
      label: `${value} (${match[1]} MHz)`,
      band: parseFloat(match[1]) < 3000 ? 'bg' : 'a'
    })
  }
  return channels
}

module.exports = { parseIwChannels }
