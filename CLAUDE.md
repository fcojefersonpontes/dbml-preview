# DBML Preview — Claude Context

VS Code extension that renders interactive ERD diagrams from `.dbml` files. Created by JefersonPontes.

## Key Files

| File | Responsibility |
|------|---------------|
| `src/extension.ts` | Entry point — registers commands, hover, code lens |
| `src/parser.ts` | Custom regex DBML parser → `DBMLSchema` |
| `src/renderer.ts` | SVG renderer for `exportSvg` command (3 layouts) |
| `src/previewPanel.ts` | Interactive webview panel — drag, zoom, layout save |

## Architecture Note

`previewPanel.ts` has its **own internal SVG renderer** for the interactive preview.
`renderer.ts` is used **only** by the `exportSvg` command. They are independent pipelines.

## Build

```powershell
npm run watch    # TypeScript watch mode (during dev)
npm run compile  # one-shot compile
npm run package  # produces .vsix
```

No bundler — plain `tsc`. Zero production dependencies.

## Testing

Run extension: press F5 in VS Code → open `examples/ecommerce.dbml` → click preview button.
No automated tests implemented yet.

## Custom Slash Command

`/expert` — loads full architecture reference, API details, and improvement roadmap.
