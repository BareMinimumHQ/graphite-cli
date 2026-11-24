# Graphite CLI

Render a trusted SVG file to a transparent PNG using [Graphite](https://www.npmjs.com/package/@bareminimum/graphite). The CLI currently includes the Pencil brush and draws the finished artwork with its default style.

## Install and run

You need Node.js 22.12 or later and an installed Chromium or Google Chrome with WebGL 2 and `EXT_color_buffer_float`.

Run without a global install:

```sh
npx @bareminimum/graphite-cli bear.svg --output bear.png
```

To use the command in a project:

```sh
npm install --save-dev @bareminimum/graphite-cli
npm exec -- graphite bear.svg --output bear.png --width 1200 --color '#555555'
```

Use SVG artwork you trust. The CLI opens Chromium locally and uses SwiftShader by default so it can run without a hardware GPU.

## Options

| Option                | Effect                                                           |
| --------------------- | ---------------------------------------------------------------- |
| `-o, --output <file>` | Required PNG output path                                         |
| `-w, --width <px>`    | Output width. Defaults to 975 when neither dimension is supplied |
| `-h, --height <px>`   | Output height                                                    |
| `-c, --color <css>`   | Opaque CSS colour. Defaults to `#36352e`                         |
| `-b, --brush <name>`  | Brush name. Defaults to `pencil`                                 |
| `--gpu`               | Ask Chromium to render on the GPU                                |
| `--chromium <path>`   | Path to the browser executable                                   |
| `-f, --force`         | Replace an existing output file                                  |
| `--help`              | Show usage                                                       |

Provide one dimension to keep the 13:10 artwork ratio. The CLI derives the other dimension. Both dimensions must be whole pixels from 1 to 8192, subject to the browser and device. If you set both, the artwork frame scales to fill the requested size.

For repeatable pixel comparisons, use the same Chromium build and keep software rendering enabled. With `--gpu`, the CLI prints a warning if Chromium falls back to software rendering. Use the Graphite library API to customize brush settings beyond the CLI options.

## Browser discovery

Use `--chromium <path>` or set the `GRAPHITE_CHROMIUM` environment variable. If you provide neither, the CLI checks usual install locations on Linux, macOS and Windows. It uses the browser already installed on your machine.

Progress is shown in an interactive terminal. On failure, the CLI writes an error to standard error and exits with code 1.

## Development

Run `npm ci` and `npm test` from the CLI checkout. Set `GRAPHITE_CHROMIUM` if the executable is outside the default locations. Browser tests are skipped when no Chromium executable is found. Run `npm pack --dry-run` to see which files npm will publish.

`bin/` contains the command and argument handling. `src/` runs Chromium and serves the local render page. `test/` covers command arguments, PNG output, and Graphite integration in Chromium.
