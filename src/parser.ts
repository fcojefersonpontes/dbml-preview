import { Parser } from '@dbml/core';

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
    try {
      const parser = new Parser();
      const database = parser.parse(dbmlContent, 'dbml');
      return this.transformDatabase(database, dbmlContent);
    } catch (error) {
      console.error('Parser error, falling back to manual parse:', error);
      return this.manualParse(dbmlContent);
    }
  }

  private transformDatabase(database: any, originalContent: string): DBMLSchema {
    const schema: DBMLSchema = {
      tables: [],
      refs: [],
      tableGroups: [],
      enums: [],
      schemas: []
    };

    const colorMap = this.extractColorsFromContent(originalContent);
    const groupColorMap = this.extractGroupColorsFromContent(originalContent);

    // Process schemas and tables
    if (database.schemas) {
      for (const dbSchema of database.schemas) {
        // Track schema names (except 'public' which is default)
        if (dbSchema.name && dbSchema.name !== 'public') {
          schema.schemas.push(dbSchema.name);
        }
        
        if (dbSchema.tables) {
          for (const table of dbSchema.tables) {
            const schemaName = dbSchema.name !== 'public' ? dbSchema.name : undefined;
            const fullTableName = schemaName ? `${schemaName}.${table.name}` : table.name;
            
            const tableDef: Table = {
              name: table.name,
              alias: table.alias || undefined,
              columns: [],
              note: table.note || undefined,
              color: colorMap.get(table.name) || colorMap.get(fullTableName),
              headerColor: colorMap.get(table.name) || colorMap.get(fullTableName),
              schema: schemaName
            };

            if (table.fields) {
              for (const field of table.fields) {
                const column: Column = {
                  name: field.name,
                  type: this.extractTypeName(field.type),
                  pk: field.pk || false,
                  unique: field.unique || false,
                  notNull: field.not_null || false,
                  note: field.note || undefined,
                  default: field.dbdefault?.value || undefined,
                  increment: field.increment || false
                };
                tableDef.columns.push(column);
              }
            }

            if (table.indexes) {
              tableDef.indexes = table.indexes.map((idx: any) => ({
                name: idx.name,
                columns: idx.columns?.map((c: any) => c.value) || [],
                unique: idx.unique || false,
                pk: idx.pk || false
              }));
            }

            schema.tables.push(tableDef);
          }
        }

        // Process enums
        if (dbSchema.enums) {
          for (const enumDef of dbSchema.enums) {
            schema.enums.push({
              name: enumDef.name,
              values: enumDef.values?.map((v: any) => ({
                name: v.name,
                note: v.note
              })) || []
            });
          }
        }
      }
    }

    // Process refs from database object
    if (database.refs) {
      for (const ref of database.refs) {
        if (ref.endpoints && ref.endpoints.length >= 2) {
          const endpoint0 = ref.endpoints[0];
          const endpoint1 = ref.endpoints[1];
          
          schema.refs.push({
            name: ref.name,
            fromTable: endpoint0.tableName,
            fromColumn: endpoint0.fieldNames?.[0] || '',
            toTable: endpoint1.tableName,
            toColumn: endpoint1.fieldNames?.[0] || '',
            fromRelation: this.mapRelationType(endpoint0.relation),
            toRelation: this.mapRelationType(endpoint1.relation),
            onDelete: ref.onDelete,
            onUpdate: ref.onUpdate
          });
        }
      }
    }

    // Also extract inline refs from original content
    const inlineRefs = this.extractInlineRefs(originalContent, schema.tables);
    for (const ref of inlineRefs) {
      // Check if ref already exists
      const exists = schema.refs.some(r => 
        r.fromTable === ref.fromTable && 
        r.fromColumn === ref.fromColumn &&
        r.toTable === ref.toTable &&
        r.toColumn === ref.toColumn
      );
      if (!exists) {
        schema.refs.push(ref);
      }
    }

    // Process table groups
    schema.tableGroups = this.extractTableGroups(originalContent, groupColorMap);

    // Extract project info
    const projectMatch = originalContent.match(/Project\s+(\w+)\s*\{([^}]*)\}/i);
    if (projectMatch) {
      schema.projectName = projectMatch[1];
      const noteMatch = projectMatch[2].match(/Note:\s*['"]([^'"]*)['"]/i);
      if (noteMatch) {
        schema.projectNote = noteMatch[1];
      }
    }

    return schema;
  }

  private extractTypeName(type: any): string {
    if (!type) return 'unknown';
    if (typeof type === 'string') return type;
    if (type.type_name) {
      let typeName = type.type_name;
      if (type.args) {
        typeName += `(${type.args})`;
      }
      return typeName;
    }
    return 'unknown';
  }

  private mapRelationType(relation: string): '1' | '*' {
    if (relation === '*' || relation === 'many') return '*';
    return '1';
  }

  private extractInlineRefs(content: string, tables: Table[]): Ref[] {
    const refs: Ref[] = [];
    
    // For each table, find inline refs in columns
    for (const table of tables) {
      // Build search pattern - handle both "Table name" and "Table schema.name"
      const searchName = table.schema ? `(?:${table.schema}\\.)?${table.name}` : table.name;
      const tableRegex = new RegExp(
        `Table\\s+${searchName}\\s*(?:as\\s+\\w+)?\\s*(?:\\[[^\\]]*\\])?\\s*\\{([^}]*)\\}`,
        'is'
      );
      const tableMatch = content.match(tableRegex);
      
      if (tableMatch) {
        const tableContent = tableMatch[1];
        const lines = tableContent.split('\n');
        
        for (const line of lines) {
          // Match inline ref: [ref: > schema.table.column] or [ref: > table.column]
          // Pattern: column_name type [ref: > (schema.)table.column]
          const refMatch = line.match(/(\w+)\s+\w+.*\[.*ref:\s*([<>\-])\s*((?:\w+\.)?\w+)\.(\w+)/i);
          
          if (refMatch) {
            const columnName = refMatch[1];
            const relationType = refMatch[2];
            const targetTablePart = refMatch[3]; // Could be "schema.table" or just "table"
            const targetColumn = refMatch[4];
            
            // Parse target table (may include schema)
            let targetTable = targetTablePart;
            if (targetTablePart.includes('.')) {
              // It's schema.table format - extract just the table name
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
    
    // Also parse standalone Ref statements
    // Supports: Ref: schema.table.column > schema.table.column
    // And: Ref: table.column > table.column
    const refRegex = /Ref\s*(?:(\w+)\s*)?:\s*((?:\w+\.)?\w+)\.(\w+)\s*([<>\-])\s*((?:\w+\.)?\w+)\.(\w+)/gi;
    let match;
    
    while ((match = refRegex.exec(content)) !== null) {
      const relationType = match[4];
      
      // Parse from table (may include schema)
      let fromTable = match[2];
      if (fromTable.includes('.')) {
        const parts = fromTable.split('.');
        fromTable = parts[parts.length - 1];
      }
      
      // Parse to table (may include schema)
      let toTable = match[5];
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
        name: match[1],
        fromTable: fromTable,
        fromColumn: match[3],
        toTable: toTable,
        toColumn: match[6],
        fromRelation,
        toRelation
      });
    }
    
    return refs;
  }

  private extractColorsFromContent(content: string): Map<string, string> {
    const colorMap = new Map<string, string>();
    
    const tableColorRegex = /Table\s+(\w+)\s*(?:as\s+\w+)?\s*\[([^\]]*)\]/gi;
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
      const colorMatch = options.match(/color\s*:\s*([#\w]+)/i);
      if (colorMatch) {
        colorMap.set(match[1], colorMatch[1]);
      }
    }

    return colorMap;
  }

  private extractTableGroups(content: string, colorMap: Map<string, string>): TableGroup[] {
    const groups: TableGroup[] = [];
    
    const groupRegex = /TableGroup\s+(\w+)\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/gi;
    let match;
    
    while ((match = groupRegex.exec(content)) !== null) {
      const groupName = match[1];
      const options = match[2] || '';
      const tablesContent = match[3];
      
      let color = colorMap.get(groupName);
      if (!color) {
        const colorMatch = options.match(/color\s*:\s*([#\w]+)/i);
        if (colorMatch) {
          color = colorMatch[1];
        }
      }
      
      const tables = tablesContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('//'));
      
      groups.push({
        name: groupName,
        tables,
        color
      });
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

    // Parse tables with optional schema prefix (schema.table or just table)
    const tableRegex = /Table\s+(?:(\w+)\.)?(\w+)(?:\s+as\s+(\w+))?\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/gi;
    let match;

    while ((match = tableRegex.exec(content)) !== null) {
      const schemaName = match[1] || undefined;
      const tableName = match[2];
      const alias = match[3];
      const options = match[4] || '';
      const columnsContent = match[5];

      // Track schema
      if (schemaName && !schema.schemas.includes(schemaName)) {
        schema.schemas.push(schemaName);
      }

      const colorMatch = options.match(/(?:color|headercolor)\s*:\s*([#\w]+)/i);
      const color = colorMatch ? colorMatch[1] : undefined;

      const table: Table = {
        name: tableName,
        alias,
        columns: [],
        color,
        headerColor: color,
        schema: schemaName
      };

      const lines = columnsContent.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('indexes') || trimmed.startsWith('Note')) continue;

        const columnMatch = trimmed.match(/^(\w+)\s+(\w+(?:\([^)]*\))?)\s*(?:\[([^\]]*)\])?/);
        if (columnMatch) {
          const options = columnMatch[3] || '';
          const column: Column = {
            name: columnMatch[1],
            type: columnMatch[2],
            pk: /\bpk\b/i.test(options),
            unique: /\bunique\b/i.test(options),
            notNull: /\bnot\s*null\b/i.test(options),
            increment: /\bincrement\b/i.test(options)
          };
          table.columns.push(column);
        }
      }

      schema.tables.push(table);
    }

    // Extract refs
    schema.refs = this.extractInlineRefs(content, schema.tables);

    // Parse table groups
    schema.tableGroups = this.extractTableGroups(content, this.extractGroupColorsFromContent(content));

    // Parse enums
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

    return schema;
  }
}
