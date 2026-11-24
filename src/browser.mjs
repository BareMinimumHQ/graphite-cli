import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import process from 'node:process'
import { chromium } from 'playwright-core'

/** Common install locations, checked in order after --chromium and GRAPHITE_CHROMIUM. */
const candidates = {
  linux: [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ],
  darwin: [
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ],
  win32: [
    `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.PROGRAMFILES}\\Chromium\\Application\\chrome.exe`,
  ],
}

/** An invalid command option or missing runtime requirement. */
export class UsageError extends Error {}

async function executable(path) {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Resolves an installed Chromium executable from an explicit path, the environment
 * or the platform's common installation locations.
 * @param {string} [explicit] An explicit path to the browser executable.
 * @returns {Promise<string>} The executable to launch.
 * @throws {UsageError} If no executable can be found.
 */
export async function findChromium(explicit) {
  const chosen = explicit ?? process.env.GRAPHITE_CHROMIUM
  if (chosen) {
    if (await executable(chosen)) return chosen
    throw new UsageError(
      `No executable browser at ${chosen}. Check the --chromium path or GRAPHITE_CHROMIUM.`,
    )
  }
  for (const path of candidates[process.platform] ?? [])
    if (await executable(path)) return path
  throw new UsageError(
    'Could not find Chromium or Google Chrome. Install one, then pass its path with --chromium <path> or set GRAPHITE_CHROMIUM.',
  )
}

/**
 * Software WebGL (SwiftShader) reduces differences between GPUs. The page
 * only renders local, trusted files, so the "unsafe" SwiftShader flag is acceptable.
 */
const softwareArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
/** Asks for the GPU. Chromium can still fall back to SwiftShader; the caller checks. */
const gpuArgs = [
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  '--enable-unsafe-swiftshader',
]

/**
 * Starts a headless browser for a Graphite render.
 * @param {string} executablePath Path returned by findChromium.
 * @param {{gpu?: boolean}} [options] Ask Chromium to use a hardware GPU.
 * @returns {Promise<import('playwright-core').Browser>} The browser to close after rendering.
 */
export function launch(executablePath, { gpu = false } = {}) {
  return chromium.launch({
    executablePath,
    headless: true,
    args: gpu ? gpuArgs : softwareArgs,
  })
}
