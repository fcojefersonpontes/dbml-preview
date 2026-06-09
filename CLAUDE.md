# DBML Preview — Claude Context

VS Code extension that renders interactive ERD diagrams from `.dbml` files. Created by JefersonPontes. Current version: **1.2.3**.

## Key Files

| File | Responsibility |
|------|---------------|
| `src/extension.ts` | Entry point — registers commands, hover provider, code lens |
| `src/parser.ts` | Custom regex DBML parser → `DBMLSchema` |
| `src/renderer.ts` | SVG renderer — used by both preview panel and `exportSvg` command |
| `src/previewPanel.ts` | Interactive webview panel — drag, zoom, layout save |

## Architecture Note

`renderer.ts` generates the SVG used by **both** `previewPanel.ts` (interactive preview) and the `exportSvg` command. The interactive JS (drag, pan, zoom, relationship redraw) lives inline inside `previewPanel.ts → _getHtmlForWebview()`.

## Hover Provider (`src/extension.ts`)

Hover over any table name in the `.dbml` editor to get a markdown tooltip showing:
- Table note (italic, if present)
- Column table: `Column | Type | Note` with PK / unique / not null badges
- Inline column notes from `[note: '...']` attributes

## Build

```powershell
npm run watch    # TypeScript watch mode (during dev)
npm run compile  # one-shot compile
npm run package  # produces .vsix
```

No bundler — plain `tsc`. Zero production dependencies.

## Testing

Run extension: press F5 in VS Code → open `examples/ecommerce-example.dbml` → click preview button.
No automated tests implemented yet.

## Custom Slash Command

`/expert` — loads full architecture reference, API details, and improvement roadmap.
