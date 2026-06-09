import * as vscode from 'vscode';
import { ERDPreviewPanel } from './previewPanel';
import { DBMLParser } from './parser';
import { ERDRenderer } from './renderer';
import * as fs from 'fs';

export function activate(context: vscode.ExtensionContext) {
  console.log('DBML Previewer is now active!');

  // Register preview command
  const previewCommand = vscode.commands.registerCommand('dbml-previewer.preview', () => {
    const editor = vscode.window.activeTextEditor;
    
    if (!editor) {
      vscode.window.showErrorMessage('No active editor found. Please open a DBML file.');
      return;
    }

    const document = editor.document;
    
    if (document.languageId !== 'dbml' && !document.fileName.endsWith('.dbml')) {
      vscode.window.showErrorMessage('Please open a DBML file to preview.');
      return;
    }

    ERDPreviewPanel.createOrShow(context.extensionUri, document);
  });

  // Register export SVG command
  const exportSvgCommand = vscode.commands.registerCommand('dbml-previewer.exportSvg', async () => {
    const editor = vscode.window.activeTextEditor;
    
    if (!editor) {
      vscode.window.showErrorMessage('No active editor found.');
      return;
    }

    const document = editor.document;
    
    if (document.languageId !== 'dbml' && !document.fileName.endsWith('.dbml')) {
      vscode.window.showErrorMessage('Please open a DBML file.');
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('dbmlPreviewer');
      const options = {
        defaultTableColor: config.get('defaultTableColor', '#3498db'),
        defaultGroupColor: config.get('defaultGroupColor', '#95a5a6'),
        showRelationshipLabels: config.get('showRelationshipLabels', true),
        layout: 'compact' as 'left-right' | 'snowflake' | 'compact'
      };

      const parser = new DBMLParser();
      const schema = parser.parse(document.getText());
      const renderer = new ERDRenderer(options);
      const svg = renderer.render(schema);

      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(document.fileName.replace('.dbml', '.svg')),
        filters: { 'SVG Files': ['svg'] }
      });

      if (uri) {
        fs.writeFileSync(uri.fsPath, svg);
        vscode.window.showInformationMessage(`SVG exported to ${uri.fsPath}`);
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to export: ${error.message}`);
    }
  });

  // Register DBML language support
  const dbmlSelector: vscode.DocumentSelector = { language: 'dbml', scheme: 'file' };

  // Hover provider for tables and columns
  const hoverProvider = vscode.languages.registerHoverProvider(dbmlSelector, {
    provideHover(document, position, token) {
      const range = document.getWordRangeAtPosition(position);
      if (!range) return;

      const word = document.getText(range);
      const text = document.getText();
      
      // Check if hovering over a table name
      const tableRegex = new RegExp(`Table\\s+(?:\\w+\\.)?${word}\\s*(?:as\\s+\\w+)?\\s*(?:\\[[^\\]]*\\])?\\s*\\{([^}]*)\\}`, 'i');
      const tableMatch = text.match(tableRegex);
      
      if (tableMatch) {
        const bodyText = tableMatch[1];
        const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'));

        // Extract table-level Note
        let tableNote: string | undefined;
        const tableNoteLine = lines.find(l => /^Note\s*:/i.test(l));
        if (tableNoteLine) {
          const m = tableNoteLine.match(/^Note\s*:\s*['"]([^'"]*)['"]/i);
          if (m) { tableNote = m[1]; }
        }

        const markdown = new vscode.MarkdownString();
        markdown.appendMarkdown(`**Table: ${word}**\n\n`);
        if (tableNote) {
          markdown.appendMarkdown(`*${tableNote}*\n\n`);
        }
        markdown.appendMarkdown('| Column | Type | Note |\n|--------|------|------|\n');

        for (const col of lines) {
          // Skip index blocks and Note lines
          if (/^(indexes|Note)\s*[:{]/i.test(col) || /^Note\s*:/i.test(col)) { continue; }

          const parts = col.match(/^(\w+)\s+(\w+(?:\([^)]*\))?)(.*)?$/);
          if (!parts) { continue; }

          const colName = parts[1];
          const colType = parts[2];
          const attrs = parts[3] || '';

          // Collect flags
          const flags: string[] = [];
          if (/\bpk\b/i.test(attrs)) { flags.push('PK'); }
          if (/\bunique\b/i.test(attrs)) { flags.push('unique'); }
          if (/\bnot null\b/i.test(attrs)) { flags.push('not null'); }

          // Extract inline note from [...note: '...']
          let colNote = '';
          const noteMatch = attrs.match(/\bnote\s*:\s*['"]([^'"]*)['"]/i);
          if (noteMatch) { colNote = noteMatch[1]; }

          const typeDisplay = flags.length > 0 ? `${colType} *(${flags.join(', ')})*` : colType;
          markdown.appendMarkdown(`| ${colName} | ${typeDisplay} | ${colNote} |\n`);
        }

        return new vscode.Hover(markdown, range);
      }

      return null;
    }
  });

  // Code lens for preview button
  const codeLensProvider = vscode.languages.registerCodeLensProvider(dbmlSelector, {
    provideCodeLenses(document, token) {
      const topOfDocument = new vscode.Range(0, 0, 0, 0);
      return [new vscode.CodeLens(topOfDocument, {
        title: '$(preview) Preview Diagram',
        command: 'dbml-previewer.preview'
      })];
    }
  });

  context.subscriptions.push(
    previewCommand,
    exportSvgCommand,
    hoverProvider,
    codeLensProvider
  );
}

export function deactivate() {}
