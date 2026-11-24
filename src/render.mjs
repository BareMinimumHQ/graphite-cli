import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import { fileURLToPath, URL } from 'node:url'
import { launch } from './browser.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const graphiteEntry = fileURLToPath(
  import.meta.resolve('@bareminimum/graphite'),
)
// Graphite's own dependencies, resolved from graphite so nesting does not matter.
const fromGraphite = createRequire(graphiteEntry)
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.webp': 'image/webp',
}
// Each route serves one directory; page.html maps the bare imports onto them.
const routes = {
  '/graphite/': dirname(graphiteEntry),
  '/path-data-parser/': dirname(fromGraphite.resolve('path-data-parser')),
  '/svg-path-properties/': dirname(fromGraphite.resolve('svg-path-properties')),
}

/**
 * Starts the loopback server for the render page and its JavaScript imports.
 * @returns {Promise<import('node:http').Server>} The listening server to close after rendering.
 */
export function serve() {
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://x').pathname)
      let file
      if (path === '/') file = join(here, 'page.html')
      for (const [prefix, root] of Object.entries(routes))
        if (path.startsWith(prefix)) {
          const candidate = normalize(join(root, path.slice(prefix.length)))
          if (candidate.startsWith(normalize(root) + sep)) file = candidate
        }
      if (!file || !types[extname(file)]) throw new Error('Not found')
      const body = await readFile(file)
      response.writeHead(200, { 'content-type': types[extname(file)] })
      response.end(body)
    } catch {
      response.writeHead(404).end()
    }
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

/** A browser or drawing failure with a message suitable for the CLI. */
export class RenderError extends Error {}

/**
 * Renders trusted SVG markup to a completed, transparent graphite PNG.
 * `onStage` is called with 'launch', 'prepare' and 'draw' as work starts.
 * @param {{ svg: string, width: number, height: number, brush?: string, color?: string, style?: object, chromium: string, gpu?: boolean, timeout?: number, onStage?: (stage: string) => void }} options
 * @returns {Promise<{ png: Buffer, webgl: string, software: boolean }>}
 */
export async function renderPng({
  svg,
  width,
  height,
  brush,
  color,
  style,
  chromium,
  gpu = false,
  timeout = 60_000,
  onStage = () => {},
}) {
  const server = await serve()
  let browser
  try {
    try {
      onStage('launch')
      browser = await launch(chromium, { gpu })
    } catch (error) {
      throw new RenderError(
        `Could not start the browser at ${chromium}: ${error.message.split('\n')[0]}`,
      )
    }
    const page = await browser.newPage()
    page.setDefaultTimeout(timeout)
    const { port } = server.address()
    await page.goto(`http://127.0.0.1:${port}/`)
    await page.waitForFunction(() => globalThis.graphiteReady === true)
    let url, webgl
    try {
      onStage('prepare')
      webgl = await page.evaluate(
        (input) => globalThis.prepareGraphite(input),
        svg,
      )
      onStage('draw')
      url = await page.evaluate((input) => globalThis.drawGraphite(input), {
        width,
        height,
        brush,
        color,
        style,
      })
    } catch (error) {
      const message = String(error.message)
      if (message.includes('WEBGL_UNAVAILABLE'))
        throw new RenderError(
          'This browser has no WebGL 2. Try a current Chromium or Google Chrome, or enable GPU or SwiftShader support.',
        )
      const reason = message.match(/Error: (.+)/)?.[1] ?? message.split('\n')[0]
      throw new RenderError(`Rendering failed: ${reason}`)
    }
    return {
      png: Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'),
      webgl,
      software: /swiftshader/i.test(webgl),
    }
  } finally {
    await browser?.close().catch(() => {})
    await new Promise((resolve) => server.close(resolve))
  }
}
