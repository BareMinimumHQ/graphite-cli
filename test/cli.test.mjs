import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { inflateSync } from 'node:zlib'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { findChromium } from '../src/browser.mjs'

const run = promisify(execFile)
const cli = fileURLToPath(new URL('../bin/graphite.mjs', import.meta.url))
const fixture = (name) =>
  fileURLToPath(new URL(`fixtures/${name}`, import.meta.url))
const chromium = await findChromium().catch(() => undefined)
const needsBrowser = chromium
  ? {}
  : { skip: 'No Chromium found; set GRAPHITE_CHROMIUM to run browser tests' }

async function graphite(...args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [cli, ...args])
    return { code: 0, stdout, stderr }
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr }
  }
}

/** Reads width, height and the first pixel. The first pixel of row 0 is unfiltered under every PNG filter. */
function readPng(buffer) {
  assert.equal(buffer.subarray(1, 4).toString(), 'PNG')
  const width = buffer.readUInt32BE(16),
    height = buffer.readUInt32BE(20)
  assert.equal(buffer[24], 8, 'bit depth')
  assert.equal(buffer[25], 6, 'RGBA colour type')
  const chunks = []
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset)
    if (buffer.toString('latin1', offset + 4, offset + 8) === 'IDAT')
      chunks.push(buffer.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }
  const data = inflateSync(Buffer.concat(chunks))
  return { width, height, firstPixel: [...data.subarray(1, 5)] }
}

let dir
test.before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'graphite-cli-'))
})
test.after(() => rm(dir, { recursive: true, force: true }))

test('usage errors exit nonzero before starting a browser', async () => {
  for (const [args, message] of [
    [[], /exactly one input/],
    [[fixture('pebble.svg')], /--output is required/],
    [[fixture('pebble.svg'), '-o', 'x.jpg'], /\.png/],
    [[fixture('pebble.svg'), '-o', 'x.png', '-w', '0'], /--width/],
    [[fixture('pebble.svg'), '-o', 'x.png', '-h', '9000'], /--height/],
    [
      [
        fixture('pebble.svg'),
        '-o',
        'x.png',
        '-h',
        '6302',
        '--chromium',
        '/no/browser',
      ],
      /--height 6302 implies a width of 8193.*Pass --width/,
    ],
    [[fixture('pebble.svg'), '-o', 'x.png', '-b', 'chalk'], /Unknown brush/],
    [['missing.svg', '-o', 'x.png'], /Cannot read missing\.svg/],
    [[fixture('pebble.svg'), '-o', 'x.png', '--nope'], /Unknown option/],
    [
      [fixture('pebble.svg'), '-o', 'x.png', '--chromium', '/no/browser'],
      /No executable browser/,
    ],
  ]) {
    const result = await graphite(...args)
    assert.equal(result.code, 1, args.join(' '))
    assert.match(result.stderr, message)
  }
  const help = await graphite('--help')
  assert.equal(help.code, 0)
  assert.match(help.stdout, /Usage: graphite/)
  assert.match(help.stdout, /--gpu/)
})

test(
  '--gpu falls back to software WebGL with a warning',
  process.platform === 'win32'
    ? { skip: 'Uses a POSIX shell wrapper' }
    : needsBrowser,
  async () => {
    // --disable-gpu forces the fallback, whatever this machine has.
    const wrapper = join(dir, 'no-gpu.sh')
    await writeFile(
      wrapper,
      `#!/bin/sh\nexec "${chromium}" --disable-gpu "$@"\n`,
    )
    await chmod(wrapper, 0o755)
    const output = join(dir, 'gpu.png')
    const result = await graphite(
      fixture('pebble.svg'),
      '-o',
      output,
      '-w',
      '64',
      '--gpu',
      '--chromium',
      wrapper,
    )
    assert.equal(result.code, 0, result.stderr)
    assert.equal(readPng(await readFile(output)).width, 64)
    assert.match(result.stderr, /no GPU was available.*software WebGL/)
  },
)

test('renders correctly sized transparent PNGs', needsBrowser, async () => {
  for (const [name, args, size] of [
    ['pebble.svg', ['-w', '650'], [650, 500]],
    ['frames.svg', ['-h', '300', '-c', '#555555'], [390, 300]],
    ['pebble.svg', ['-w', '200', '-h', '200'], [200, 200]],
    // Basic shapes, nested transforms, <use> and arcs.
    ['shapes.svg', ['-w', '130'], [130, 100]],
  ]) {
    const output = join(dir, `${name}-${size.join('x')}.png`)
    const result = await graphite(
      fixture(name),
      '-o',
      output,
      '--chromium',
      chromium,
      ...args,
    )
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.stderr, '', 'no progress output when not a terminal')
    const png = readPng(await readFile(output))
    assert.deepEqual([png.width, png.height], size)
    assert.equal(png.firstPixel[3], 0, 'corner is transparent')
  }
})

test(
  'refuses to overwrite unless forced, and reports bad artwork',
  needsBrowser,
  async () => {
    const output = join(dir, 'existing.png')
    await writeFile(output, 'keep me')
    const refused = await graphite(
      fixture('pebble.svg'),
      '-o',
      output,
      '--chromium',
      chromium,
    )
    assert.equal(refused.code, 1)
    assert.match(refused.stderr, /--force/)
    assert.equal(await readFile(output, 'utf8'), 'keep me')
    const forced = await graphite(
      fixture('pebble.svg'),
      '-o',
      output,
      '-f',
      '-w',
      '64',
      '--chromium',
      chromium,
    )
    assert.equal(forced.code, 0, forced.stderr)
    assert.equal(readPng(await readFile(output)).width, 64)

    const empty = join(dir, 'empty.svg')
    await writeFile(empty, '<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    const failed = await graphite(
      empty,
      '-o',
      join(dir, 'empty.png'),
      '--chromium',
      chromium,
    )
    assert.equal(failed.code, 1)
    assert.match(failed.stderr, /no supported vector paths/)
    const badColor = await graphite(
      fixture('pebble.svg'),
      '-o',
      join(dir, 'c.png'),
      '-c',
      'nope',
      '--chromium',
      chromium,
    )
    assert.equal(badColor.code, 1)
    assert.match(badColor.stderr, /not a CSS colour/)
  },
)

test(
  'reports a browser without WebGL and writes nothing',
  process.platform === 'win32'
    ? { skip: 'Uses a POSIX shell wrapper' }
    : needsBrowser,
  async () => {
    const wrapper = join(dir, 'no-webgl.sh')
    await writeFile(
      wrapper,
      `#!/bin/sh\nexec "${chromium}" --disable-webgl --disable-3d-apis "$@"\n`,
    )
    await chmod(wrapper, 0o755)
    const output = join(dir, 'no-webgl.png')
    const result = await graphite(
      fixture('pebble.svg'),
      '-o',
      output,
      '--chromium',
      wrapper,
    )
    assert.equal(result.code, 1)
    assert.match(result.stderr, /no WebGL 2/)
    await assert.rejects(readFile(output))
  },
)
