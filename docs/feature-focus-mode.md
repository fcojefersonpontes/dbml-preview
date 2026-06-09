# Feature Spec: Focus Mode — Visualização Filtrada por Tabela

**Status:** Implementado ✅  
**Versão:** 1.3.0 (minor — nova feature de UX)  
**Autor:** JefersonPontes  

---

## 1. Objetivo

Em modelos de Data Warehouse com múltiplos star schemas em um único arquivo `.dbml`, o canvas fica lotado de tabelas. O usuário precisa de uma forma de **isolar e inspecionar** um único star schema (ou qualquer subgrafo em torno de uma tabela) sem precisar criar arquivos separados.

**Casos de uso principais:**
- Ver `fato_vendas` + todas as suas dimensões (star schema), ocultando os demais schemas
- Ver `dim_produto` + todas as tabelas que a referenciam ou que ela referencia (snowflake)
- Isolar rapidamente uma tabela central para apresentação / documentação

---

## 2. Comportamento Esperado

### 2.1 Ativação do Focus Mode

O usuário pode ativar o Focus Mode de **três formas**:

| Forma | Interação |
|-------|-----------|
| Clique direito na tabela no canvas | Menu de contexto → "Focus on this table" |
| Clique no ícone de foco na sidebar | Ícone 🎯 ao lado do nome da tabela na lista |
| Atalho de teclado | `F` enquanto uma tabela está selecionada (hover) |

### 2.2 Comportamento Visual

Ao entrar no Focus Mode com uma tabela `T` selecionada:

1. **Tabelas visíveis:** `T` + todas as tabelas que possuem um `Ref` direto com `T` (profundidade 1)
2. **Tabelas ocultas:** todas as demais tabelas — visualmente removidas do canvas
3. **Relacionamentos:** apenas as linhas de relacionamento entre as tabelas visíveis são renderizadas
4. **Indicador de modo:** banner/badge no topo do canvas — `"Focus: fato_vendas (5 tables)"` com botão `✕ Exit Focus`

### 2.3 Profundidade de Expansão

Um controle de profundidade permite expandir a vizinhança:

- **Depth 1** (padrão): tabela central + vizinhos diretos — ideal para star schema simples
- **Depth 2**: tabela central + vizinhos + vizinhos dos vizinhos — cobre snowflake
- **Depth N**: expansão recursiva completa do subgrafo conectado

O controle de profundidade fica visível somente enquanto o Focus Mode está ativo (ex: `−  1  +` no banner).

### 2.4 Comportamento do Layout no Focus Mode

- As tabelas visíveis são **reposicionadas** para ocupar bem o espaço disponível (`Fit to Screen` automático)
- As posições salvas no `.erd-layout.json` **não são sobrescritas** — o Focus Mode é sempre temporário
- Ao sair do Focus Mode (`✕` ou tecla `Escape`), o canvas volta ao estado anterior (posições, zoom, scroll)

### 2.5 Saída do Focus Mode

- Botão `✕ Exit Focus` no banner
- Tecla `Escape`
- Clicar em área vazia do canvas (fora de qualquer tabela)

---

## 3. Casos Especiais

### Star Schema
```
fato_vendas → dim_produto, dim_tempo, dim_cliente, dim_loja
```
Focus em `fato_vendas` com depth=1 mostra exatamente o star schema completo.

### Snowflake
```
fato_vendas → dim_produto → dim_categoria → dim_departamento
```
- depth=1: `fato_vendas` + `dim_produto` (dim_categoria oculta)
- depth=2: `fato_vendas` + `dim_produto` + `dim_categoria`
- depth=3: schema completo de snowflake

### Múltiplos Star Schemas isolados
```
fato_vendas  → dim_produto, dim_cliente
fato_estoque → dim_produto, dim_deposito
```
Focus em `fato_vendas` com depth=1 mostra `fato_vendas`, `dim_produto`, `dim_cliente` — `fato_estoque` e `dim_deposito` ficam ocultos. `dim_produto` aparece pois está diretamente ligado à tabela focal.

### Tabela sem relacionamentos
Focus em uma tabela isolada (sem refs) mostra apenas ela.

---

## 4. Arquitetura da Implementação

### 4.1 Grafo de Relacionamentos (puro JS no webview)

Toda a lógica de filtragem roda **no lado do webview** (JS inline em `previewPanel.ts`), sem round-trip para a extensão. O schema já está disponível no HTML como JSON embutido.

```javascript
// Estrutura de dados no webview
const adjacency = new Map(); // tableName → Set<tableName>
for (const ref of schemaRefs) {
  if (!adjacency.has(ref.fromTable)) adjacency.set(ref.fromTable, new Set());
  if (!adjacency.has(ref.toTable))   adjacency.set(ref.toTable, new Set());
  adjacency.get(ref.fromTable).add(ref.toTable);
  adjacency.get(ref.toTable).add(ref.fromTable);
}

function getNeighbors(startTable, depth) {
  const visible = new Set([startTable]);
  let frontier = new Set([startTable]);
  for (let d = 0; d < depth; d++) {
    const next = new Set();
    for (const t of frontier) {
      for (const neighbor of (adjacency.get(t) || [])) {
        if (!visible.has(neighbor)) { visible.add(neighbor); next.add(neighbor); }
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }
  return visible;
}
```

### 4.2 Aplicação do Filtro no SVG

As tabelas são representadas como `<g class="table-group" data-table="nome">` no SVG. O filtro funciona por **show/hide de elementos DOM** — não re-renderiza o SVG completo:

```javascript
function applyFocusFilter(visibleTables) {
  // Ocultar tabelas não visíveis
  document.querySelectorAll('g.table-group').forEach(el => {
    const name = el.dataset.table;
    el.style.display = visibleTables.has(name) ? '' : 'none';
  });

  // Ocultar relacionamentos que envolvem tabelas ocultas
  document.querySelectorAll('g.relationship-line').forEach(el => {
    const from = el.dataset.from;
    const to = el.dataset.to;
    el.style.display = (visibleTables.has(from) && visibleTables.has(to)) ? '' : 'none';
  });

  // Fit to screen das tabelas visíveis
  fitVisibleTablesToScreen();
}
```

> **Dependência crítica:** O SVG gerado (tanto pelo `renderer.ts` quanto pela pipeline interna do `previewPanel.ts`) **precisa adicionar `data-table`** em cada `<g>` de tabela e **`data-from`/`data-to`** em cada linha de relacionamento. Esta é a única mudança estrutural necessária no SVG.

### 4.3 Mudanças por Arquivo

| Arquivo | Mudança |
|---------|---------|
| `previewPanel.ts` | (1) Adicionar `data-table` nos `<g>` de tabelas e `data-from`/`data-to` nas linhas — **na função de geração SVG inline**; (2) Injetar estado de focus mode: `focusTable`, `focusDepth`, `savedViewState`; (3) Lógica JS de `getNeighbors`, `applyFocusFilter`, `exitFocusMode`; (4) UI: banner de focus, controle de depth, ícone 🎯 na sidebar |
| `renderer.ts` | Adicionar `data-table` nos `<g>` de tabelas e `data-from`/`data-to` nas linhas (beneficia o SVG exportado também — informação de metadados) |
| `package.json` | Bump `1.2.3` → `1.3.0` |
| `CLAUDE.md` | Atualizar versão e descrever Focus Mode |
| `.claude/commands/expert.md` | Atualizar versão + documentar a feature |

### 4.4 Estado de Focus Mode

```javascript
let focusState = null; // null = modo normal

// Ao ativar:
focusState = {
  focalTable: 'fato_vendas',
  depth: 1,
  savedTransform: currentTransform, // para restaurar ao sair
  savedScroll: { x, y }
};

// Ao sair:
focusState = null;
restoreTransform(savedTransform);
showAllTablesAndRefs();
```

### 4.5 Interação com Sidebar

A sidebar (aba "Tables") deve refletir o focus mode:
- Tabelas ocultas ficam com **opacity reduzida** (não removidas da lista)
- O ícone 🎯 ao lado do nome ativa o focus naquela tabela
- Ao clicar em uma tabela oculta (dimmed) na sidebar enquanto em focus mode → troca a tabela focal

---

## 5. UI/UX

### Banner de Focus Mode
```
┌─────────────────────────────────────────────────────────────────┐
│  🎯 Focus: fato_vendas   Depth: − 1 +   5 tables visible   ✕   │
└─────────────────────────────────────────────────────────────────┘
```
- Posição: topo do canvas (sticky, acima do SVG)
- Fundo: `var(--vscode-badge-background)` com texto `var(--vscode-badge-foreground)`
- Aparece apenas quando Focus Mode está ativo

### Context Menu no Canvas
Ao clicar direito em uma tabela (elemento `<g data-table="...">`):
```
┌──────────────────────────┐
│ 🎯 Focus on this table   │
│ → Go to definition       │
└──────────────────────────┘
```

### Ícone na Sidebar
```
● fato_vendas  (5 refs)  [🎯]
```
O ícone `🎯` aparece no hover da linha da tabela na sidebar.

---

## 6. O que NÃO muda

- Zoom, drag de tabelas, pan do canvas — **sem alteração** nos event listeners existentes
- Persistência de layout (`.erd-layout.json`) — Focus Mode é 100% temporário
- Comando `exportSvg` — exporta o estado atual (pode exportar o diagram filtrado se o usuário quiser)
- Parser (`parser.ts`) — sem mudança
- Estrutura de dados `DBMLSchema` — sem mudança

---

## 7. Plano de Implementação (ordem)

| Etapa | O que fazer | Risco |
|-------|-------------|-------|
| 1 | Adicionar `data-table` e `data-from`/`data-to` no SVG gerado por `previewPanel.ts` | Baixo — só adiciona atributos, não muda visual |
| 2 | Implementar `buildAdjacency()` e `getNeighbors()` no JS do webview | Baixo — lógica pura, sem DOM |
| 3 | Implementar `applyFocusFilter()` e `exitFocusMode()` + salvar/restaurar transform | Médio — manipula DOM do SVG; testar zoom/drag depois |
| 4 | Implementar banner de Focus Mode + controle de depth | Baixo — UI apenas |
| 5 | Adicionar ícone 🎯 na sidebar + context menu no canvas | Baixo — eventos adicionais, sem conflito |
| 6 | Adicionar `data-table`/`data-from`/`data-to` em `renderer.ts` (export) | Baixo — só metadados |
| 7 | Bump versão, atualizar docs, testar com `ecommerce-example.dbml` | — |

> **Critério de aceite:** Abrir `ecommerce-example.dbml` (26 tabelas, 6 schemas), focar em qualquer tabela com depth=1, confirmar que apenas as tabelas diretamente relacionadas aparecem; focar com depth=2 em uma tabela de snowflake e confirmar expansão correta; zoom e drag devem continuar funcionando normalmente dentro do focus mode.

---

## 8. Riscos e Mitigações

| Risco | Mitigação |
|-------|-----------|
| Focus mode quebrar zoom/drag (principal risco) | Implementar em etapas; `applyFocusFilter` usa apenas `display:none` — não altera event listeners existentes |
| `fitVisibleTablesToScreen` conflitar com pan/zoom state | Salvar e restaurar o transform explicitamente; não alterar `currentTransform` global durante o fit temporário |
| SVG de `previewPanel.ts` não ter seletores `data-table` compatíveis | Auditar a função de geração SVG inline **antes** de escrever o JS de filtro |
| Tabelas com schema prefix (`schema.table`) conflitando com keys do mapa | Usar chave composta `schema + '.' + name` consistentemente no mapa de adjacência |

---

## 9. Dependências

- Nenhuma nova dependência de produção
- Nenhuma mudança na API da extensão (sem novos comandos VSCode registrados — a feature é 100% dentro do webview)
