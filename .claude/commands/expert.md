# DBML Preview Extension — Expert Context

You are now operating as an expert developer on the **DBML Preview** VS Code extension. Load this context before answering any question about this project.

---

## Identidade do Projeto

| Campo | Valor |
|-------|-------|
| Nome | `dbml-preview` |
| Publisher | `JefersonPontes` |
| Versão | 1.2.3 |
| Engine mínima | VS Code 1.85.0 |
| Licença | MIT |
| Repo | github.com/fcojefersonpontes/dbml-preview |

---

## Stack Tecnológica

**Linguagem:** TypeScript 5.3.0 → compilado para CommonJS (ES2022 target), output em `/out/`  
**Build:** `tsc -p ./` puro — sem webpack, esbuild ou bundler  
**Dependências de produção:** **zero** — extensão completamente auto-contida  
**Dev deps:** typescript, @types/vscode, @types/node, eslint + @typescript-eslint, @vscode/vsce  
**Renderização:** SVG puro via concatenação de strings — sem D3, React, canvas  
**Webview:** HTML/CSS/JS inline como template literals em `_getHtmlForWebview()` — sem CDN externo  
**Persistência de layout:** arquivos `.erd-layout.json` gravados junto aos `.dbml` via Node `fs`  
**Testes:** scaffold existe (mocha + @vscode/test-electron), mas nenhum teste implementado

---

## Arquitetura — Fluxo de Dados

```
Arquivo .dbml
    ↓ (texto bruto)
DBMLParser.parse()                      [src/parser.ts]
    ↓ (DBMLSchema)
ERDRenderer.render()                    [src/renderer.ts]
    ↓ (string SVG)
ERDPreviewPanel._getHtmlForWebview()    [src/previewPanel.ts]
    ↓ (HTML completo com SVG embutido + JS interativo)
VS Code Webview
```

> **Nota arquitetural importante:** `previewPanel.ts` **usa `ERDRenderer`** para gerar o SVG inicial — o pipeline de renderização é **compartilhado**. O que é exclusivo do `previewPanel.ts` é o JavaScript inline no webview, que gerencia interações (drag, pan, zoom, redesenho dinâmico de linhas de relacionamento durante arrastar). `ERDRenderer` é também usado de forma standalone pelo comando `exportSvg` em `extension.ts`.

---

## Os 4 Arquivos-Fonte

### `src/extension.ts` (134 linhas)
**Responsabilidade:** Entry point da extensão.

**Registra:**
- **`dbml-previewer.preview`** → chama `ERDPreviewPanel.createOrShow()`
- **`dbml-previewer.exportSvg`** → instancia `DBMLParser` + `ERDRenderer`, abre save dialog, grava SVG  
  - ⚠️ **Código morto:** ainda lê `config.get('backgroundColor', '#1e1e1e')` no objeto `options`, mas `RenderOptions` não tem mais esse campo. O TypeScript não reclama porque a variável não é anotada como `RenderOptions` antes de ser passada. O campo é simplesmente ignorado — não causa bug funcional, mas é lixo a remover.
- **HoverProvider** → ao passar o mouse sobre nome de tabela no editor, exibe tooltip markdown com: nota da tabela (itálico), tabela `Column | Type | Note` com badges *(PK)*, *(unique)*, *(not null)*, e nota inline da coluna `[note: '...']`
- **CodeLensProvider** → exibe botão `$(preview) Preview Diagram` no topo de arquivos .dbml

**Ativação:** automática via `languages` em `package.json` (campo `activationEvents` removido na v1.1.0)

---

### `src/parser.ts` (595 linhas)
**Responsabilidade:** Parser manual de DBML — sem biblioteca externa.

**Abordagem:** regex-based com extração de corpo por rastreamento de chaves — não AST formal.

**Tipos exportados:**
```typescript
Column      { name, type, pk?, unique?, notNull?, note?, default?, increment? }
Table       { name, alias?, columns, note?, color?, headerColor?, indexes?, schema? }
Index       { name?, columns, unique?, pk? }
Ref         { name?, fromTable, fromColumn, toTable, toColumn, fromRelation:'1'|'*', toRelation:'1'|'*', onDelete?, onUpdate? }
TableGroup  { name, tables, color? }
Enum        { name, values: EnumValue[] }
EnumValue   { name, note? }
DBMLSchema  { tables, refs, tableGroups, enums, schemas, projectName?, projectNote? }
```

**Métodos principais:**
- `parse(content)` → `DBMLSchema` — ponto de entrada público, chama `manualParse()`
- `manualParse(content)` — orquestra todo o parsing
- `extractTableBody(content, startPos)` — rastreia `{` / `}` respeitando strings e triple-quotes
- `parseColumns(tableBody)` — extrai colunas ignorando Notes, indexes, comentários
- `extractInlineRefs(content, tables)` — refs inline `[ref: > table.column]` + refs standalone `Ref name { ... }`
- `extractTableGroups(content, colorMap)` — grupos com cores opcionais
- `isValidColumnType(type)` — valida tipos SQL; aceita custom types simples (< 30 chars)

**O que o parser suporta:**
- Tabelas com schema (`schema.table`)
- Colunas: `pk`, `unique`, `not null` / `nn`, `increment`, `default`, `note`
- Refs inline e standalone; operadores `<`, `>`, `-`
- TableGroups com cores
- Enums com values
- Notas multi-linha (`'''...'''` e `"""..."""`) e single-line
- Cores de tabela/header `[color: #hex]` e `[headercolor: #hex]`
- Metadados de `Project`
- Remoção de comentários `//` inline e full-line

---

### `src/renderer.ts` (744 linhas)
**Responsabilidade:** Motor de renderização SVG — usado tanto pelo preview interativo quanto pelo exportSvg.

**Tipos:**
```typescript
RenderOptions { defaultTableColor, defaultGroupColor, showRelationshipLabels, layout }
Position      { x, y, width, height }
ColumnPosition { table, column, x, y, width }
TableLayoutInfo { name, connections, inDegree, outDegree, level, group? }
```
> `backgroundColor` foi **removido** de `RenderOptions` na v1.2.1 — não passa, não lê, não existe.

**3 algoritmos de layout:**
- `compact` *(padrão)* — grid, agrupa tabelas por `TableGroup`, ungrouped no final
- `left-right` — ETL layout, BFS por nível de dependência (in/out degree)
- `snowflake` — tabela mais conectada no centro + anéis concêntricos

**Dimensões fixas:** `tableWidth=240`, `rowHeight=26`, `headerHeight=38`, `tablePadding=10`

**CSS classes no SVG gerado (em `<defs><style>`):**
```css
.svg-background  { fill: var(--bg-main, #1e1e1e); }          /* fundo do canvas */
.table-bg        { fill: var(--erd-table-bg, #2a2a2a); }     /* card das tabelas */
.column-name     { fill: var(--erd-text-primary, #e0e0e0); }
.column-type     { fill: var(--erd-text-muted, #888); }
.group-label     { fill: var(--erd-text-muted, #aaa); }
.cardinality-bg  { fill: var(--erd-card-bg, #2a2a2a); }
.col-row-alt     { fill: var(--erd-row-alt, rgba(255,255,255,0.02)); }
.col-sep         { stroke: var(--erd-separator, rgba(255,255,255,0.05)); }
```
- O `<rect>` de fundo usa `class="svg-background"` (sem atributo `fill` inline) → CSS variable resolve via documento pai no webview
- O `<rect>` das tabelas usa `class="table-bg"` com `fill="var(--erd-table-bg)"` explícito no atributo (redundante mas harmless)
- Cores de header e stroke das tabelas são passadas inline como `fill="${color}"` — controladas por `defaultTableColor` ou cor da TableGroup

**SVG data attribute:** `<svg data-positions='[{name, x, y, width, height}...]'>` — usado pelo JS do webview para inicializar posições

**Marcadores de cardinalidade (SVG `<marker>`):**
- `#arrow-end` — seta azul (não usado no ERD atual)
- `#one-circle` — círculo para lado "1"
- `#many-crow` — crow's foot para lado "N"
- `#one-line` — duas linhas para "1" obrigatório
- Filtros: `#shadow` (drop shadow nas tabelas), `#glow` (efeito highlight)

**Método principal:** `ERDRenderer.render(schema): string` → retorna SVG completo com `data-positions`

---

### `src/previewPanel.ts` (965 linhas)
**Responsabilidade:** Painel webview interativo — wrapper de estado + HTML + JS interativo.

**Propriedades da classe:**
```typescript
static currentPanel: ERDPreviewPanel | undefined   // singleton
static viewType = 'dbmlPreview'
_panel: vscode.WebviewPanel
_extensionUri: vscode.Uri
_document: vscode.TextDocument | undefined
_disposables: vscode.Disposable[]
_savedPositions: { [tableName]: { dx, dy } } | null
```

**Ciclo de vida:**
1. `createOrShow()` — singleton; revela se já existe, senão cria
2. Constructor → `_loadSavedLayout()` → `_update()` → registra listeners
3. `_update()` → parse → render → `_getHtmlForWebview()` → atribui HTML ao webview
4. `onDidChangeActiveColorTheme` → chama `_update()` (re-renderiza tabelas/relações; fundo atualiza via CSS automaticamente)
5. `dispose()` → limpa tudo

**`_update()` — leitura de config:**
```typescript
const config = vscode.workspace.getConfiguration('dbmlPreviewer');
const options: RenderOptions = {
  defaultTableColor: config.get('defaultTableColor', '#3498db'),
  defaultGroupColor: config.get('defaultGroupColor', '#95a5a6'),
  showRelationshipLabels: config.get('showRelationshipLabels', true),
  layout: 'compact'
};
```
> Sem `backgroundColor` e sem detecção de tema (`themeKind`, `isLight`) — esses foram removidos na v1.2.1.

**Mensagens webview → extensão (`onDidReceiveMessage`):**
| `command` | Ação |
|-----------|------|
| `refresh` | `_loadSavedLayout(); _update()` |
| `goToTable` | navega para declaração da tabela no editor |
| `goToColumn` | navega para coluna da tabela no editor |
| `saveLayout` | grava `.erd-layout.json` com `{ version:1, positions, savedAt }` |
| `exportSvg` | abre save dialog e grava SVG |

**Formato do arquivo de layout:**
```json
{ "version": 1, "positions": { "TableName": { "dx": 0, "dy": 0 } }, "savedAt": "ISO8601" }
```

**CSS variables definidas no `:root` do webview:**
```css
--bg-main:       var(--vscode-editor-background, #1e1e1e)
--bg-side:       var(--vscode-sideBar-background, #252526)
--bg-item:       var(--vscode-list-inactiveSelectionBackground, #2a2a2a)
--fg-main:       var(--vscode-editor-foreground, #e0e0e0)
--fg-muted:      var(--vscode-descriptionForeground, #888)
--fg-bright:     var(--vscode-titleBar-activeForeground, #fff)
--border:        var(--vscode-panel-border, ...)
--hover:         var(--vscode-list-hoverBackground, #37373d)
--accent:        var(--vscode-button-background, #0e639c)
--accent-hover:  var(--vscode-button-hoverBackground, #1177bb)
--accent-fg:     var(--vscode-button-foreground, #fff)
--btn-sec:       var(--vscode-button-secondaryBackground, #3c3c3c)
--list-sel:      var(--vscode-list-activeSelectionBackground, rgba(14,99,156,0.2))
--tooltip-bg:    var(--vscode-editorWidget-background, #252526)
```

**CSS variables por tema (ERD-específicas):**
```css
body.vscode-dark, :root {
  --erd-table-bg: #2a2a2a;  --erd-text-primary: #e0e0e0;
  --erd-text-muted: #888;   --erd-card-bg: #1e1e1e;
  --erd-row-alt: rgba(255,255,255,0.02);  --erd-separator: rgba(255,255,255,0.05)
}
body.vscode-light {
  --erd-table-bg: #f5f5f5;  --erd-text-primary: #1e1e1e;
  --erd-text-muted: #666;   --erd-card-bg: #e0e0e0;
  --erd-row-alt: rgba(0,0,0,0.02);  --erd-separator: rgba(0,0,0,0.06)
}
body.vscode-high-contrast {
  --erd-table-bg: #000;     --erd-text-primary: #fff;
  --erd-text-muted: #ccc;   --erd-card-bg: #000;
}
```

**Cadeia de variáveis do fundo (v1.2.1+):**
```
VS Code troca tema → atualiza --vscode-editor-background
  → --bg-main: var(--vscode-editor-background)
    → .svg-background { fill: var(--bg-main) }
      → <rect class="svg-background"> renderiza com a cor correta
```
Tudo automático via CSS — sem recarregar HTML.

**CSP do webview:** `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-<random>'`

**Funcionalidades do JS inline:**
- Drag de tabela individual: mousedown na `.table` → mousemove → mouseup → `setUnsaved()`
- Drag de grupo: mousedown no `.table-group` (sem `.table`) OU Shift+drag em tabela → move todas do grupo
- Pan do canvas: mousedown em área vazia → arrastar
- Zoom: Ctrl+scroll (centrado no cursor), botões +/−, atalhos
- `updateRelationshipPath(rel)` — recalcula bezier durante drag em tempo real
- `updateGroupBackgrounds()` — atualiza rect do grupo ao arrastar tabelas
- `updateSvgSize()` — expande SVG se tabela sair dos limites
- `initPositions()` — aplica `savedPositions` ao carregar via `transform="translate(dx,dy)"`

**Atalhos de teclado:**
| Atalho | Ação |
|--------|------|
| Ctrl+S | salvar layout |
| Ctrl+= ou Ctrl++ | zoom in |
| Ctrl+- | zoom out |
| Ctrl+0 | fit to screen |
| Escape | deselecionar tudo |
| Shift+drag | arrastar grupo inteiro |
| clique em tabela | selecionar + highlight rels |
| duplo clique em tabela | navegar no editor |
| clique em coluna | navegar no editor |

**Sidebar:** abas Tables / Relations; clique em item → seleciona + scroll para tabela; duplo clique → navega editor; schema groups colapsáveis

---

## Contribuições Registradas no `package.json`

**Comandos:**
- `dbml-previewer.preview` — ícone SVG na barra do editor para arquivos .dbml
- `dbml-previewer.exportSvg` — disponível via command palette

**Menus:**
- `editor/title` — botão preview quando `resourceLangId == dbml`
- `editor/context` — item no menu de contexto do editor

**Linguagem:**
- ID: `dbml`, extensão: `.dbml`, aliases: "DBML", "Database Markup Language"
- Configuração: `language-configuration.json` (comentários `//`, brackets, folding)

**Grammars:**
- `syntaxes/dbml.tmLanguage.json` — grammar TextMate com `scopeName: source.dbml`
- Tokens: keywords (`Table`, `Enum`, `Ref`, `TableGroup`, `Project`), tipos SQL, modificadores de coluna, operadores de relacionamento (`<`, `>`, `-`), strings, comentários, hex colors, números/booleanos

**Configurações (`dbmlPreviewer.*`):**
| Setting | Tipo | Default | Descrição |
|---------|------|---------|-----------|
| `defaultTableColor` | string | `#3498db` | Cor padrão para tabelas sem cor definida |
| `defaultGroupColor` | string | `#95a5a6` | Cor padrão para grupos sem cor definida |
| `showRelationshipLabels` | boolean | `true` | Exibir labels nas conexões |

> `backgroundColor` foi **removida** na v1.2.1. O fundo é controlado por `var(--vscode-editor-background)` via CSS.

---

## Estrutura de Diretórios

```
dbml-preview/
├── src/
│   ├── extension.ts          # entry point (~134 linhas)
│   ├── parser.ts             # DBML parser (~595 linhas)
│   ├── renderer.ts           # SVG renderer (~744 linhas)
│   └── previewPanel.ts       # webview interativo (~965 linhas)
├── out/                      # JS compilado (gerado pelo tsc)
├── examples/
│   ├── ecommerce.dbml        # schema complexo para testes
│   └── *.erd-layout.json     # layouts salvos dos exemplos
├── resources/
│   ├── icon-light.svg
│   └── icon-dark.svg
├── .vscode/
│   ├── launch.json           # debug: "Run Extension", "Extension Tests"
│   └── tasks.json            # tasks: watch, compile, lint
├── syntaxes/
│   └── dbml.tmLanguage.json  # grammar TextMate (syntax highlighting)
├── language-configuration.json  # comentários, brackets, folding
├── docs/
│   └── fix-theme-background.md  # documentação do bug fix v1.2.1
├── .claude/
│   └── commands/
│       └── expert.md         # este arquivo
├── package.json
├── tsconfig.json
├── icon.png
└── README.md
```

---

## Bugs / Inconsistências Conhecidas

1. ~~**`extension.ts` — código morto:**~~ **corrigido na v1.2.2** — `config.get('backgroundColor', '#1e1e1e')` removido do comando `exportSvg`; `RenderOptions` não tem esse campo desde a v1.2.1.

2. ~~**HoverProvider mostrava apenas `Column | Type`:**~~ **corrigido na v1.2.3** — tooltip agora exibe nota da tabela, badges de modificadores (PK, unique, not null) e notas inline de colunas `[note: '...']`.

3. **`layout: 'compact'` hardcoded** em `previewPanel.ts` e `extension.ts` — os outros 2 layouts existem em `renderer.ts` mas nunca são expostos via UI ou config.

---

## Áreas de Melhoria Conhecidas

1. **Testes** — nenhum teste implementado; infraestrutura existe (mocha + @vscode/test-electron)
2. ~~**Syntax highlighting**~~ — **implementado na v1.1.0** (`syntaxes/dbml.tmLanguage.json` + `language-configuration.json`)
3. **Bundler** — sem webpack/esbuild; adicionar reduziria o tamanho do pacote publicado
4. **Parser formal** — parser regex pode falhar em edge cases; migrar para `@dbml/core` adicionaria robustez mas quebraria a constraint de zero deps
5. **Layouts adicionais** — renderer tem 3 layouts mas só `compact` é exposto (sem UI para trocar layout no painel ou via config)
6. ~~**Configuração de tema**~~ — **implementado na v1.2.0** (CSS variables `--vscode-*` + `--erd-*`, listener `onDidChangeActiveColorTheme`)
7. ~~**Bug: fundo não respeitava tema**~~ — **corrigido na v1.2.1** (`<rect class="svg-background">` usa `var(--bg-main)`; `backgroundColor` removido de `RenderOptions` e do `package.json`; ver `docs/fix-theme-background.md`)
8. ~~**Limpeza:** remover `backgroundColor` morto de `extension.ts:50`~~ — **feito na v1.2.2**
9. ~~**Hover sem documentação de colunas:**~~ — **corrigido na v1.2.3** — tooltip exibe nota da tabela + tabela `Column | Type | Note` completa com modificadores e notas de coluna

---

## Como Trabalhar Neste Projeto

**Compilar:**
```powershell
npm run compile   # tsc uma vez
npm run watch     # tsc em modo watch (recomendado durante dev)
```

**No WSL — compilar e gerar .vsix:**
```bash
# Instalar dependências se necessário
npm install

# Compilar
npm run compile

# Gerar .vsix
npm run package
# Ou diretamente:
./node_modules/.bin/vsce package
# Resultado: dbml-preview-1.2.2.vsix
```

**Testar a extensão:**
- F5 no VS Code com a pasta aberta → lança "Extension Development Host"
- Abrir qualquer arquivo `.dbml` (use `examples/ecommerce.dbml`)
- Clicar no botão preview na barra do editor

**Versionamento (semver):**
- Bump `version` em `package.json` **sempre** que implementar uma melhoria ou corrigir um bug
- Nova feature → minor (`1.1.0` → `1.2.0`); Bug fix → patch (`1.2.0` → `1.2.1`); Breaking → major
- Após o bump, atualizar o campo `| Versão |` neste arquivo e marcar o item de "Áreas de Melhoria" como implementado

**Publicar:**
```powershell
npm run package   # gera dbml-preview-x.x.x.vsix
vsce publish      # publica no marketplace
```

**Adicionar features no webview:** editar `previewPanel.ts` — buscar `_getHtmlForWebview()` para o HTML/CSS/JS principal.

**Adicionar suporte a nova sintaxe DBML:** editar `parser.ts` — método `manualParse()` é o coração do parser.

**Alterar renderização SVG (tabelas, layouts, linhas):** editar `renderer.ts` — usado por ambos preview e exportSvg.

**Adicionar novo comando VS Code:** registrar em `extension.ts` + contribuir em `package.json > contributes.commands`.
