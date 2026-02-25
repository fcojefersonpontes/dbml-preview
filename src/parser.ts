export interface Column {
  name: string;
  type: string;
  pk?: boolean;
  unique?: boolean;
  notNull?: boolean;
  note?: string;
  default?: string;
  increment?: boolean;
}

export interface Table {
  name: string;
  alias?: string;
  columns: Column[];
  note?: string;
  color?: string;
  headerColor?: string;
  indexes?: Index[];
  schema?: string;
}

export interface Index {
  name?: string;
  columns: string[];
  unique?: boolean;
  pk?: boolean;
}

export interface Ref {
  name?: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  fromRelation: '1' | '*';
  toRelation: '1' | '*';
  onDelete?: string;
  onUpdate?: string;
}

export interface TableGroup {
  name: string;
  tables: string[];
  color?: string;
}

export interface Enum {
  name: string;
  values: EnumValue[];
}

export interface EnumValue {
  name: string;
  note?: string;
}

export interface DBMLSchema {
  tables: Table[];
  refs: Ref[];
  tableGroups: TableGroup[];
  enums: Enum[];
  schemas: string[];
  projectName?: string;
  projectNote?: string;
}

export class DBMLParser {
  parse(dbmlContent: string): DBMLSchema {
    return this.manualParse(dbmlContent);
  }

  /**
   * Remove multi-line Note blocks (Note: '''...''') from content
   * This prevents note content from being parsed as columns
   */
  private removeMultilineNotes(content: string): string {
    // Remove Note: '''...''' blocks (triple single quotes)
    let result = content.replace(/Note\s*:\s*'''[\s\S]*?'''/gi, '');
    // Remove Note: """...""" blocks (triple double quotes)
    result = result.replace(/Note\s*:\s*"""[\s\S]*?"""/gi, '');
    return result;
  }

  /**
   * Remove single-line Note blocks from content
   */
  private removeSingleLineNotes(content: string): string {
    // Remove Note: '...' or Note: "..."
    let result = content.replace(/Note\s*:\s*'[^']*'/gi, '');
    result = result.replace(/Note\s*:\s*"[^"]*"/gi, '');
    return result;
  }

  /**
   * Extract table body content between { and }, handling nested braces and Note blocks
   */
  private extractTableBody(content: string, startPos: number): { body: string; endPos: number } | null {
    let depth = 0;
    let inTripleQuote = false;
    let tripleQuoteChar = '';
    let inSingleQuote = false;
    let singleQuoteChar = '';
    let bodyStart = -1;
    
    for (let i = startPos; i < content.length; i++) {
      const char = content[i];
      const nextThree = content.substring(i, i + 3);
      
      // Handle triple quotes (''' or """)
      if (!inSingleQuote && (nextThree === "'''" || nextThree === '"""')) {
        if (!inTripleQuote) {
          inTripleQuote = true;
          tripleQuoteChar = nextThree;
          i += 2;
          continue;
        } else if (nextThree === tripleQuoteChar) {
          inTripleQuote = false;
          tripleQuoteChar = '';
          i += 2;
          continue;
        }
      }
      
      // Skip if inside triple-quoted string
      if (inTripleQuote) continue;
      
      // Handle single/double quotes (not triple)
      if ((char === "'" || char === '"') && content.substring(i, i + 3) !== "'''" && content.substring(i, i + 3) !== '"""') {
        if (i > 0 && content[i - 1] === '\\') continue; // Escaped quote
        
        if (!inSingleQuote) {
          inSingleQuote = true;
          singleQuoteChar = char;
        } else if (char === singleQuoteChar) {
          inSingleQuote = false;
          singleQuoteChar = '';
        }
        continue;
      }
      
      // Skip if inside single-quoted string
      if (inSingleQuote) continue;
      
      // Track braces
      if (char === '{') {
        if (depth === 0) {
          bodyStart = i + 1;
        }
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0 && bodyStart !== -1) {
          return {
            body: content.substring(bodyStart, i),
            endPos: i
          };
        }
      }
    }
    
    return null;
  }

  /**
   * Parse columns from table body content, properly handling notes and comments
   */
  private parseColumns(tableBody: string): Column[] {
    const columns: Column[] = [];
    
    // First, remove all Note blocks from the table body
    let cleanBody = this.removeMultilineNotes(tableBody);
    cleanBody = this.removeSingleLineNotes(cleanBody);
    
    const lines = cleanBody.split('\n');
    let inIndexes = false;
    let indexBraceDepth = 0;
    
    for (const line of lines) {
      let trimmed = line.trim();
      
      // Skip empty lines and full-line comments
      if (!trimmed || trimmed.startsWith('//')) continue;
      
      // Remove inline comments
      const commentIndex = this.findInlineCommentIndex(trimmed);
      if (commentIndex > 0) {
        trimmed = trimmed.substring(0, commentIndex).trim();
      }
      
      if (!trimmed) continue;
      
      // Handle indexes block
      if (/^indexes\s*\{?/i.test(trimmed)) {
        inIndexes = true;
        if (trimmed.includes('{')) indexBraceDepth++;
        continue;
      }
      
      if (inIndexes) {
        if (trimmed.includes('{')) indexBraceDepth++;
        if (trimmed.includes('}')) indexBraceDepth--;
        if (indexBraceDepth <= 0) {
          inIndexes = false;
          indexBraceDepth = 0;
        }
        continue;
      }
      
      // Skip Note keyword lines
      if (/^Note\s*:/i.test(trimmed)) continue;
      
      // Skip lines that are clearly markdown/documentation content
      if (/^[#*\-]/.test(trimmed)) continue; // Markdown headers/lists
      if (/^\d+\.\s/.test(trimmed)) continue; // Numbered lists
      
      // Parse column definition
      // Format: column_name type [options]
      const columnMatch = trimmed.match(/^(\w+)\s+(\w+(?:\s*\([^)]*\))?)\s*(?:\[([^\]]*)\])?/);
      
      if (columnMatch) {
        const colName = columnMatch[1];
        const colType = columnMatch[2].trim();
        const options = columnMatch[3] || '';
        
        // Skip if column name is a reserved word that's not a column
        const reservedWords = ['indexes', 'note', 'table', 'ref', 'enum', 'tablegroup', 'project'];
        if (reservedWords.includes(colName.toLowerCase())) continue;
        
        // Validate column type - must look like a real database type
        if (!this.isValidColumnType(colType)) continue;
        
        const column: Column = {
          name: colName,
          type: colType,
          pk: /\bpk\b/i.test(options),
          unique: /\bunique\b/i.test(options),
          notNull: /\bnot\s*null\b/i.test(options) || /\bnn\b/i.test(options),
          increment: /\bincrement\b/i.test(options)
        };
        
        // Extract note from options
        const noteMatch = options.match(/note\s*:\s*['"]([^'"]*)['"]/i);
        if (noteMatch) {
          column.note = noteMatch[1];
        }
        
        // Extract default value
        const defaultMatch = options.match(/default\s*:\s*(?:`([^`]*)`|['"]([^'"]*)['"']|(\w+))/i);
        if (defaultMatch) {
          column.default = defaultMatch[1] || defaultMatch[2] || defaultMatch[3];
        }
        
        columns.push(column);
      }
    }
    
    return columns;
  }

  /**
   * Find index of inline comment (//) that's not inside a string
   */
  private findInlineCommentIndex(line: string): number {
    let inString = false;
    let stringChar = '';
    
    for (let i = 0; i < line.length - 1; i++) {
      const char = line[i];
      
      if ((char === "'" || char === '"') && (i === 0 || line[i - 1] !== '\\')) {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
          stringChar = '';
        }
      }
      
      if (!inString && line.substring(i, i + 2) === '//') {
        return i;
      }
    }
    
    return -1;
  }

  /**
   * Validate if a string looks like a valid column type
   */
  private isValidColumnType(type: string): boolean {
    const normalizedType = type.toLowerCase().replace(/\s+/g, '');
    
    // Common SQL types
    const validTypes = [
      // Numeric
      'int', 'integer', 'bigint', 'smallint', 'tinyint', 'mediumint',
      'decimal', 'numeric', 'float', 'double', 'real', 'number',
      'serial', 'bigserial', 'smallserial',
      // String
      'varchar', 'char', 'text', 'string', 'nvarchar', 'nchar', 'ntext',
      'clob', 'longtext', 'mediumtext', 'tinytext',
      // Date/Time
      'date', 'datetime', 'timestamp', 'time', 'year',
      'timestamptz', 'timetz', 'interval',
      // Boolean
      'boolean', 'bool', 'bit',
      // Binary
      'blob', 'binary', 'varbinary', 'bytea', 'longblob', 'mediumblob', 'tinyblob',
      // JSON
      'json', 'jsonb',
      // UUID
      'uuid', 'guid', 'uniqueidentifier',
      // Other
      'xml', 'money', 'currency', 'array', 'enum', 'set',
      'geometry', 'geography', 'point', 'polygon', 'linestring'
    ];
    
    // Check if type starts with a valid type name
    for (const validType of validTypes) {
      if (normalizedType.startsWith(validType)) {
        return true;
      }
    }
    
    // Also accept types with parentheses like varchar(255), decimal(10,2)
    const typeWithParens = /^[a-z_][a-z0-9_]*\([^)]+\)$/i;
    if (typeWithParens.test(normalizedType)) {
      return true;
    }
    
    // Accept simple single-word types that look like custom types
    const simpleType = /^[a-z_][a-z0-9_]*$/i;
    if (simpleType.test(normalizedType) && normalizedType.length < 30) {
      return true;
    }
    
    return false;
  }

  private extractInlineRefs(content: string, tables: Table[]): Ref[] {
    const refs: Ref[] = [];
    
    // Clean content - remove multi-line notes to avoid false matches
    const cleanContent = this.removeMultilineNotes(content);
    
    for (const table of tables) {
      const searchName = table.schema ? `(?:${table.schema}\\.)?${table.name}` : table.name;
      const tableHeaderRegex = new RegExp(
        `Table\\s+${searchName}\\s*(?:as\\s+\\w+)?\\s*(?:\\[[^\\]]*\\])?\\s*\\{`,
        'i'
      );
      const match = tableHeaderRegex.exec(cleanContent);
      
      if (match) {
        const extracted = this.extractTableBody(cleanContent, match.index + match[0].length - 1);
        if (extracted) {
          const lines = extracted.body.split('\n');
          
          for (const line of lines) {
            // Match inline ref: [ref: > schema.table.column] or [ref: > table.column]
            const refMatch = line.match(/(\w+)\s+\w+.*\[.*ref:\s*([<>\-])\s*((?:\w+\.)?\w+)\.(\w+)/i);
            
            if (refMatch) {
              const columnName = refMatch[1];
              const relationType = refMatch[2];
              const targetTablePart = refMatch[3];
              const targetColumn = refMatch[4];
              
              let targetTable = targetTablePart;
              if (targetTablePart.includes('.')) {
                const parts = targetTablePart.split('.');
                targetTable = parts[parts.length - 1];
              }
              
              let fromRelation: '1' | '*' = '1';
              let toRelation: '1' | '*' = '1';
              
              if (relationType === '>') {
                fromRelation = '*';
                toRelation = '1';
              } else if (relationType === '<') {
                fromRelation = '1';
                toRelation = '*';
              }
              
              refs.push({
                fromTable: table.name,
                fromColumn: columnName,
                toTable: targetTable,
                toColumn: targetColumn,
                fromRelation,
                toRelation
              });
            }
          }
        }
      }
    }
    
    // Also parse standalone Ref statements
    const refRegex = /Ref\s*(?:(\w+)\s*)?:\s*((?:\w+\.)?\w+)\.(\w+)\s*([<>\-])\s*((?:\w+\.)?\w+)\.(\w+)/gi;
    let refMatch;
    
    while ((refMatch = refRegex.exec(cleanContent)) !== null) {
      const relationType = refMatch[4];
      
      let fromTable = refMatch[2];
      if (fromTable.includes('.')) {
        const parts = fromTable.split('.');
        fromTable = parts[parts.length - 1];
      }
      
      let toTable = refMatch[5];
      if (toTable.includes('.')) {
        const parts = toTable.split('.');
        toTable = parts[parts.length - 1];
      }
      
      let fromRelation: '1' | '*' = '1';
      let toRelation: '1' | '*' = '1';
      
      if (relationType === '>') {
        fromRelation = '*';
        toRelation = '1';
      } else if (relationType === '<') {
        fromRelation = '1';
        toRelation = '*';
      }
      
      refs.push({
        name: refMatch[1],
        fromTable: fromTable,
        fromColumn: refMatch[3],
        toTable: toTable,
        toColumn: refMatch[6],
        fromRelation,
        toRelation
      });
    }
    
    return refs;
  }

  private extractColorsFromContent(content: string): Map<string, string> {
    const colorMap = new Map<string, string>();
    
    const tableColorRegex = /Table\s+(?:\w+\.)?(\w+)\s*(?:as\s+\w+)?\s*\[([^\]]*)\]/gi;
    let match;
    
    while ((match = tableColorRegex.exec(content)) !== null) {
      const options = match[2];
      const colorMatch = options.match(/(?:color|headercolor)\s*:\s*([#\w]+)/i);
      if (colorMatch) {
        colorMap.set(match[1], colorMatch[1]);
      }
    }

    return colorMap;
  }

  private extractGroupColorsFromContent(content: string): Map<string, string> {
    const colorMap = new Map<string, string>();
    
    const groupColorRegex = /TableGroup\s+(\w+)\s*\[([^\]]*)\]/gi;
    let match;
    
    while ((match = groupColorRegex.exec(content)) !== null) {
      const options = match[2];
      const colorMatch = options.match(/color\s*:\s*["']?([#\w]+)["']?/i);
      if (colorMatch) {
        colorMap.set(match[1], colorMatch[1]);
      }
    }

    return colorMap;
  }

  private extractTableGroups(content: string, colorMap: Map<string, string>): TableGroup[] {
    const groups: TableGroup[] = [];
    
    const cleanContent = this.removeMultilineNotes(content);
    
    const groupRegex = /TableGroup\s+(\w+)\s*(?:\/\/[^\n]*)?\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/gi;
    let match;
    
    while ((match = groupRegex.exec(cleanContent)) !== null) {
      const groupName = match[1];
      const options = match[2] || '';
      const tablesContent = match[3];
      
      let color = colorMap.get(groupName);
      if (!color) {
        const colorMatch = options.match(/color\s*:\s*["']?([#\w]+)["']?/i);
        if (colorMatch) {
          color = colorMatch[1];
        }
      }
      
      const tables = tablesContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => {
          if (!line) return false;
          if (line.startsWith('//')) return false;
          if (line.toLowerCase().startsWith('note:')) return false;
          if (/^[#*\-]/.test(line)) return false;
          return /^[\w.]+$/.test(line);
        });
      
      if (tables.length > 0) {
        groups.push({
          name: groupName,
          tables,
          color
        });
      }
    }
    
    return groups;
  }

  private manualParse(content: string): DBMLSchema {
    const schema: DBMLSchema = {
      tables: [],
      refs: [],
      tableGroups: [],
      enums: [],
      schemas: []
    };

    const colorMap = this.extractColorsFromContent(content);
    
    const tableHeaderRegex = /Table\s+(?:(\w+)\.)?(\w+)(?:\s+as\s+(\w+))?\s*(?:\[([^\]]*)\])?\s*\{/gi;
    let match;

    while ((match = tableHeaderRegex.exec(content)) !== null) {
      const schemaName = match[1] || undefined;
      const tableName = match[2];
      const alias = match[3];
      const options = match[4] || '';

      if (schemaName && !schema.schemas.includes(schemaName)) {
        schema.schemas.push(schemaName);
      }

      const extracted = this.extractTableBody(content, match.index + match[0].length - 1);
      
      if (extracted) {
        const colorMatch = options.match(/(?:color|headercolor)\s*:\s*([#\w]+)/i);
        const color = colorMatch ? colorMatch[1] : colorMap.get(tableName);

        const table: Table = {
          name: tableName,
          alias,
          columns: this.parseColumns(extracted.body),
          color,
          headerColor: color,
          schema: schemaName
        };

        schema.tables.push(table);
      }
    }

    schema.refs = this.extractInlineRefs(content, schema.tables);
    schema.tableGroups = this.extractTableGroups(content, this.extractGroupColorsFromContent(content));

    const enumRegex = /Enum\s+(\w+)\s*\{([^}]*)\}/gi;
    while ((match = enumRegex.exec(content)) !== null) {
      const values = match[2]
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('//'))
        .map(line => {
          const nameMatch = line.match(/^(\w+)/);
          return { name: nameMatch ? nameMatch[1] : line };
        });
      
      schema.enums.push({
        name: match[1],
        values
      });
    }

    const projectMatch = content.match(/Project\s+(\w+)\s*\{/i);
    if (projectMatch) {
      schema.projectName = projectMatch[1];
    }

    return schema;
  }
}
