const assert = require('assert')
const { parseIwChannels } = require('./networkArgs')

const IW_SAMPLE = [
  'Wiphy phy0',
  '\tBand 1:',
  '\t\tFrequencies:',
  '\t\t\t* 2412.0 MHz [1] (20.0 dBm)',
  '\t\t\t* 2472.0 MHz [13] (20.0 dBm)',
  '\t\t\t* 2484.0 MHz [14] (disabled)',
  '\tBand 2:',
  '\t\tFrequencies:',
  '\t\t\t* 5170.0 MHz [34] (disabled)',
  '\t\t\t* 5180.0 MHz [36] (20.0 dBm)',
  '\t\t\t* 5260.0 MHz [52] (20.0 dBm) (no IR, radar detection)',
  '\t\t\t* 5180.0 MHz [36] (20.0 dBm)',
  '\tSupported commands:',
  '\t\t * new_interface'
].join('\n')

describe('parseIwChannels', function () {
  it('returns enabled channels with band', function () {
    assert.deepStrictEqual(parseIwChannels(IW_SAMPLE), [
      { value: 1, freq: '2412.0', label: '1 (2412.0 MHz)', band: 'bg' },
      { value: 13, freq: '2472.0', label: '13 (2472.0 MHz)', band: 'bg' },
      { value: 36, freq: '5180.0', label: '36 (5180.0 MHz)', band: 'a' },
      { value: 52, freq: '5260.0', label: '52 (5260.0 MHz)', band: 'a' }
    ])
  })

  it('returns an empty list for empty input', function () {
    assert.deepStrictEqual(parseIwChannels(''), [])
  })
})
