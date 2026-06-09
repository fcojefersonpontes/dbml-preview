# Fix: Fundo do Preview não Respeitava o Tema do VS Code

**Data:** 2026-06-09  
**Arquivos modificados:** `src/renderer.ts`, `src/previewPanel.ts`, `package.json`

---

## Descrição do Problema

Ao trocar o tema do VS Code de **dark** para **light**, o fundo (canvas) do painel de preview DBML permanecia escuro. O menu lateral e as tabelas se atualizavam corretamente para o tema light, mas a área de fundo do diagrama ficava com a cor escura `#1e1e1e`.

---

## Investigação

### Arquitetura do Painel

O preview é composto por duas camadas de renderização independentes:

| Elemento | Tecnologia | Comportamento |
|----------|-----------|---------------|
| Sidebar (menu lateral) | CSS com variáveis VS Code (`--vscode-*`) | Atualizava corretamente |
| Tabelas ERD (cards) | CSS class `.table-bg` com `var(--erd-table-bg)` | Atualizava corretamente |
| **Fundo do canvas** | Atributo `fill` hardcoded no SVG | **Não atualizava** |

### Por que o sidebar e as tabelas funcionavam?

O VS Code injeta automaticamente variáveis CSS e a classe `vscode-dark` / `vscode-light` no body do webview quando o tema muda. Qualquer elemento que use `var(--vscode-*)` ou `body.vscode-light { ... }` se atualiza sem necessidade de recarregar o HTML.

### Por que o fundo não funcionava?

**Causa raiz #1 — Atributo SVG hardcoded:**

Em `src/renderer.ts`, o retângulo de fundo do SVG era gerado com a cor embutida no atributo:

```typescript
// ANTES (bugado)
<rect width="100%" height="100%" fill="${this.options.backgroundColor}"/>
```

Atributos SVG com valores literais de cor não participam do sistema de CSS variables. Uma vez renderizado no HTML, o `fill="#1e1e1e"` ficava fixo.

**Causa raiz #2 — Default hardcoded no `package.json`:**

A opção de configuração `backgroundColor` tinha seu default definido no `package.json`:

```json
"dbmlPreviewer.backgroundColor": {
  "type": "string",
  "default": "#1e1e1e",
  "description": "Background color of the diagram"
}
```

Como o VS Code usa o `default` do `package.json` (não o fallback do TypeScript), a chamada em `previewPanel.ts`:

```typescript
backgroundColor: config.get('backgroundColor', isLight ? '#f5f5f5' : '#1e1e1e'),
```

**sempre** retornava `#1e1e1e` — o ternário `isLight ? '#f5f5f5' : '#1e1e1e'` nunca era avaliado.

Isso significava que mesmo com o listener `onDidChangeActiveColorTheme` chamando `_update()` ao trocar o tema, a cor do fundo continuava sendo `#1e1e1e`.

---

## Solução

### 1. Adicionada CSS class ao `<style>` interno do SVG (`src/renderer.ts`)

Em vez de embutir a cor no atributo, foi adicionada uma classe CSS que usa variáveis:

```typescript
// ANTES
.table-bg { fill: var(--erd-table-bg, #2a2a2a); }

// DEPOIS
.svg-background { fill: var(--bg-main, #1e1e1e); }
.table-bg { fill: var(--erd-table-bg, #2a2a2a); }
```

- O fallback `#1e1e1e` é usado quando a variável não está disponível (ex: arquivo SVG exportado aberto standalone)
- Em SVGs inline no HTML (como no webview), `var(--bg-main)` resolve corretamente para a variável do documento pai

### 2. Retângulo de fundo usa a nova classe (`src/renderer.ts`)

```typescript
// ANTES
<rect width="100%" height="100%" fill="${this.options.backgroundColor}"/>

// DEPOIS
<rect class="svg-background" width="100%" height="100%"/>
```

### 3. Atributo `fill` da tabela também corrigido (`src/renderer.ts`)

O retângulo de fundo das tabelas tinha `fill="#2a2a2a"` hardcoded, que sobrescrevia a classe CSS `.table-bg`. Corrigido para usar a variável diretamente:

```typescript
// ANTES
<rect class="table-bg" ... fill="#2a2a2a" .../>

// DEPOIS
<rect class="table-bg" ... fill="var(--erd-table-bg)" .../>
```

### 4. Removida a opção `backgroundColor` de `RenderOptions` (`src/renderer.ts`)

```typescript
// ANTES
export interface RenderOptions {
  defaultTableColor: string;
  defaultGroupColor: string;
  backgroundColor: string;        // ← removido
  showRelationshipLabels: boolean;
  layout: 'left-right' | 'snowflake' | 'compact';
}

// DEPOIS
export interface RenderOptions {
  defaultTableColor: string;
  defaultGroupColor: string;
  showRelationshipLabels: boolean;
  layout: 'left-right' | 'snowflake' | 'compact';
}
```

### 5. Removida a leitura de `backgroundColor` e detecção de tema desnecessária (`src/previewPanel.ts`)

```typescript
// ANTES
const config = vscode.workspace.getConfiguration('dbmlPreviewer');
const themeKind = vscode.window.activeColorTheme.kind;
const isLight = themeKind === vscode.ColorThemeKind.Light || themeKind === vscode.ColorThemeKind.HighContrastLight;
const options: RenderOptions = {
  defaultTableColor: config.get('defaultTableColor', '#3498db'),
  defaultGroupColor: config.get('defaultGroupColor', '#95a5a6'),
  backgroundColor: config.get('backgroundColor', isLight ? '#f5f5f5' : '#1e1e1e'),
  showRelationshipLabels: config.get('showRelationshipLabels', true),
  layout: 'compact'
};

// DEPOIS
const config = vscode.workspace.getConfiguration('dbmlPreviewer');
const options: RenderOptions = {
  defaultTableColor: config.get('defaultTableColor', '#3498db'),
  defaultGroupColor: config.get('defaultGroupColor', '#95a5a6'),
  showRelationshipLabels: config.get('showRelationshipLabels', true),
  layout: 'compact'
};
```

### 6. Removida a entrada `backgroundColor` do `package.json`

```json
// ANTES (causava o default permanentemente escuro)
"dbmlPreviewer.backgroundColor": {
  "type": "string",
  "default": "#1e1e1e",
  "description": "Background color of the diagram"
},

// DEPOIS — entrada removida completamente
```

---

## Comportamento após a correção

| Cenário | Resultado |
|---------|-----------|
| Tema dark | Fundo usa `--bg-main` → `--vscode-editor-background` (escuro) |
| Tema light | Fundo usa `--bg-main` → `--vscode-editor-background` (claro) |
| Troca de tema com preview aberto | Atualiza automaticamente via CSS, sem precisar fechar/reabrir |
| SVG exportado (arquivo standalone) | Usa fallback `#1e1e1e` definido na CSS class |

### Por que funciona sem recarregar o HTML?

Quando o VS Code muda de tema, ele:
1. Atualiza as variáveis CSS `--vscode-*` injetadas no webview
2. Troca a classe do body (`vscode-dark` ↔ `vscode-light`)

Como o retângulo de fundo agora usa `.svg-background { fill: var(--bg-main) }`, e `--bg-main` aponta para `--vscode-editor-background`, a cadeia de variáveis se atualiza automaticamente — sem necessidade de chamar `_update()`.

---

## Fluxo da cadeia de variáveis CSS

```
body.vscode-light ativado pelo VS Code
        ↓
--vscode-editor-background atualizado para cor clara
        ↓
:root { --bg-main: var(--vscode-editor-background, #1e1e1e) }
        ↓
.svg-background { fill: var(--bg-main, #1e1e1e) }
        ↓
<rect class="svg-background"> renderiza com cor clara
```

---

## Arquivos modificados

### `src/renderer.ts`
- Adicionada classe `.svg-background` ao `<style>` interno do SVG
- `<rect>` de fundo trocado de `fill="${backgroundColor}"` para `class="svg-background"`
- `<rect>` de tabelas trocado de `fill="#2a2a2a"` para `fill="var(--erd-table-bg)"`
- Campo `backgroundColor` removido de `RenderOptions`

### `src/previewPanel.ts`
- Removida detecção de `themeKind` e `isLight`
- Removida leitura de `config.get('backgroundColor', ...)`
- `RenderOptions` instanciado sem o campo `backgroundColor`

### `package.json`
- Removida a entrada de configuração `dbmlPreviewer.backgroundColor`
