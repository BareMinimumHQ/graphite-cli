#!/usr/bin/env node
import { access, readFile, writeFile } from 'node:fs/promises'
import console from 'node:console'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { defaultColor } from '@bareminimum/graphite'
import { findChromium, UsageError } from '../src/browser.mjs'
import { renderPng, RenderError } from '../src/render.mjs'
import { createProgress } from '../src/progress.mjs'

/** Brushes by name; the render page keeps the same list. */
const brushes = ['pencil']
const defaultBrush = 'pencil'

const FRAME_RATIO = 500 / 650
const MAX_DIMENSION = 8192
const usage = `Usage: graphite <input.svg> --output <file.png> [options]

Renders trusted SVG artwork as a finished, transparent graphite drawing.

Options:
  -o, --output <file>    PNG file to write (required)
  -w, --width <px>       Output width, 1-${MAX_DIMENSION} (default 975)
  -h, --height <px>      Output height, 1-${MAX_DIMENSION} (default: width x 500/650)
  -c, --color <css>      Pencil colour (default ${defaultColor})
  -b, --brush <name>     Brush: ${brushes.join(', ')} (default ${defaultBrush})
      --gpu              Use the GPU. Faster for large images, but pixels can
                         differ between machines (default: software WebGL)
      --chromium <path>  Chromium or Chrome executable (or set GRAPHITE_CHROMIUM)
  -f, --force            Overwrite the output file if it exists
      --help             Show this help`

function size(value, name) {
  if (value === undefined) return undefined
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1 || number > MAX_DIMENSION)
    throw new UsageError(
      `--${name} must be a whole number from 1 to ${MAX_DIMENSION}`,
    )
  return number
}

async function write(path, png, force) {
  try {
    // 'wx' also refuses a file that appeared while rendering.
    await writeFile(path, png, { flag: force ? 'w' : 'wx' })
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new UsageError(
        `${path} already exists. Pass --force to overwrite it.`,
      )
    throw new UsageError(`Cannot write ${path}: ${error.code ?? error.message}`)
  }
}

async function main(argv) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        output: { type: 'string', short: 'o' },
        width: { type: 'string', short: 'w' },
        height: { type: 'string', short: 'h' },
        color: { type: 'string', short: 'c' },
        brush: { type: 'string', short: 'b' },
        chromium: { type: 'string' },
        gpu: { type: 'boolean' },
        force: { type: 'boolean', short: 'f' },
        help: { type: 'boolean' },
      },
    })
  } catch (error) {
    throw new UsageError(error.message)
  }
  const { values, positionals } = parsed
  if (values.help) {
    process.stdout.write(`${usage}\n`)
    return
  }
  if (positionals.length !== 1)
    throw new UsageError('Give exactly one input SVG file')
  if (!values.output) throw new UsageError('--output is required')
  if (!values.output.toLowerCase().endsWith('.png'))
    throw new UsageError('--output must be a .png file')
  const brush = values.brush ?? defaultBrush
  if (!brushes.includes(brush))
    throw new UsageError(
      `Unknown brush "${brush}". Choose from: ${brushes.join(', ')}`,
    )
  let width = size(values.width, 'width')
  let height = size(values.height, 'height')
  if (width === undefined && height === undefined) width = 975
  width ??= Math.max(1, Math.round(height / FRAME_RATIO))
  height ??= Math.max(1, Math.round(width * FRAME_RATIO))
  if (width > MAX_DIMENSION)
    throw new UsageError(
      `--height ${height} implies a width of ${width}, above the ${MAX_DIMENSION}px limit. Pass --width to set it explicitly.`,
    )

  let svg
  try {
    svg = await readFile(positionals[0], 'utf8')
  } catch (error) {
    throw new UsageError(
      `Cannot read ${positionals[0]}: ${error.code ?? error.message}`,
    )
  }
  const exists = await access(values.output).then(
    () => true,
    () => false,
  )
  if (exists && !values.force)
    throw new UsageError(
      `${values.output} already exists. Pass --force to overwrite it.`,
    )
  const chromium = await findChromium(values.chromium)
  const progress = createProgress(process.stderr, {
    draw: `Drawing ${width}x${height}`,
  })
  let result
  try {
    result = await renderPng({
      svg,
      width,
      height,
      chromium,
      gpu: values.gpu,
      brush,
      color: values.color,
      onStage: progress.stage,
    })
    progress.stage('write')
    await write(values.output, result.png, values.force)
  } finally {
    progress.stop()
  }
  if (values.gpu && result.software)
    console.error(
      'graphite: no GPU was available, so the drawing used software WebGL.',
    )
  process.stdout.write(`Wrote ${values.output} (${width}x${height})\n`)
}

try {
  await main(process.argv.slice(2))
} catch (error) {
  if (error instanceof UsageError || error instanceof RenderError) {
    console.error(`graphite: ${error.message}`)
    if (error instanceof UsageError)
      console.error('Run graphite --help for usage.')
  } else console.error(error)
  process.exitCode = 1
}
