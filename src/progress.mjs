import { setInterval, clearInterval } from 'node:timers'

const labels = {
  launch: 'Starting the browser',
  prepare: 'Preparing the artwork',
  draw: 'Drawing',
  write: 'Writing the file',
}
const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * Shows the current stage and elapsed time on one terminal line. The draw is
 * one GPU call with no partial progress, so this shows stages, not a percentage.
 * Does nothing when the stream is not a terminal, so logs and pipes stay clean.
 */
export function createProgress(stream, { draw = 'Drawing' } = {}) {
  if (!stream.isTTY) return { stage() {}, stop() {} }
  const start = Date.now()
  let label = '',
    frame = 0
  const paint = () => {
    const seconds = ((Date.now() - start) / 1000).toFixed(1)
    stream.write(
      `\r\x1b[2K${frames[frame++ % frames.length]} ${label} ${seconds}s`,
    )
  }
  const timer = setInterval(paint, 100)
  timer.unref()
  return {
    stage(name) {
      label = name === 'draw' ? draw : labels[name]
      paint()
    },
    stop() {
      clearInterval(timer)
      stream.write('\r\x1b[2K')
    },
  }
}
