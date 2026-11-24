/* global document, DOMParser */
import test from 'node:test'
import assert from 'node:assert/strict'
import { findChromium, launch } from '../src/browser.mjs'
import { serve } from '../src/render.mjs'

// Graphite internals that need a real browser: SVG geometry and the renderer lifecycle.
const chromium = await findChromium().catch(() => undefined)
const options = chromium
  ? {}
  : { skip: 'No Chromium found; set GRAPHITE_CHROMIUM to run browser tests' }

let server, browser, page
test.before(async () => {
  if (!chromium) return
  server = await serve()
  browser = await launch(chromium)
  page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
})
test.after(async () => {
  await browser?.close()
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()))
})

test('the render server keeps serving after a malformed path', async () => {
  const app = await serve()
  const origin = `http://127.0.0.1:${app.address().port}`
  try {
    assert.equal((await fetch(`${origin}/%`)).status, 404)
    assert.equal((await fetch(origin)).status, 200)
  } finally {
    await new Promise((resolve) => app.close(resolve))
  }
})

/** Length, closure and first and last points of each subpath, rounded. */
function subpaths(markup) {
  return page.evaluate(async (markup) => {
    const { svgSubpaths } = await import('/graphite/core/svg-paths.js')
    const round = (value) => Math.round(value * 100) / 100
    const svg = new DOMParser().parseFromString(markup, 'image/svg+xml')
    return svgSubpaths(svg.documentElement).map((path) => {
      const points = path.spacedPoints(8)
      const point = ({ x, y }) => [round(x), round(y)]
      return {
        length: round(path.length),
        closed: path.closed,
        first: point(points[0]),
        last: point(points.at(-1)),
      }
    })
  }, markup)
}

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`

test('reads basic shapes with SVG closure rules', options, async () => {
  const [rect, circle, polygon, polyline, line] = await subpaths(
    svg(`<rect width="20" height="10"/><circle cx="50" cy="50" r="10"/>
      <polygon points="0,0 10,0 10,10"/><polyline points="0,0 10,0 10,10"/>
      <line x1="1" y1="2" x2="4" y2="6"/>`),
  )
  assert.deepEqual(rect, {
    length: 60,
    closed: true,
    first: [0, 0],
    last: [0, 0],
  })
  assert.ok(Math.abs(circle.length - 20 * Math.PI) < 0.1)
  assert.equal(circle.closed, true)
  assert.deepEqual(
    [circle.first, circle.last],
    [
      [60, 50],
      [60, 50],
    ],
  )
  assert.deepEqual(polygon, {
    length: 34.14,
    closed: true,
    first: [0, 0],
    last: [0, 0],
  })
  assert.deepEqual(polyline, {
    length: 20,
    closed: false,
    first: [0, 0],
    last: [10, 10],
  })
  assert.deepEqual(line, {
    length: 5,
    closed: false,
    first: [1, 2],
    last: [4, 6],
  })
})

test(
  'prepares single-axis lines and SVGs with many sampled points',
  options,
  async () => {
    const [horizontal, vertical, complex] = await page.evaluate(async () => {
      const { rasterizeSvg } = await import('@bareminimum/graphite')
      const markup = (body) =>
        `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`
      return Promise.all(
        [
          '<line x2="100" stroke="black"/>',
          '<line y2="100" stroke="black"/>',
          '<path d="M0 0 L4000 4000"/>'.repeat(128),
        ].map(async (body) => {
          const { bounds, coverage, paths } = await rasterizeSvg(markup(body))
          return {
            bounds,
            hasCoverage: coverage.some(Boolean),
            paths: paths.length,
          }
        }),
      )
    })
    assert.equal(horizontal.bounds.height, 0)
    assert.ok(horizontal.bounds.width > 0 && horizontal.hasCoverage)
    assert.equal(vertical.bounds.width, 0)
    assert.ok(vertical.bounds.height > 0 && vertical.hasCoverage)
    assert.equal(complex.paths, 128)
  },
)

test(
  'applies nested transforms, <use> offsets and units',
  options,
  async () => {
    const paths = await subpaths(
      svg(`<defs><path id="dash" d="M0 0 H1"/></defs>
      <g transform="translate(5 0)"><path transform="scale(2)" d="M0 0 H3"/></g>
      <use href="#dash" x="10" transform="scale(2)"/>
      <rect width="1in" height="1in"/>
      <path d="M0 0a5 5 0 1010 0"/>`),
    )
    assert.equal(paths.length, 4, 'defs content is drawn only through <use>')
    assert.deepEqual(paths[0], {
      length: 6,
      closed: false,
      first: [5, 0],
      last: [11, 0],
    })
    // The use's transform applies after its x offset: scale(2) translate(10 0).
    assert.deepEqual(paths[1], {
      length: 2,
      closed: false,
      first: [20, 0],
      last: [22, 0],
    })
    assert.equal(paths[2].length, 384, '1in is 96 user units per side')
    // Packed arc flags, as minifiers write them.
    assert.ok(Math.abs(paths[3].length - 5 * Math.PI) < 0.1)
    assert.deepEqual(paths[3].last, [10, 0])
  },
)

test(
  'renderer resizes, disposes once and then refuses work',
  options,
  async () => {
    const result = await page.evaluate(async () => {
      const { createRenderer, prepareSvg } =
        await import('@bareminimum/graphite')
      const { pencil } = await import('@bareminimum/graphite/pencil')
      const artwork = await prepareSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="2" y="2" width="6" height="6"/></svg>',
      )
      const canvas = document.createElement('canvas')
      const renderer = createRenderer(canvas, {
        artwork,
        brush: pencil,
        width: 40,
        height: 30,
      })
      renderer.render()
      renderer.resize(20, 10)
      renderer.render({ color: 'tomato' })
      let invalidColor
      try {
        renderer.render({ color: 'var(--missing-ink)' })
      } catch (caught) {
        invalidColor = caught.name
      }
      renderer.render({ color: 'black' })
      const size = [canvas.width, canvas.height]
      renderer.dispose()
      renderer.dispose()
      const lost = canvas.getContext('webgl2').isContextLost()
      let error = ''
      try {
        renderer.render()
      } catch (caught) {
        error = caught.message
      }
      return { size, lost, error, invalidColor }
    })
    assert.deepEqual(result.size, [20, 10])
    assert.equal(result.lost, true, 'dispose releases the WebGL context')
    assert.equal(result.invalidColor, 'TypeError')
    assert.match(result.error, /disposed/)
  },
)

test(
  'a rendering session keeps interleaved drawings independent on one context',
  // Software WebGL needs time to draw all 24 canvases on shared runners.
  { ...options, timeout: 60_000 },
  async () => {
    const result = await page.evaluate(
      async (markups) => {
        const { createRenderer, createRenderingSession, prepareSvg } =
          await import('@bareminimum/graphite')
        const { pencil } = await import('@bareminimum/graphite/pencil')
        const [circle, triangle] = await Promise.all(markups.map(prepareSvg))
        const art = [
          { artwork: circle, brush: pencil, width: 72, height: 54 },
          { artwork: triangle, brush: pencil, width: 56, height: 42 },
        ]
        const canvas = () => document.createElement('canvas')
        const standalone = art.map((options) => {
          const target = canvas()
          return { target, renderer: createRenderer(target, options) }
        })

        const getContext = globalThis.HTMLCanvasElement.prototype.getContext
        const webglContexts = new Set()
        globalThis.HTMLCanvasElement.prototype.getContext = function (
          type,
          ...args
        ) {
          const context = getContext.call(this, type, ...args)
          if (type === 'webgl2' && context) webglContexts.add(context)
          return context
        }
        let lost = 0
        let notifyLoss
        const loss = new Promise((resolve) => (notifyLoss = resolve))
        const session = createRenderingSession({
          onContextLost: () => {
            lost++
            notifyLoss()
          },
        })
        try {
          const shared = Array.from({ length: 24 }, (_, index) => {
            const target = canvas()
            return {
              target,
              renderer: session.createDrawing(target, art[index % 2]),
            }
          })
          const snapshots = []
          const frames = [
            [
              { progress: { outline: 0.6, shading: 0 }, color: 'black' },
              { progress: { outline: 0.8, shading: 0 }, color: 'tomato' },
            ],
            [
              { progress: { outline: 1, shading: 0.5 }, color: 'black' },
              { progress: { outline: 1, shading: 0.3 }, color: 'tomato' },
            ],
            [
              { style: { outline: { enabled: false } }, color: 'linen' },
              { style: { shading: [{ enabled: false }] }, color: 'tomato' },
            ],
          ]
          for (const styles of frames) {
            const expected = standalone.map(({ target, renderer }, index) => {
              renderer.render(styles[index])
              const copy = canvas()
              copy.width = target.width
              copy.height = target.height
              copy.getContext('2d').drawImage(target, 0, 0)
              return copy.toDataURL()
            })
            const actual = shared.map(({ target, renderer }, index) => {
              renderer.render(styles[index % 2])
              return target.toDataURL()
            })
            snapshots.push(
              expected[0] !== expected[1] &&
                actual.every((pixels, index) => pixels === expected[index % 2]),
            )
          }
          const [first, second] = shared
          first.renderer.dispose()
          second.renderer.resize(40, 30)
          second.renderer.render()
          const [gl] = webglContexts
          const aliveAfterDrawingDisposal = !gl.isContextLost()
          const size = [second.target.width, second.target.height]
          gl.getExtension('WEBGL_lose_context').loseContext()
          await loss
          let disposedDrawing = false
          try {
            second.renderer.render()
          } catch (error) {
            disposedDrawing = /disposed/.test(error.message)
          }
          return {
            snapshots,
            size,
            contexts: webglContexts.size,
            aliveAfterDrawingDisposal,
            lost,
            disposedDrawing,
          }
        } finally {
          session.dispose()
          for (const { renderer } of standalone) renderer.dispose()
          globalThis.HTMLCanvasElement.prototype.getContext = getContext
        }
      },
      [
        svg('<circle cx="50" cy="50" r="35"/>'),
        svg('<path d="M5 88L50 12L95 88Z"/>'),
      ],
    )
    assert.deepEqual(result, {
      snapshots: [true, true, true],
      size: [40, 30],
      contexts: 1,
      aliveAfterDrawingDisposal: true,
      lost: 1,
      disposedDrawing: true,
    })
  },
)
