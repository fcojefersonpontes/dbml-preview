import * as vscode from 'vscode';
import { DBMLParser, DBMLSchema } from './parser';
import { ERDRenderer, RenderOptions, getRefVisualMetadata } from './renderer';
import * as fs from 'fs';
import * as path from 'path';

export class ERDPreviewPanel {
  public static currentPanel: ERDPreviewPanel | undefined;
  public static readonly viewType = 'dbmlPreview';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _document: vscode.TextDocument | undefined;
  private _disposables: vscode.Disposable[] = [];
  private _savedPositions: { [key: string]: { dx: number; dy: number } } | null = null;

  public static createOrShow(extensionUri: vscode.Uri, document: vscode.TextDocument) {
    const column = vscode.ViewColumn.Beside;
    if (ERDPreviewPanel.currentPanel) {
      ERDPreviewPanel.currentPanel._panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      ERDPreviewPanel.viewType, 'DBML Preview', column,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    ERDPreviewPanel.currentPanel = new ERDPreviewPanel(panel, extensionUri, document);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, document: vscode.TextDocument) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._document = document;
    this._loadSavedLayout();
    this._update();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(async message => {
      switch (message.command) {
        case 'refresh': this._loadSavedLayout(); this._update(); break;
        case 'goToTable': this._goToTableInEditor(message.tableName, message.schema); break;
        case 'goToColumn': this._goToColumnInEditor(message.tableName, message.columnName, message.schema); break;
        case 'saveLayout': await this._saveLayout(message.positions); break;
        case 'exportSvg': await this._exportSvg(message.svgContent); break;
      }
    }, null, this._disposables);
    vscode.window.onDidChangeActiveColorTheme(() => this._update(), null, this._disposables);
  }

  private _getLayoutFilePath(): string | null {
    if (!this._document) return null;
    return this._document.uri.fsPath.replace(/\.dbml$/, '.erd-layout.json');
  }

  private _loadSavedLayout(): void {
    const layoutPath = this._getLayoutFilePath();
    if (!layoutPath) return;
    try {
      if (fs.existsSync(layoutPath)) {
        const data = JSON.parse(fs.readFileSync(layoutPath, 'utf-8'));
        this._savedPositions = data.positions || null;
      }
    } catch (e) { console.error('Failed to load layout:', e); }
  }

  private async _saveLayout(positions: { [key: string]: { dx: number; dy: number } }): Promise<void> {
    const layoutPath = this._getLayoutFilePath();
    if (!layoutPath) { vscode.window.showErrorMessage('Cannot save layout: no document open'); return; }
    try {
      fs.writeFileSync(layoutPath, JSON.stringify({ version: 1, positions, savedAt: new Date().toISOString() }, null, 2));
      this._savedPositions = positions;
      vscode.window.showInformationMessage(`Layout saved to ${path.basename(layoutPath)}`);
    } catch (e: any) { vscode.window.showErrorMessage(`Failed to save layout: ${e.message}`); }
  }

  private async _exportSvg(svgContent: string): Promise<void> {
    const defaultName = this._document ? path.basename(this._document.fileName, '.dbml') + '.svg' : 'diagram.svg';
    try {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(defaultName),
        filters: { 'SVG Files': ['svg'] }
      });
      if (uri) {
        fs.writeFileSync(uri.fsPath, svgContent);
        vscode.window.showInformationMessage(`SVG exported to ${path.basename(uri.fsPath)}`);
      }
    } catch (e: any) { vscode.window.showErrorMessage(`Failed to export SVG: ${e.message}`); }
  }

  public dispose() {
    ERDPreviewPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) { const x = this._disposables.pop(); if (x) x.dispose(); }
  }

  private async _goToTableInEditor(tableName: string, schema?: string) {
    if (!this._document) return;
    const text = this._document.getText();
    const searchName = schema ? `${schema}\\.${tableName}` : tableName;
    const match = text.match(new RegExp(`Table\\s+${searchName}\\s*`, 'i'));
    if (match?.index !== undefined) {
      const pos = this._document.positionAt(match.index);
      const editor = await vscode.window.showTextDocument(this._document, { viewColumn: vscode.ViewColumn.One });
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
  }

  private async _goToColumnInEditor(tableName: string, columnName: string, schema?: string) {
    if (!this._document) return;
    const text = this._document.getText();
    const searchName = schema ? `${schema}\\.${tableName}` : tableName;
    const tableMatch = text.match(new RegExp(`Table\\s+${searchName}\\s*(?:as\\s+\\w+)?\\s*(?:\\[[^\\]]*\\])?\\s*\\{([^}]*)\\}`, 'is'));
    if (tableMatch?.index !== undefined) {
      const colMatch = tableMatch[1].match(new RegExp(`^\\s*${columnName}\\s+`, 'm'));
      if (colMatch?.index !== undefined) {
        const idx = tableMatch.index + tableMatch[0].indexOf(tableMatch[1]) + colMatch.index;
        const pos = this._document.positionAt(idx);
        const editor = await vscode.window.showTextDocument(this._document, { viewColumn: vscode.ViewColumn.One });
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      }
    }
  }

  private async _update() {
    if (!this._document) return;
    const config = vscode.workspace.getConfiguration('dbmlPreviewer');
    const options: RenderOptions = {
      defaultTableColor: config.get('defaultTableColor', '#3498db'),
      defaultGroupColor: config.get('defaultGroupColor', '#95a5a6'),
      showRelationshipLabels: config.get('showRelationshipLabels', true),
      layout: 'compact'
    };
    try {
      const parser = new DBMLParser();
      const schema = parser.parse(this._document.getText());
      const renderer = new ERDRenderer(options);
      const svg = renderer.render(schema);
      this._panel.webview.html = this._getHtmlForWebview(svg, schema);
    } catch (error: any) {
      this._panel.webview.html = this._getErrorHtml(error.message);
    }
  }

  private _getHtmlForWebview(svg: string, schema: DBMLSchema): string {
    const nonce = this._getNonce();
    const docName = this._document ? path.basename(this._document.fileName, '.dbml') : 'diagram';
    
    // Build map of table colors from groups
    const tableColorFromGroup = new Map<string, string>();
    const schemaColorMap = new Map<string, string>();
    
    for (const group of schema.tableGroups) {
      const color = group.color || '#95a5a6';
      for (const tableRef of group.tables) {
        const tableName = tableRef.includes('.') ? tableRef.split('.').pop()! : tableRef;
        const schemaName = tableRef.includes('.') ? tableRef.split('.')[0] : '';
        tableColorFromGroup.set(tableName, color);
        if (schemaName && !schemaColorMap.has(schemaName)) {
          schemaColorMap.set(schemaName, color);
        }
      }
    }
    
    // Group tables by schema
    const tablesBySchema = new Map<string, typeof schema.tables>();
    tablesBySchema.set('', []);
    for (const table of schema.tables) {
      const schemaName = table.schema || '';
      if (!tablesBySchema.has(schemaName)) tablesBySchema.set(schemaName, []);
      tablesBySchema.get(schemaName)!.push(table);
    }
    
    // Build sidebar HTML
    let tableListHtml = '';
    const sortedSchemas = Array.from(tablesBySchema.keys()).sort((a, b) => {
      if (a === '') return -1;
      if (b === '') return 1;
      return a.localeCompare(b);
    });
    
    for (const schemaName of sortedSchemas) {
      const tables = tablesBySchema.get(schemaName)!;
      if (tables.length === 0) continue;
      
      const schemaColor = schemaColorMap.get(schemaName) || '#3498db';
      
      if (schemaName) {
        tableListHtml += `<div class="schema-group">
          <div class="schema-header" data-schema="${schemaName}">
            <span class="schema-toggle">▼</span>
            <span class="schema-dot" style="background:${schemaColor}"></span>
            <span class="schema-name">${schemaName}</span>
            <span class="schema-count">${tables.length}</span>
          </div>
          <div class="schema-tables">`;
      }
      
      for (const t of tables) {
        const color = tableColorFromGroup.get(t.name) || t.color || t.headerColor || '#3498db';
        const relCount = schema.refs.filter(r => r.fromTable === t.name || r.toTable === t.name).length;
        tableListHtml += `<div class="table-item" data-table="${t.name}" data-schema="${schemaName || ''}">
          <span class="color-dot" style="background:${color}"></span>
          <div class="table-info">
            <span class="table-name">${t.name}</span>
            <span class="table-meta">${t.columns.length} cols · ${relCount} rels</span>
          </div>
          <button class="focus-btn" data-table="${t.name}" title="Focus on this table">🎯</button>
        </div>`;
      }
      
      if (schemaName) tableListHtml += `</div></div>`;
    }

    const refList = schema.refs.map((r, index) => {
      const fc = r.fromRelation === '*' ? 'N' : '1';
      const tc = r.toRelation === '*' ? 'N' : '1';
      const visual = getRefVisualMetadata(r, index);
      const fromColumns = r.fromColumns.length > 1 ? `(${r.fromColumns.join(', ')})` : r.fromColumns[0];
      const toColumns = r.toColumns.length > 1 ? `(${r.toColumns.join(', ')})` : r.toColumns[0];
      return `<div class="ref-item${visual.composite ? ' composite-ref-item' : ''}" data-ref-id="${visual.id}" style="--constraint-accent:${visual.accent}">
        <div class="ref-tables"><span class="ref-table">${r.fromTable}</span>
        <span class="ref-card">${fc}:${tc}</span><span class="ref-table">${r.toTable}</span></div>
        ${visual.composite ? '<span class="composite-badge">COMPOSITE</span>' : ''}
        <div class="ref-cols"><span>${fromColumns}</span><span class="arr">→</span><span>${toColumns}</span></div>
      </div>`;
    }).join('');

    const normalizedGroups = schema.tableGroups.map(g => ({
      name: g.name,
      tables: g.tables.map(t => t.includes('.') ? t.split('.').pop()! : t),
      color: g.color || '#95a5a6'
    }));
    const groupsData = JSON.stringify(normalizedGroups);
    const savedPositionsData = JSON.stringify(this._savedPositions || {});
    const schemaRefsData = JSON.stringify(schema.refs.map((r, index) => {
      const visual = getRefVisualMetadata(r, index);
      return {
        ...visual,
        fromTable: r.fromTable,
        fromColumns: r.fromColumns,
        toTable: r.toTable,
        toColumns: r.toColumns
      };
    }));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>DBML Preview</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{height:100%;overflow:hidden}
    :root{
      --bg-main:var(--vscode-editor-background,#1e1e1e);
      --bg-side:var(--vscode-sideBar-background,#252526);
      --bg-item:var(--vscode-list-inactiveSelectionBackground,#2a2a2a);
      --fg-main:var(--vscode-editor-foreground,#e0e0e0);
      --fg-muted:var(--vscode-descriptionForeground,#888);
      --fg-bright:var(--vscode-titleBar-activeForeground,#fff);
      --border:var(--vscode-panel-border,var(--vscode-sideBar-border,#3c3c3c));
      --hover:var(--vscode-list-hoverBackground,#37373d);
      --accent:var(--vscode-button-background,#0e639c);
      --accent-hover:var(--vscode-button-hoverBackground,#1177bb);
      --accent-fg:var(--vscode-button-foreground,#fff);
      --btn-sec:var(--vscode-button-secondaryBackground,#3c3c3c);
      --btn-sec-hover:var(--vscode-button-secondaryHoverBackground,#4c4c4c);
      --list-sel:var(--vscode-list-activeSelectionBackground,rgba(14,99,156,0.2));
      --tooltip-bg:var(--vscode-editorWidget-background,#252526);
    }
    body.vscode-dark,:root{--erd-table-bg:#2a2a2a;--erd-text-primary:#e0e0e0;--erd-text-muted:#888;--erd-card-bg:#1e1e1e;--erd-row-alt:rgba(255,255,255,0.02);--erd-separator:rgba(255,255,255,0.05)}
    body.vscode-light{--erd-table-bg:#f5f5f5;--erd-text-primary:#1e1e1e;--erd-text-muted:#666;--erd-card-bg:#e0e0e0;--erd-row-alt:rgba(0,0,0,0.02);--erd-separator:rgba(0,0,0,0.06)}
    body.vscode-high-contrast{--erd-table-bg:#000;--erd-text-primary:#fff;--erd-text-muted:#ccc;--erd-card-bg:#000;--erd-row-alt:rgba(255,255,255,0.04);--erd-separator:rgba(255,255,255,0.1)}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg-main);color:var(--fg-main);display:flex;height:100vh}
    .sidebar{width:260px;min-width:260px;background:var(--bg-side);border-right:1px solid var(--border);display:flex;flex-direction:column;height:100%}
    .sidebar-header{padding:12px 14px;border-bottom:1px solid var(--border);flex-shrink:0}
    .sidebar-header h3{font-size:14px;font-weight:600;color:var(--fg-bright)}
    .sidebar-tabs{display:flex;border-bottom:1px solid var(--border);flex-shrink:0}
    .sidebar-tab{flex:1;padding:10px;text-align:center;font-size:12px;cursor:pointer;border-bottom:2px solid transparent;color:var(--fg-main)}
    .sidebar-tab:hover{background:var(--hover)}
    .sidebar-tab.active{border-bottom-color:var(--accent);color:var(--accent)}
    .sidebar-content{flex:1;overflow-y:auto;overflow-x:hidden}
    .tab-panel{display:none;padding:10px}
    .tab-panel.active{display:block}
    .section{margin-bottom:14px}
    .section-title{font-size:11px;text-transform:uppercase;color:var(--fg-muted);margin-bottom:6px;letter-spacing:.5px}
    .schema-group{margin-bottom:8px}
    .schema-header{display:flex;align-items:center;padding:6px 8px;background:var(--bg-item);border-radius:4px;cursor:pointer;gap:6px}
    .schema-header:hover{background:var(--hover)}
    .schema-toggle{font-size:10px;color:var(--fg-muted);transition:transform .2s}
    .schema-header.collapsed .schema-toggle{transform:rotate(-90deg)}
    .schema-dot{width:10px;height:10px;border-radius:2px;flex-shrink:0}
    .schema-name{font-size:12px;font-weight:500;flex:1;color:var(--fg-main)}
    .schema-count{font-size:10px;color:var(--fg-muted);background:var(--border);padding:2px 6px;border-radius:10px}
    .schema-tables{padding-left:12px;margin-top:4px}
    .schema-header.collapsed + .schema-tables{display:none}
    .table-item,.ref-item{display:flex;align-items:flex-start;padding:6px 8px;border-radius:4px;cursor:pointer;margin-bottom:2px}
    .table-item:hover,.ref-item:hover{background:var(--hover)}
    .table-item.highlighted{background:var(--list-sel);outline:1px solid var(--accent)}
    .color-dot{width:10px;height:10px;border-radius:2px;margin-right:8px;margin-top:3px;flex-shrink:0}
    .table-info{display:flex;flex-direction:column;min-width:0}
    .table-name{font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--fg-main)}
    .table-meta{font-size:10px;color:var(--fg-muted);margin-top:1px}
    .ref-item{flex-direction:column;padding:8px;background:var(--bg-item)}
    .ref-tables{display:flex;align-items:center;gap:6px;margin-bottom:3px}
    .ref-table{font-size:11px;font-weight:500;color:#64b5f6}
    .ref-card{font-size:9px;background:var(--border);padding:2px 5px;border-radius:3px;color:#ffd700;font-weight:bold}
    .ref-cols{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--fg-muted)}
    .arr{color:#64b5f6}
    .composite-ref-item{border-left:3px solid var(--constraint-accent);padding-left:7px}
    .composite-badge{font-size:8px;font-weight:700;letter-spacing:.5px;color:var(--constraint-accent);border:1px solid var(--constraint-accent);border-radius:3px;padding:1px 4px;margin:1px 0 4px}
    .ref-item.constraint-highlighted{outline:1px solid var(--constraint-accent);background:var(--hover)}
    .main-content{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
    .toolbar{display:flex;align-items:center;padding:6px 12px;background:var(--bg-side);border-bottom:1px solid var(--border);gap:6px;flex-shrink:0}
    .toolbar button{background:var(--accent);color:var(--accent-fg);border:none;padding:5px 10px;border-radius:4px;cursor:pointer;font-size:11px;display:flex;align-items:center;gap:4px;white-space:nowrap}
    .toolbar button:hover{background:var(--accent-hover)}
    .toolbar button.secondary{background:var(--btn-sec);color:var(--fg-main)}
    .toolbar button.secondary:hover{background:var(--btn-sec-hover)}
    .toolbar button.success{background:#2e7d32;color:#fff}
    .toolbar button.success:hover{background:#388e3c}
    .toolbar-sep{width:1px;height:20px;background:var(--border);margin:0 2px}
    .zoom-controls{display:flex;align-items:center;gap:3px;margin-left:auto}
    .zoom-controls button{background:var(--btn-sec);color:var(--fg-main);padding:5px 8px;min-width:28px;justify-content:center}
    .zoom-level{font-size:11px;color:var(--fg-muted);min-width:40px;text-align:center}
    .canvas-container{flex:1;overflow:hidden;position:relative;background:var(--bg-main)}
    .canvas-scroll{width:100%;height:100%;overflow:auto}
    .canvas{display:inline-block;transform-origin:0 0;cursor:grab;min-width:100%;min-height:100%}
    .canvas:active{cursor:grabbing}
    .canvas svg{display:block}
    .canvas svg .table{cursor:move}
    .canvas svg .table:hover{filter:brightness(1.1)}
    .canvas svg .table.selected{filter:drop-shadow(0 0 8px var(--accent,#0e639c))}
    .canvas svg .table.dragging{opacity:.8}
    .canvas svg .table-group{cursor:move;pointer-events:all}
    .canvas svg .table-group rect{pointer-events:all}
    .canvas svg .table-group.dragging rect{stroke-width:3;filter:brightness(1.2)}
    .canvas svg .relationship{cursor:pointer}
    .canvas svg .relationship:hover .relation-line{stroke:#90caf9!important;stroke-opacity:1!important;stroke-width:3!important}
    .canvas svg .relationship.highlighted .relation-line{stroke:#ffd700!important;stroke-opacity:1!important;stroke-width:3!important}
    .canvas svg .relationship.composite-relationship.constraint-highlighted .relation-line,.canvas svg .relationship.composite-relationship.highlighted .relation-line{stroke:var(--constraint-accent)!important;stroke-opacity:1!important;stroke-width:4!important;filter:url(#glow)}
    .stats{padding:6px 12px;background:var(--bg-side);border-top:1px solid var(--border);font-size:10px;color:var(--fg-muted);display:flex;gap:16px;flex-shrink:0}
    .stat-item{display:flex;align-items:center;gap:4px}
    .stat-value{color:var(--fg-main);font-weight:600}
    .tooltip{position:fixed;background:var(--tooltip-bg);color:var(--fg-main);padding:6px 10px;border-radius:4px;font-size:11px;pointer-events:none;z-index:1000;display:none;max-width:250px;border:1px solid var(--border)}
    .tooltip.visible{display:block}
    .tooltip-title{font-weight:600;margin-bottom:2px}
    .tooltip-content{color:var(--fg-muted);font-size:10px;white-space:pre-line}
    .save-status{font-size:10px;margin-left:4px}
    .save-status.saved{color:#4caf50}
    .save-status.unsaved{color:#ff9800}
    .focus-banner{display:none;align-items:center;gap:10px;padding:6px 14px;background:var(--vscode-badge-background,#0e639c);color:var(--vscode-badge-foreground,#fff);font-size:12px;flex-shrink:0;border-bottom:1px solid var(--border)}
    .focus-banner.visible{display:flex}
    .focus-banner strong{font-weight:700}
    .focus-count{opacity:.85;font-size:11px}
    .focus-depth-ctrl{display:flex;align-items:center;gap:4px;margin-left:6px}
    .focus-depth-ctrl button{background:rgba(255,255,255,.2);color:inherit;border:none;padding:2px 7px;border-radius:3px;cursor:pointer;font-size:13px;line-height:1}
    .focus-depth-ctrl button:hover{background:rgba(255,255,255,.35)}
    .focus-depth-val{min-width:18px;text-align:center;font-weight:600}
    .focus-exit{margin-left:auto;background:rgba(255,255,255,.15);color:inherit;border:none;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:11px;font-weight:600}
    .focus-exit:hover{background:rgba(255,255,255,.3)}
    .table-item{position:relative}
    .focus-btn{display:none;position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:13px;padding:2px 4px;opacity:.7;border-radius:3px}
    .focus-btn:hover{opacity:1;background:var(--hover)}
    .table-item:hover .focus-btn{display:block}
    .table-item.focus-dimmed{opacity:.3}
    .table-item.focus-dimmed .focus-btn{display:none}
  </style>
</head>
<body>
  <div class="sidebar">
    <div class="sidebar-header"><h3>📊 DBML Previewer</h3></div>
    <div class="sidebar-tabs">
      <div class="sidebar-tab active" data-tab="tables">Tables</div>
      <div class="sidebar-tab" data-tab="relations">Relations</div>
    </div>
    <div class="sidebar-content">
      <div class="tab-panel active" data-panel="tables">
        <div class="section">
          <div class="section-title">Tables (${schema.tables.length})</div>
          ${tableListHtml || '<p style="color:#666;font-size:11px;">No tables</p>'}
        </div>
      </div>
      <div class="tab-panel" data-panel="relations">
        <div class="section">
          <div class="section-title">Relationships (${schema.refs.length})</div>
          ${schema.refs.length > 0 ? refList : '<p style="color:#666;font-size:11px;">No relationships</p>'}
        </div>
      </div>
    </div>
  </div>
  
  <div class="main-content">
    <div class="toolbar">
      <button id="btnRefresh" title="Reload from DBML file">↻ Refresh</button>
      <button class="secondary" id="btnExport">⬇ Export SVG</button>
      <div class="toolbar-sep"></div>
      <button class="success" id="btnSave" title="Ctrl+S">💾 Save</button>
      <span class="save-status" id="saveStatus"></span>
      <div class="toolbar-sep"></div>
      <button class="secondary" id="btnFit">⊡ Fit</button>
      <button class="secondary" id="btnReset">↺ Reset</button>
      <div class="zoom-controls">
        <button id="btnZoomOut">−</button>
        <span class="zoom-level" id="zoomLevel">100%</span>
        <button id="btnZoomIn">+</button>
      </div>
    </div>
    
    <div class="focus-banner" id="focusBanner">
      <span>🎯 Focus: <strong id="focusTableName"></strong></span>
      <span class="focus-count" id="focusCount"></span>
      <div class="focus-depth-ctrl">
        Depth: <button id="btnDepthDec">−</button><span class="focus-depth-val" id="focusDepthVal">1</span><button id="btnDepthInc">+</button>
      </div>
      <button class="focus-exit" id="btnExitFocus">✕ Exit Focus</button>
    </div>

    <div class="canvas-container" id="canvasContainer">
      <div class="canvas-scroll" id="canvasScroll">
        <div class="canvas" id="canvas">${svg}</div>
      </div>
    </div>
    
    <div class="stats">
      <div class="stat-item"><span>Tables:</span><span class="stat-value">${schema.tables.length}</span></div>
      <div class="stat-item"><span>Rels:</span><span class="stat-value">${schema.refs.length}</span></div>
      <div class="stat-item"><span>Groups:</span><span class="stat-value">${schema.tableGroups.length}</span></div>
    </div>
  </div>
  
  <div class="tooltip" id="tooltip"><div class="tooltip-title"></div><div class="tooltip-content"></div></div>
  
  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      const canvas = document.getElementById('canvas');
      const canvasScroll = document.getElementById('canvasScroll');
      const container = document.getElementById('canvasContainer');
      const tooltip = document.getElementById('tooltip');
      const saveStatus = document.getElementById('saveStatus');
      const docName = '${docName}';
      
      const groups = ${groupsData};
      const savedPositions = ${savedPositionsData};
      const schemaRefs = ${schemaRefsData};
      const refsById = new Map(schemaRefs.map(ref => [ref.id, ref]));
      let pinnedCompositeRefIds = [];
      let hoveredCompositeRefIds = [];

      function normalizeCompositeRefIds(ids) {
        return Array.from(new Set(ids)).filter(id => {
          const ref = refsById.get(id);
          return ref && ref.composite;
        });
      }

      function sameRefIds(left, right) {
        return left.length === right.length && left.every((id, index) => id === right[index]);
      }

      function getCompositeMapping(ref) {
        return ref.fromTable + '.(' + ref.fromColumns.join(', ') + ') → ' +
          ref.toTable + '.(' + ref.toColumns.join(', ') + ')';
      }

      function clearCompositeHighlights() {
        canvas.querySelectorAll('.column.composite-highlighted').forEach(column => {
          column.classList.remove('composite-highlighted');
          column.style.removeProperty('--composite-highlight');
        });
        canvas.querySelectorAll('.relationship.constraint-highlighted')
          .forEach(rel => rel.classList.remove('constraint-highlighted'));
        document.querySelectorAll('.ref-item.constraint-highlighted')
          .forEach(item => item.classList.remove('constraint-highlighted'));
      }

      function renderCompositeHighlights() {
        clearCompositeHighlights();
        const activeIds = hoveredCompositeRefIds.length > 0 ? hoveredCompositeRefIds : pinnedCompositeRefIds;
        activeIds.forEach(id => {
          const ref = refsById.get(id);
          if (!ref || !ref.composite) return;
          const rel = canvas.querySelector('.relationship[data-ref-id="' + id + '"]');
          const item = document.querySelector('.ref-item[data-ref-id="' + id + '"]');
          if (rel) rel.classList.add('constraint-highlighted');
          if (item) item.classList.add('constraint-highlighted');
          canvas.querySelectorAll('.column[data-composite-refs~="' + id + '"]').forEach(column => {
            column.classList.add('composite-highlighted');
            if (!column.style.getPropertyValue('--composite-highlight')) {
              column.style.setProperty('--composite-highlight', ref.accent);
            }
          });
        });
      }

      function setHoveredCompositeRefs(ids) {
        const normalized = normalizeCompositeRefIds(ids);
        if (sameRefIds(normalized, hoveredCompositeRefIds)) return;
        hoveredCompositeRefIds = normalized;
        renderCompositeHighlights();
      }

      function pinCompositeRefs(ids) {
        pinnedCompositeRefIds = normalizeCompositeRefIds(ids);
        canvas.querySelectorAll('.table.selected').forEach(table => table.classList.remove('selected'));
        document.querySelectorAll('.table-item.highlighted').forEach(item => item.classList.remove('highlighted'));
        canvas.querySelectorAll('.relationship.highlighted').forEach(rel => rel.classList.remove('highlighted'));
        pinnedCompositeRefIds.forEach(id => {
          const rel = canvas.querySelector('.relationship[data-ref-id="' + id + '"]');
          if (rel) rel.classList.add('highlighted');
        });
        renderCompositeHighlights();
      }

      function clearCompositeSelection() {
        pinnedCompositeRefIds = [];
        hoveredCompositeRefIds = [];
        clearCompositeHighlights();
      }

      function compositeIdsFromColumn(column) {
        return column && column.dataset.compositeRefs
          ? column.dataset.compositeRefs.split(/\\s+/).filter(Boolean)
          : [];
      }

      function compositeTooltip(ids) {
        return normalizeCompositeRefIds(ids)
          .map(id => getCompositeMapping(refsById.get(id)))
          .join('\\n');
      }

      // --- Focus Mode state ---
      let focusState = null; // null = normal mode; { focalTable, depth } when active

      function buildAdjacency() {
        const adj = new Map();
        schemaRefs.forEach(r => {
          if (!adj.has(r.fromTable)) adj.set(r.fromTable, new Set());
          if (!adj.has(r.toTable))   adj.set(r.toTable, new Set());
          adj.get(r.fromTable).add(r.toTable);
          adj.get(r.toTable).add(r.fromTable);
        });
        return adj;
      }

      function getNeighbors(startTable, depth) {
        const adj = buildAdjacency();
        const visible = new Set([startTable]);
        let frontier = new Set([startTable]);
        for (let d = 0; d < depth; d++) {
          const next = new Set();
          frontier.forEach(t => { (adj.get(t) || new Set()).forEach(n => { if (!visible.has(n)) { visible.add(n); next.add(n); } }); });
          frontier = next;
          if (!frontier.size) break;
        }
        return visible;
      }

      function fitVisibleTables(visibleTables) {
        let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0, found = false;
        visibleTables.forEach(name => {
          const p = tablePositions[name];
          if (p) { found = true; minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x + p.width); maxY = Math.max(maxY, p.y + p.height); }
        });
        if (!found) return;
        const pad = 60;
        const w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
        const rect = container.getBoundingClientRect();
        zoom = Math.min((rect.width - 20) / w, (rect.height - 20) / h, 2);
        updateZoom();
        canvasScroll.scrollLeft = (minX - pad) * zoom;
        canvasScroll.scrollTop  = (minY - pad) * zoom;
      }

      function applyFocusFilter(visibleTables) {
        canvas.querySelectorAll('.table').forEach(el => {
          el.style.display = visibleTables.has(el.dataset.table) ? '' : 'none';
        });
        canvas.querySelectorAll('.relationship').forEach(el => {
          const from = el.dataset.fromTable, to = el.dataset.toTable;
          el.style.display = (visibleTables.has(from) && visibleTables.has(to)) ? '' : 'none';
        });
        document.querySelectorAll('.table-item').forEach(el => {
          if (visibleTables.has(el.dataset.table)) el.classList.remove('focus-dimmed');
          else el.classList.add('focus-dimmed');
        });
      }

      function clearFocusFilter() {
        canvas.querySelectorAll('.table').forEach(el => { el.style.display = ''; });
        canvas.querySelectorAll('.relationship').forEach(el => { el.style.display = ''; });
        document.querySelectorAll('.table-item').forEach(el => el.classList.remove('focus-dimmed'));
      }

      function updateFocusBanner() {
        const banner = document.getElementById('focusBanner');
        if (!focusState) { banner.classList.remove('visible'); return; }
        banner.classList.add('visible');
        document.getElementById('focusTableName').textContent = focusState.focalTable;
        document.getElementById('focusDepthVal').textContent = focusState.depth;
        const vis = getNeighbors(focusState.focalTable, focusState.depth);
        document.getElementById('focusCount').textContent = vis.size + ' table' + (vis.size !== 1 ? 's' : '') + ' visible';
      }

      function activateFocusMode(tableName, depth) {
        focusState = { focalTable: tableName, depth: depth || 1 };
        const visible = getNeighbors(tableName, focusState.depth);
        applyFocusFilter(visible);
        updateFocusBanner();
        setTimeout(() => fitVisibleTables(visible), 30);
      }

      function exitFocusMode() {
        focusState = null;
        clearFocusFilter();
        updateFocusBanner();
      }

      // Focus banner controls
      document.getElementById('btnExitFocus').addEventListener('click', exitFocusMode);
      document.getElementById('btnDepthInc').addEventListener('click', () => {
        if (!focusState) return;
        focusState.depth = Math.min(focusState.depth + 1, 10);
        const visible = getNeighbors(focusState.focalTable, focusState.depth);
        applyFocusFilter(visible);
        updateFocusBanner();
        setTimeout(() => fitVisibleTables(visible), 30);
      });
      document.getElementById('btnDepthDec').addEventListener('click', () => {
        if (!focusState) return;
        focusState.depth = Math.max(focusState.depth - 1, 1);
        const visible = getNeighbors(focusState.focalTable, focusState.depth);
        applyFocusFilter(visible);
        updateFocusBanner();
        setTimeout(() => fitVisibleTables(visible), 30);
      });

      // Sidebar focus buttons
      document.querySelectorAll('.focus-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          activateFocusMode(this.dataset.table, focusState ? focusState.depth : 1);
        });
      });

      // Context menu on right-click in canvas
      const ctxMenu = document.createElement('div');
      ctxMenu.id = 'ctxMenu';
      ctxMenu.style.cssText = 'position:fixed;z-index:9999;background:var(--tooltip-bg);border:1px solid var(--border);border-radius:4px;padding:4px 0;display:none;min-width:180px;box-shadow:0 4px 12px rgba(0,0,0,.4)';
      document.body.appendChild(ctxMenu);

      function hideCtxMenu() { ctxMenu.style.display = 'none'; }

      canvas.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        hideCtxMenu();
        const tableEl = e.target.closest('.table');
        if (!tableEl) return;
        const name = tableEl.dataset.table;
        ctxMenu.innerHTML = '<div style="padding:6px 14px;font-size:12px;color:var(--fg-muted);border-bottom:1px solid var(--border);margin-bottom:4px">' + name + '</div>' +
          '<div class="ctx-item" style="padding:6px 14px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:8px" data-action="focus" data-table="' + name + '">🎯 Focus on this table</div>' +
          '<div class="ctx-item" style="padding:6px 14px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:8px" data-action="goto" data-table="' + name + '">→ Go to definition</div>';
        ctxMenu.style.display = 'block';
        ctxMenu.style.left = e.clientX + 'px';
        ctxMenu.style.top  = e.clientY + 'px';
        ctxMenu.querySelectorAll('.ctx-item').forEach(item => {
          item.addEventListener('mouseover', function() { this.style.background = 'var(--hover)'; });
          item.addEventListener('mouseout',  function() { this.style.background = ''; });
          item.addEventListener('click', function() {
            hideCtxMenu();
            if (this.dataset.action === 'focus') activateFocusMode(this.dataset.table, focusState ? focusState.depth : 1);
            if (this.dataset.action === 'goto')  vscode.postMessage({ command: 'goToTable', tableName: this.dataset.table });
          });
        });
      });
      document.addEventListener('click', hideCtxMenu);
      document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCtxMenu(); });
      // --- End Focus Mode state ---

      let zoom = 1;
      let isPanning = false;
      let isDraggingTable = false;
      let isDraggingGroup = false;
      let dragTarget = null;
      let dragGroupName = null;
      let dragStartX, dragStartY;
      let dragInitialOffsets = {};
      let panStartX, panStartY, scrollStartX, scrollStartY;
      let tablePositions = {};
      let originalPositions = {};
      let tableOffsets = {};
      let hasUnsavedChanges = false;
      let shiftKeyDown = false;
      
      document.addEventListener('keydown', e => { if (e.key === 'Shift') shiftKeyDown = true; });
      document.addEventListener('keyup', e => { if (e.key === 'Shift') shiftKeyDown = false; });
      
      function initPositions() {
        const svg = canvas.querySelector('svg');
        if (svg && svg.dataset.positions) {
          try {
            JSON.parse(svg.dataset.positions).forEach(p => {
              tablePositions[p.name] = { x: p.x, y: p.y, width: p.width, height: p.height };
              originalPositions[p.name] = { x: p.x, y: p.y, width: p.width, height: p.height };
              tableOffsets[p.name] = { dx: 0, dy: 0 };
            });
            if (savedPositions && Object.keys(savedPositions).length > 0) {
              Object.keys(savedPositions).forEach(name => {
                const offset = savedPositions[name];
                if (tableOffsets[name] && originalPositions[name]) {
                  tableOffsets[name] = { dx: offset.dx, dy: offset.dy };
                  tablePositions[name] = {
                    x: originalPositions[name].x + offset.dx,
                    y: originalPositions[name].y + offset.dy,
                    width: originalPositions[name].width,
                    height: originalPositions[name].height
                  };
                  const table = canvas.querySelector('.table[data-table="' + name + '"]');
                  if (table) table.setAttribute('transform', 'translate(' + offset.dx + ', ' + offset.dy + ')');
                }
              });
              updateAllRelationships();
              updateGroupBackgrounds();
              updateSvgSize();
            }
          } catch(e) { console.error('Failed to parse positions', e); }
        }
      }
      
      initPositions();
      
      function setUnsaved() {
        hasUnsavedChanges = true;
        saveStatus.textContent = '● Unsaved';
        saveStatus.className = 'save-status unsaved';
      }
      
      function setSaved() {
        hasUnsavedChanges = false;
        saveStatus.textContent = '✓ Saved';
        saveStatus.className = 'save-status saved';
        setTimeout(() => { if (!hasUnsavedChanges) saveStatus.textContent = ''; }, 2000);
      }
      
      // Tab switching
      document.querySelectorAll('.sidebar-tab').forEach(tab => {
        tab.addEventListener('click', function() {
          document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
          this.classList.add('active');
          document.querySelector('[data-panel="' + this.dataset.tab + '"]').classList.add('active');
        });
      });
      
      // Schema collapse
      document.querySelectorAll('.schema-header').forEach(h => {
        h.addEventListener('click', () => h.classList.toggle('collapsed'));
      });
      
      document.getElementById('btnRefresh').addEventListener('click', () => {
        if (hasUnsavedChanges && !confirm('Discard unsaved changes?')) return;
        vscode.postMessage({ command: 'refresh' });
      });
      
      document.getElementById('btnExport').addEventListener('click', exportSvg);
      document.getElementById('btnFit').addEventListener('click', fitToScreen);
      document.getElementById('btnReset').addEventListener('click', resetPositions);
      document.getElementById('btnZoomIn').addEventListener('click', zoomIn);
      document.getElementById('btnZoomOut').addEventListener('click', zoomOut);
      document.getElementById('btnSave').addEventListener('click', saveLayout);
      
      function saveLayout() {
        vscode.postMessage({ command: 'saveLayout', positions: tableOffsets });
        setSaved();
      }
      
      function updateZoom() {
        document.getElementById('zoomLevel').textContent = Math.round(zoom * 100) + '%';
        canvas.style.transform = 'scale(' + zoom + ')';
        const svg = canvas.querySelector('svg');
        if (svg) {
          canvas.style.width = (parseFloat(svg.getAttribute('width')) || 800) * zoom + 'px';
          canvas.style.height = (parseFloat(svg.getAttribute('height')) || 600) * zoom + 'px';
        }
      }
      
      function zoomIn() {
        const rect = container.getBoundingClientRect();
        const cx = canvasScroll.scrollLeft + rect.width / 2;
        const cy = canvasScroll.scrollTop + rect.height / 2;
        const oldZoom = zoom;
        zoom = Math.min(zoom * 1.25, 4);
        updateZoom();
        canvasScroll.scrollLeft = cx * (zoom / oldZoom) - rect.width / 2;
        canvasScroll.scrollTop = cy * (zoom / oldZoom) - rect.height / 2;
      }
      
      function zoomOut() {
        const rect = container.getBoundingClientRect();
        const cx = canvasScroll.scrollLeft + rect.width / 2;
        const cy = canvasScroll.scrollTop + rect.height / 2;
        const oldZoom = zoom;
        zoom = Math.max(zoom / 1.25, 0.1);
        updateZoom();
        canvasScroll.scrollLeft = cx * (zoom / oldZoom) - rect.width / 2;
        canvasScroll.scrollTop = cy * (zoom / oldZoom) - rect.height / 2;
      }
      
      function fitToScreen() {
        const svg = canvas.querySelector('svg');
        if (!svg) return;
        const w = parseFloat(svg.getAttribute('width')) || 800;
        const h = parseFloat(svg.getAttribute('height')) || 600;
        const rect = container.getBoundingClientRect();
        zoom = Math.min((rect.width - 20) / w, (rect.height - 20) / h, 2);
        updateZoom();
        canvasScroll.scrollLeft = 0;
        canvasScroll.scrollTop = 0;
      }
      
      function resetPositions() {
        if (hasUnsavedChanges && !confirm('Discard layout changes?')) return;
        Object.keys(originalPositions).forEach(name => {
          tablePositions[name] = { ...originalPositions[name] };
          tableOffsets[name] = { dx: 0, dy: 0 };
          const table = canvas.querySelector('.table[data-table="' + name + '"]');
          if (table) table.setAttribute('transform', 'translate(0,0)');
        });
        updateAllRelationships();
        updateGroupBackgrounds();
        updateSvgSize();
        setUnsaved();
      }
      
      function getExportSvg() {
        const svg = canvas.querySelector('svg');
        if (!svg) return null;
        const clone = svg.cloneNode(true);
        clone.querySelectorAll('.table').forEach(table => {
          const transform = table.getAttribute('transform');
          if (transform) {
            const match = transform.match(/translate\\(([^,]+),\\s*([^)]+)\\)/);
            if (match) {
              const dx = parseFloat(match[1]), dy = parseFloat(match[2]);
              table.querySelectorAll('rect, text, line').forEach(el => {
                ['x', 'x1', 'x2'].forEach(a => { if (el.hasAttribute(a)) el.setAttribute(a, parseFloat(el.getAttribute(a)) + dx); });
                ['y', 'y1', 'y2'].forEach(a => { if (el.hasAttribute(a)) el.setAttribute(a, parseFloat(el.getAttribute(a)) + dy); });
              });
              table.setAttribute('transform', '');
            }
          }
        });
        return clone;
      }
      
      function exportSvg() {
        const clone = getExportSvg();
        if (!clone) return;
        vscode.postMessage({ command: 'exportSvg', svgContent: new XMLSerializer().serializeToString(clone) });
      }
      
      function getGroupForTable(tableName) {
        for (const g of groups) if (g.tables.includes(tableName)) return g.name;
        return null;
      }
      
      function getGroupTables(groupName) {
        const g = groups.find(x => x.name === groupName);
        return g ? g.tables : [];
      }
      
      canvas.addEventListener('mousedown', function(e) {
        const svg = canvas.querySelector('svg');
        if (!svg) return;
        const svgRect = svg.getBoundingClientRect();
        const mouseX = (e.clientX - svgRect.left) / zoom;
        const mouseY = (e.clientY - svgRect.top) / zoom;
        
        const groupEl = e.target.closest('.table-group');
        const tableEl = e.target.closest('.table');
        
        if (groupEl && !tableEl) {
          isDraggingGroup = true;
          dragGroupName = groupEl.dataset.group;
          groupEl.classList.add('dragging');
          dragStartX = mouseX;
          dragStartY = mouseY;
          dragInitialOffsets = {};
          getGroupTables(dragGroupName).forEach(name => {
            dragInitialOffsets[name] = { dx: tableOffsets[name]?.dx || 0, dy: tableOffsets[name]?.dy || 0 };
          });
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        
        if (tableEl) {
          const tableName = tableEl.dataset.table;
          if (shiftKeyDown) {
            const gName = getGroupForTable(tableName);
            if (gName) {
              isDraggingGroup = true;
              dragGroupName = gName;
              const gEl = canvas.querySelector('.table-group[data-group="' + gName + '"]');
              if (gEl) gEl.classList.add('dragging');
              dragStartX = mouseX;
              dragStartY = mouseY;
              dragInitialOffsets = {};
              getGroupTables(gName).forEach(name => {
                dragInitialOffsets[name] = { dx: tableOffsets[name]?.dx || 0, dy: tableOffsets[name]?.dy || 0 };
              });
              e.preventDefault();
              e.stopPropagation();
              return;
            }
          }
          isDraggingTable = true;
          dragTarget = tableEl;
          dragTarget.classList.add('dragging');
          dragStartX = mouseX;
          dragStartY = mouseY;
          dragInitialOffsets = { [tableName]: { dx: tableOffsets[tableName]?.dx || 0, dy: tableOffsets[tableName]?.dy || 0 } };
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        
        isPanning = true;
        canvasScroll.style.cursor = 'grabbing';
        panStartX = e.clientX;
        panStartY = e.clientY;
        scrollStartX = canvasScroll.scrollLeft;
        scrollStartY = canvasScroll.scrollTop;
      });
      
      document.addEventListener('mousemove', function(e) {
        if (isDraggingGroup && dragGroupName) {
          const svg = canvas.querySelector('svg');
          if (!svg) return;
          const svgRect = svg.getBoundingClientRect();
          const mouseX = (e.clientX - svgRect.left) / zoom;
          const mouseY = (e.clientY - svgRect.top) / zoom;
          const dx = mouseX - dragStartX;
          const dy = mouseY - dragStartY;
          
          getGroupTables(dragGroupName).forEach(name => {
            const initOff = dragInitialOffsets[name] || { dx: 0, dy: 0 };
            const newDx = initOff.dx + dx, newDy = initOff.dy + dy;
            tableOffsets[name] = { dx: newDx, dy: newDy };
            if (originalPositions[name]) {
              tablePositions[name] = {
                x: originalPositions[name].x + newDx,
                y: originalPositions[name].y + newDy,
                width: originalPositions[name].width,
                height: originalPositions[name].height
              };
            }
            const t = canvas.querySelector('.table[data-table="' + name + '"]');
            if (t) t.setAttribute('transform', 'translate(' + newDx + ', ' + newDy + ')');
            updateTableRelationships(name);
          });
          updateGroupBackgrounds();
          updateSvgSize();
          return;
        }
        
        if (isDraggingTable && dragTarget) {
          const svg = canvas.querySelector('svg');
          if (!svg) return;
          const svgRect = svg.getBoundingClientRect();
          const mouseX = (e.clientX - svgRect.left) / zoom;
          const mouseY = (e.clientY - svgRect.top) / zoom;
          const tableName = dragTarget.dataset.table;
          const initOff = dragInitialOffsets[tableName] || { dx: 0, dy: 0 };
          const dx = mouseX - dragStartX, dy = mouseY - dragStartY;
          const newDx = initOff.dx + dx, newDy = initOff.dy + dy;
          tableOffsets[tableName] = { dx: newDx, dy: newDy };
          if (originalPositions[tableName]) {
            tablePositions[tableName] = {
              x: originalPositions[tableName].x + newDx,
              y: originalPositions[tableName].y + newDy,
              width: originalPositions[tableName].width,
              height: originalPositions[tableName].height
            };
          }
          dragTarget.setAttribute('transform', 'translate(' + newDx + ', ' + newDy + ')');
          updateTableRelationships(tableName);
          updateGroupBackgrounds();
          updateSvgSize();
          return;
        }
        
        if (isPanning) {
          canvasScroll.scrollLeft = scrollStartX - (e.clientX - panStartX);
          canvasScroll.scrollTop = scrollStartY - (e.clientY - panStartY);
        }
      });
      
      document.addEventListener('mouseup', function() {
        if (isDraggingGroup) {
          const gEl = canvas.querySelector('.table-group[data-group="' + dragGroupName + '"]');
          if (gEl) gEl.classList.remove('dragging');
          isDraggingGroup = false;
          dragGroupName = null;
          setUnsaved();
        }
        if (isDraggingTable && dragTarget) {
          dragTarget.classList.remove('dragging');
          isDraggingTable = false;
          dragTarget = null;
          setUnsaved();
        }
        isPanning = false;
        canvasScroll.style.cursor = '';
      });
      
      function updateSvgSize() {
        const svg = canvas.querySelector('svg');
        if (!svg) return;
        let maxX = 800, maxY = 600;
        Object.values(tablePositions).forEach(p => {
          maxX = Math.max(maxX, p.x + p.width + 100);
          maxY = Math.max(maxY, p.y + p.height + 100);
        });
        svg.setAttribute('width', maxX);
        svg.setAttribute('height', maxY);
        svg.setAttribute('viewBox', '0 0 ' + maxX + ' ' + maxY);
        canvas.style.width = maxX * zoom + 'px';
        canvas.style.height = maxY * zoom + 'px';
      }
      
      function updateGroupBackgrounds() {
        groups.forEach(g => {
          const el = canvas.querySelector('.table-group[data-group="' + g.name + '"]');
          if (!el) return;
          let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0, found = false;
          g.tables.forEach(name => {
            const p = tablePositions[name];
            if (p) {
              found = true;
              minX = Math.min(minX, p.x);
              minY = Math.min(minY, p.y);
              maxX = Math.max(maxX, p.x + p.width);
              maxY = Math.max(maxY, p.y + p.height);
            }
          });
          if (!found) return;
          const pad = 25;
          const rect = el.querySelector('rect');
          const text = el.querySelector('text');
          if (rect) {
            rect.setAttribute('x', minX - pad);
            rect.setAttribute('y', minY - pad - 30);
            rect.setAttribute('width', maxX - minX + pad * 2);
            rect.setAttribute('height', maxY - minY + pad * 2 + 30);
          }
          if (text) {
            text.setAttribute('x', minX - pad + 12);
            text.setAttribute('y', minY - pad - 10);
          }
        });
      }
      
      function updateTableRelationships(tableName) {
        canvas.querySelectorAll('.relationship[data-from-table="' + tableName + '"], .relationship[data-to-table="' + tableName + '"]')
          .forEach(rel => updateRelationshipPath(rel));
      }
      
      function updateAllRelationships() {
        canvas.querySelectorAll('.relationship').forEach(rel => updateRelationshipPath(rel));
      }
      
      function updateRelationshipPath(rel) {
        const fromKey = rel.dataset.from, toKey = rel.dataset.to;
        if (!fromKey || !toKey) return;
        const [fromTable, fromCol] = fromKey.split('.');
        const [toTable, toCol] = toKey.split('.');
        const fromPos = tablePositions[fromTable], toPos = tablePositions[toTable];
        if (!fromPos || !toPos) return;
        const fromTableEl = canvas.querySelector('.table[data-table="' + fromTable + '"]');
        const toTableEl = canvas.querySelector('.table[data-table="' + toTable + '"]');
        if (!fromTableEl || !toTableEl) return;
        const fromColEl = fromTableEl.querySelector('.column[data-column="' + fromCol + '"]');
        const toColEl = toTableEl.querySelector('.column[data-column="' + toCol + '"]');
        if (!fromColEl || !toColEl) return;
        const fromColIdx = Array.from(fromTableEl.querySelectorAll('.column')).indexOf(fromColEl);
        const toColIdx = Array.from(toTableEl.querySelectorAll('.column')).indexOf(toColEl);
        const hdrH = 38, rowH = 26, pad = 10;
        const fromY = fromPos.y + hdrH + pad + fromColIdx * rowH + rowH / 2;
        const toY = toPos.y + hdrH + pad + toColIdx * rowH + rowH / 2;
        let x1, x2, fromSide, toSide;
        if (fromPos.x + fromPos.width + 20 < toPos.x) { x1 = fromPos.x + fromPos.width; x2 = toPos.x; fromSide = 'right'; toSide = 'left'; }
        else if (toPos.x + toPos.width + 20 < fromPos.x) { x1 = fromPos.x; x2 = toPos.x + toPos.width; fromSide = 'left'; toSide = 'right'; }
        else { x1 = fromPos.x + fromPos.width; x2 = toPos.x; fromSide = 'right'; toSide = 'left'; }
        const ctrl = Math.max(50, Math.abs(x2 - x1) * 0.4);
        const c1 = x1 < x2 ? x1 + ctrl : x1 - ctrl;
        const c2 = x1 < x2 ? x2 - ctrl : x2 + ctrl;
        const d = 'M ' + x1 + ' ' + fromY + ' C ' + c1 + ' ' + fromY + ', ' + c2 + ' ' + toY + ', ' + x2 + ' ' + toY;
        rel.querySelectorAll('path').forEach(p => p.setAttribute('d', d));
        const fromLabelX = fromSide === 'right' ? x1 + 28 : x1 - 28;
        const toLabelX = toSide === 'left' ? x2 - 28 : x2 + 28;
        const labelOffsetY = -12;
        const texts = rel.querySelectorAll('.cardinality-label');
        const rects = rel.querySelectorAll('.cardinality-bg');
        if (texts.length >= 2) {
          texts[0].setAttribute('x', fromLabelX); texts[0].setAttribute('y', fromY + labelOffsetY + 2);
          texts[1].setAttribute('x', toLabelX); texts[1].setAttribute('y', toY + labelOffsetY + 2);
        }
        if (rects.length >= 2) {
          rects[0].setAttribute('x', fromLabelX - 12); rects[0].setAttribute('y', fromY + labelOffsetY - 12);
          rects[1].setAttribute('x', toLabelX - 12); rects[1].setAttribute('y', toY + labelOffsetY - 12);
        }
      }
      
      canvasScroll.addEventListener('wheel', function(e) {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const rect = container.getBoundingClientRect();
          const mx = e.clientX - rect.left + canvasScroll.scrollLeft;
          const my = e.clientY - rect.top + canvasScroll.scrollTop;
          const oldZoom = zoom;
          zoom = e.deltaY < 0 ? Math.min(zoom * 1.15, 4) : Math.max(zoom / 1.15, 0.1);
          updateZoom();
          canvasScroll.scrollLeft = mx * (zoom / oldZoom) - (e.clientX - rect.left);
          canvasScroll.scrollTop = my * (zoom / oldZoom) - (e.clientY - rect.top);
        }
      }, { passive: false });
      
      canvas.addEventListener('click', function(e) {
        if (isDraggingTable || isDraggingGroup) return;

        const swatch = e.target.closest('.composite-ref-swatch');
        if (swatch) {
          pinCompositeRefs([swatch.dataset.refId]);
          return;
        }

        const badge = e.target.closest('.composite-fk-icon');
        if (badge) {
          pinCompositeRefs((badge.dataset.compositeRefs || '').split(/\\s+/).filter(Boolean));
          return;
        }

        const table = e.target.closest('.table');
        if (table) {
          const col = e.target.closest('.column');
          const compositeIds = compositeIdsFromColumn(col);
          if (compositeIds.length > 0) pinCompositeRefs(compositeIds);
          else selectTable(table.dataset.table);
          if (col) vscode.postMessage({ command: 'goToColumn', tableName: table.dataset.table, columnName: col.dataset.column });
          return;
        }

        const rel = e.target.closest('.relationship');
        if (rel) {
          if (rel.dataset.composite === 'true') {
            pinCompositeRefs([rel.dataset.refId]);
          } else {
            clearCompositeSelection();
            canvas.querySelectorAll('.relationship.highlighted').forEach(r => r.classList.remove('highlighted'));
            rel.classList.add('highlighted');
          }
        }
      });
      
      canvas.addEventListener('dblclick', function(e) {
        const table = e.target.closest('.table');
        if (table) vscode.postMessage({ command: 'goToTable', tableName: table.dataset.table });
      });
      
      document.querySelectorAll('.table-item').forEach(item => {
        item.addEventListener('click', function() { selectTable(this.dataset.table); scrollToTable(this.dataset.table); });
        item.addEventListener('dblclick', function() { vscode.postMessage({ command: 'goToTable', tableName: this.dataset.table, schema: this.dataset.schema || undefined }); });
      });
      
      document.querySelectorAll('.ref-item').forEach(item => {
        item.addEventListener('click', function() {
          const rel = canvas.querySelector('.relationship[data-ref-id="' + this.dataset.refId + '"]');
          if (!rel) return;
          if (rel.dataset.composite === 'true') {
            pinCompositeRefs([this.dataset.refId]);
          } else {
            clearCompositeSelection();
            canvas.querySelectorAll('.relationship.highlighted').forEach(r => r.classList.remove('highlighted'));
            rel.classList.add('highlighted');
          }
        });
        item.addEventListener('mouseenter', function(e) {
          const ref = refsById.get(this.dataset.refId);
          if (!ref || !ref.composite) return;
          setHoveredCompositeRefs([ref.id]);
          showTooltip(e, 'Composite FK', getCompositeMapping(ref));
        });
        item.addEventListener('mouseleave', function() {
          setHoveredCompositeRefs([]);
          hideTooltip();
        });
      });
      
      function selectTable(name) {
        clearCompositeSelection();
        canvas.querySelectorAll('.table.selected').forEach(t => t.classList.remove('selected'));
        document.querySelectorAll('.table-item.highlighted').forEach(t => t.classList.remove('highlighted'));
        canvas.querySelectorAll('.relationship.highlighted').forEach(r => r.classList.remove('highlighted'));
        const svgT = canvas.querySelector('.table[data-table="' + name + '"]');
        const sideT = document.querySelector('.table-item[data-table="' + name + '"]');
        if (svgT) svgT.classList.add('selected');
        if (sideT) sideT.classList.add('highlighted');
        canvas.querySelectorAll('.relationship').forEach(rel => {
          if ((rel.dataset.from && rel.dataset.from.startsWith(name + '.')) || (rel.dataset.to && rel.dataset.to.startsWith(name + '.')))
            rel.classList.add('highlighted');
        });
      }
      
      function scrollToTable(name) {
        const p = tablePositions[name];
        if (p) {
          canvasScroll.scrollLeft = p.x * zoom + (p.width * zoom) / 2 - container.clientWidth / 2;
          canvasScroll.scrollTop = p.y * zoom + (p.height * zoom) / 2 - container.clientHeight / 2;
        }
      }
      
      canvas.addEventListener('mousemove', function(e) {
        if (isDraggingTable || isDraggingGroup) {
          setHoveredCompositeRefs([]);
          hideTooltip();
          return;
        }

        const swatch = e.target.closest('.composite-ref-swatch');
        const badge = e.target.closest('.composite-fk-icon');
        const col = e.target.closest('.column');
        const table = e.target.closest('.table');
        const group = e.target.closest('.table-group');
        const rel = e.target.closest('.relationship');

        let compositeIds = [];
        if (swatch) compositeIds = [swatch.dataset.refId];
        else if (badge) compositeIds = (badge.dataset.compositeRefs || '').split(/\\s+/).filter(Boolean);
        else if (col) compositeIds = compositeIdsFromColumn(col);
        else if (rel && rel.dataset.composite === 'true') compositeIds = [rel.dataset.refId];

        setHoveredCompositeRefs(compositeIds);

        if (compositeIds.length > 0) {
          const isSourceColumn = col && compositeIds.some(id => {
            const ref = refsById.get(id);
            return ref && ref.fromTable === col.dataset.table && ref.fromColumns.includes(col.dataset.column);
          });
          const isAlsoScalarFK = col && schemaRefs.some(ref =>
            !ref.composite && ref.fromTable === col.dataset.table && ref.fromColumns.includes(col.dataset.column)
          );
          const tooltipTitle = isSourceColumn ? (isAlsoScalarFK ? 'Scalar + composite FK' : 'Composite FK') : 'Composite FK target';
          showTooltip(e, tooltipTitle, compositeTooltip(compositeIds));
        } else if (col) {
          showTooltip(e, col.dataset.table + '.' + col.dataset.column, 'Click to go to definition');
        } else if (table) {
          showTooltip(e, table.dataset.table, 'Drag to move · Shift+drag moves group');
        } else if (group && !table) {
          showTooltip(e, 'Group: ' + group.dataset.group, 'Drag to move entire group');
        } else if (rel) {
          showTooltip(e, (rel.dataset.from || '') + ' → ' + (rel.dataset.to || ''), 'Click to highlight');
        } else {
          hideTooltip();
        }
      });
      canvas.addEventListener('mouseleave', function() {
        setHoveredCompositeRefs([]);
        hideTooltip();
      });
      
      function showTooltip(e, title, content) {
        tooltip.querySelector('.tooltip-title').textContent = title;
        tooltip.querySelector('.tooltip-content').textContent = content;
        tooltip.style.left = (e.clientX + 12) + 'px';
        tooltip.style.top = (e.clientY + 12) + 'px';
        tooltip.classList.add('visible');
      }
      function hideTooltip() { tooltip.classList.remove('visible'); }
      
      document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveLayout(); }
        else if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoomIn(); }
        else if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); zoomOut(); }
        else if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); fitToScreen(); }
        else if (e.key === 'Escape') {
          if (focusState) { exitFocusMode(); return; }
          clearCompositeSelection();
          canvas.querySelectorAll('.table.selected, .relationship.highlighted').forEach(el => el.classList.remove('selected', 'highlighted'));
          document.querySelectorAll('.table-item.highlighted').forEach(t => t.classList.remove('highlighted'));
        } else if (e.key === 'f' || e.key === 'F') {
          const sel = canvas.querySelector('.table.selected');
          if (sel && !e.ctrlKey && !e.metaKey && !e.altKey) {
            activateFocusMode(sel.dataset.table, focusState ? focusState.depth : 1);
          }
        }
      });
      
      setTimeout(fitToScreen, 50);
    })();
  </script>
</body>
</html>`;
  }

  private _getErrorHtml(msg: string): string {
    return `<!DOCTYPE html><html><head><style>body{font-family:sans-serif;background:#1e1e1e;color:#e0e0e0;padding:40px;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh}.error-icon{font-size:64px;margin-bottom:24px}.error-title{font-size:24px;color:#f44336;margin-bottom:16px}.error-message{background:#2d2d2d;padding:20px;border-radius:8px;border-left:4px solid #f44336;font-family:monospace;max-width:600px;word-wrap:break-word}</style></head><body><div class="error-icon">⚠️</div><div class="error-title">DBML Parse Error</div><div class="error-message">${msg.replace(/</g,'&lt;')}</div></body></html>`;
  }

  private _getNonce(): string {
    let t = '';
    const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) t += c.charAt(Math.floor(Math.random() * c.length));
    return t;
  }

  public updateDocument(doc: vscode.TextDocument) {
    this._document = doc;
    this._loadSavedLayout();
    this._update();
  }
}
