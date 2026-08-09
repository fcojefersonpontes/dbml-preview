import { DBMLSchema, Table, Ref, TableGroup } from './parser';

export interface RenderOptions {
  defaultTableColor: string;
  defaultGroupColor: string;
  showRelationshipLabels: boolean;
  layout: 'left-right' | 'snowflake' | 'compact';
}

export interface Position {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ColumnPosition {
  table: string;
  column: string;
  x: number;
  y: number;
  width: number;
}

export interface TableLayoutInfo {
  name: string;
  connections: number;
  inDegree: number;
  outDegree: number;
  level: number;
  group?: string;
}

const COMPOSITE_REF_ACCENTS = ['#ab47bc', '#26a69a', '#ff7043', '#5c6bc0', '#ec407a', '#8d6e63'];

export function isCompositeRef(ref: Ref): boolean {
  return ref.fromColumns.length > 1 || ref.toColumns.length > 1;
}

export function getRefVisualMetadata(ref: Ref, index: number): { id: string; composite: boolean; accent: string; paletteIndex: number } {
  const composite = isCompositeRef(ref);
  const paletteIndex = index % COMPOSITE_REF_ACCENTS.length;
  return {
    id: `ref-${index}`,
    composite,
    accent: composite ? COMPOSITE_REF_ACCENTS[paletteIndex] : '#64b5f6',
    paletteIndex
  };
}

export class ERDRenderer {
  private options: RenderOptions;
  private tablePositions: Map<string, Position> = new Map();
  private columnPositions: Map<string, ColumnPosition> = new Map();
  private tableWidth = 240;
  private rowHeight = 26;
  private headerHeight = 38;
  private tablePadding = 10;
  
  constructor(options: RenderOptions) {
    this.options = options;
  }

  render(schema: DBMLSchema): string {
    this.calculateLayout(schema);
    return this.generateSVG(schema);
  }

  getTablePositions(): Map<string, Position> {
    return this.tablePositions;
  }

  private calculateLayout(schema: DBMLSchema): void {
    switch (this.options.layout) {
      case 'left-right':
        this.calculateLeftRightLayout(schema);
        break;
      case 'snowflake':
        this.calculateSnowflakeLayout(schema);
        break;
      case 'compact':
      default:
        this.calculateCompactLayout(schema);
        break;
    }

    // Calculate column positions after table positions are set
    for (const table of schema.tables) {
      const pos = this.tablePositions.get(table.name);
      if (pos) {
        this.calculateColumnPositions(table, pos.x, pos.y);
      }
    }
  }

  // Layout 1: Left-Right (for ETL pipelines)
  private calculateLeftRightLayout(schema: DBMLSchema): void {
    const tableInfo = this.analyzeTableConnections(schema);
    const levels = this.assignLevels(schema, tableInfo);
    
    const margin = 80;
    const levelWidth = this.tableWidth + margin * 2;
    
    // Group tables by level
    const tablesByLevel = new Map<number, Table[]>();
    for (const table of schema.tables) {
      const level = levels.get(table.name) || 0;
      if (!tablesByLevel.has(level)) {
        tablesByLevel.set(level, []);
      }
      tablesByLevel.get(level)!.push(table);
    }
    
    // Sort levels
    const sortedLevels = Array.from(tablesByLevel.keys()).sort((a, b) => a - b);
    
    // Position tables
    for (const level of sortedLevels) {
      const tables = tablesByLevel.get(level)!;
      const x = margin + level * levelWidth;
      
      // Sort tables within level by connection count
      tables.sort((a, b) => {
        const infoA = tableInfo.get(a.name);
        const infoB = tableInfo.get(b.name);
        return (infoB?.connections || 0) - (infoA?.connections || 0);
      });
      
      let totalHeight = tables.reduce((sum, t) => sum + this.calculateTableHeight(t) + margin, 0);
      let y = Math.max(margin, (800 - totalHeight) / 2);
      
      for (const table of tables) {
        const height = this.calculateTableHeight(table);
        this.tablePositions.set(table.name, { x, y, width: this.tableWidth, height });
        y += height + margin;
      }
    }
  }

  // Layout 2: Snowflake (for data warehouses)
  private calculateSnowflakeLayout(schema: DBMLSchema): void {
    const tableInfo = this.analyzeTableConnections(schema);
    
    // Sort tables by connection count (most connected first)
    const sortedTables = [...schema.tables].sort((a, b) => {
      const infoA = tableInfo.get(a.name);
      const infoB = tableInfo.get(b.name);
      return (infoB?.connections || 0) - (infoA?.connections || 0);
    });
    
    if (sortedTables.length === 0) return;
    
    const centerX = 600;
    const centerY = 500;
    const ringGap = 300;
    
    // Place most connected table in center
    const centerTable = sortedTables[0];
    const centerHeight = this.calculateTableHeight(centerTable);
    this.tablePositions.set(centerTable.name, {
      x: centerX - this.tableWidth / 2,
      y: centerY - centerHeight / 2,
      width: this.tableWidth,
      height: centerHeight
    });
    
    // Group remaining tables into rings based on their connection to center tables
    const placed = new Set<string>([centerTable.name]);
    const rings: Table[][] = [[], [], []];
    
    // First ring: directly connected to center
    for (const ref of schema.refs) {
      if (ref.fromTable === centerTable.name && !placed.has(ref.toTable)) {
        const table = sortedTables.find(t => t.name === ref.toTable);
        if (table) { rings[0].push(table); placed.add(table.name); }
      }
      if (ref.toTable === centerTable.name && !placed.has(ref.fromTable)) {
        const table = sortedTables.find(t => t.name === ref.fromTable);
        if (table) { rings[0].push(table); placed.add(table.name); }
      }
    }
    
    // Second ring: connected to first ring
    for (const ringTable of rings[0]) {
      for (const ref of schema.refs) {
        if (ref.fromTable === ringTable.name && !placed.has(ref.toTable)) {
          const table = sortedTables.find(t => t.name === ref.toTable);
          if (table) { rings[1].push(table); placed.add(table.name); }
        }
        if (ref.toTable === ringTable.name && !placed.has(ref.fromTable)) {
          const table = sortedTables.find(t => t.name === ref.fromTable);
          if (table) { rings[1].push(table); placed.add(table.name); }
        }
      }
    }
    
    // Remaining tables go in outer ring
    for (const table of sortedTables) {
      if (!placed.has(table.name)) {
        rings[2].push(table);
        placed.add(table.name);
      }
    }
    
    // Position tables in rings
    for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
      const ring = rings[ringIndex];
      if (ring.length === 0) continue;
      
      const radius = ringGap * (ringIndex + 1);
      const angleStep = (2 * Math.PI) / ring.length;
      const startAngle = -Math.PI / 2; // Start from top
      
      for (let i = 0; i < ring.length; i++) {
        const table = ring[i];
        const angle = startAngle + i * angleStep;
        const x = centerX + radius * Math.cos(angle) - this.tableWidth / 2;
        const y = centerY + radius * Math.sin(angle) - this.calculateTableHeight(table) / 2;
        
        this.tablePositions.set(table.name, {
          x,
          y,
          width: this.tableWidth,
          height: this.calculateTableHeight(table)
        });
      }
    }
  }

  // Layout 3: Compact (grid layout)
  private calculateCompactLayout(schema: DBMLSchema): void {
    const margin = 60;
    const tablesPerRow = Math.ceil(Math.sqrt(schema.tables.length));
    
    // Group tables by their TableGroup
    const groupedTables = new Map<string, Table[]>();
    const ungroupedTables: Table[] = [];
    
    for (const group of schema.tableGroups) {
      groupedTables.set(group.name, []);
    }
    
    for (const table of schema.tables) {
      let foundGroup = false;
      for (const group of schema.tableGroups) {
        if (group.tables.includes(table.name)) {
          groupedTables.get(group.name)!.push(table);
          foundGroup = true;
          break;
        }
      }
      if (!foundGroup) {
        ungroupedTables.push(table);
      }
    }
    
    let currentY = margin;
    
    // Layout grouped tables
    for (const [groupName, tables] of groupedTables) {
      if (tables.length === 0) continue;
      
      const groupTablesPerRow = Math.min(3, tables.length);
      let currentX = margin;
      let maxRowHeight = 0;
      let colIndex = 0;
      
      for (const table of tables) {
        const height = this.calculateTableHeight(table);
        
        if (colIndex >= groupTablesPerRow) {
          currentY += maxRowHeight + margin;
          currentX = margin;
          maxRowHeight = 0;
          colIndex = 0;
        }
        
        this.tablePositions.set(table.name, {
          x: currentX,
          y: currentY,
          width: this.tableWidth,
          height
        });
        
        currentX += this.tableWidth + margin;
        maxRowHeight = Math.max(maxRowHeight, height);
        colIndex++;
      }
      
      currentY += maxRowHeight + margin * 1.5;
    }
    
    // Layout ungrouped tables
    if (ungroupedTables.length > 0) {
      let currentX = margin;
      let maxRowHeight = 0;
      let colIndex = 0;
      
      for (const table of ungroupedTables) {
        const height = this.calculateTableHeight(table);
        
        if (colIndex >= tablesPerRow) {
          currentY += maxRowHeight + margin;
          currentX = margin;
          maxRowHeight = 0;
          colIndex = 0;
        }
        
        this.tablePositions.set(table.name, {
          x: currentX,
          y: currentY,
          width: this.tableWidth,
          height
        });
        
        currentX += this.tableWidth + margin;
        maxRowHeight = Math.max(maxRowHeight, height);
        colIndex++;
      }
    }
  }

  private analyzeTableConnections(schema: DBMLSchema): Map<string, TableLayoutInfo> {
    const info = new Map<string, TableLayoutInfo>();
    
    for (const table of schema.tables) {
      let group: string | undefined;
      for (const g of schema.tableGroups) {
        if (g.tables.includes(table.name)) {
          group = g.name;
          break;
        }
      }
      
      info.set(table.name, {
        name: table.name,
        connections: 0,
        inDegree: 0,
        outDegree: 0,
        level: 0,
        group
      });
    }
    
    for (const ref of schema.refs) {
      const fromInfo = info.get(ref.fromTable);
      const toInfo = info.get(ref.toTable);
      
      if (fromInfo) {
        fromInfo.connections++;
        fromInfo.outDegree++;
      }
      if (toInfo) {
        toInfo.connections++;
        toInfo.inDegree++;
      }
    }
    
    return info;
  }

  private assignLevels(schema: DBMLSchema, tableInfo: Map<string, TableLayoutInfo>): Map<string, number> {
    const levels = new Map<string, number>();
    const visited = new Set<string>();
    
    // Find root tables (no incoming references or most outgoing)
    const roots: string[] = [];
    for (const table of schema.tables) {
      const info = tableInfo.get(table.name);
      if (info && info.inDegree === 0 && info.outDegree > 0) {
        roots.push(table.name);
      }
    }
    
    // If no clear roots, use tables with highest out/in ratio
    if (roots.length === 0) {
      const sorted = [...schema.tables].sort((a, b) => {
        const infoA = tableInfo.get(a.name);
        const infoB = tableInfo.get(b.name);
        const ratioA = (infoA?.outDegree || 0) - (infoA?.inDegree || 0);
        const ratioB = (infoB?.outDegree || 0) - (infoB?.inDegree || 0);
        return ratioB - ratioA;
      });
      if (sorted.length > 0) roots.push(sorted[0].name);
    }
    
    // BFS to assign levels
    const queue: { name: string; level: number }[] = roots.map(r => ({ name: r, level: 0 }));
    
    while (queue.length > 0) {
      const { name, level } = queue.shift()!;
      
      if (visited.has(name)) continue;
      visited.add(name);
      levels.set(name, level);
      
      // Find connected tables
      for (const ref of schema.refs) {
        if (ref.fromTable === name && !visited.has(ref.toTable)) {
          queue.push({ name: ref.toTable, level: level + 1 });
        }
      }
    }
    
    // Assign remaining tables
    for (const table of schema.tables) {
      if (!levels.has(table.name)) {
        levels.set(table.name, 0);
      }
    }
    
    return levels;
  }

  private calculateTableHeight(table: Table): number {
    return this.headerHeight + (table.columns.length * this.rowHeight) + this.tablePadding * 2;
  }

  private calculateColumnPositions(table: Table, tableX: number, tableY: number): void {
    let y = tableY + this.headerHeight + this.tablePadding;
    
    for (const column of table.columns) {
      const key = `${table.name}.${column.name}`;
      this.columnPositions.set(key, {
        table: table.name,
        column: column.name,
        x: tableX,
        y: y + this.rowHeight / 2,
        width: this.tableWidth
      });
      y += this.rowHeight;
    }
  }

  private generateSVG(schema: DBMLSchema): string {
    let maxX = 0;
    let maxY = 0;
    
    for (const pos of this.tablePositions.values()) {
      maxX = Math.max(maxX, pos.x + pos.width);
      maxY = Math.max(maxY, pos.y + pos.height);
    }
    
    const width = maxX + 100;
    const height = maxY + 100;

    // Generate positions JSON for JavaScript
    const positionsJson = JSON.stringify(
      Array.from(this.tablePositions.entries()).map(([name, pos]) => ({ name, ...pos }))
    );

    const compositeMarkerDefs = COMPOSITE_REF_ACCENTS.map((accent, index) => {
      return `
    <marker id="many-crow-composite-${index}" markerWidth="20" markerHeight="20" refX="18" refY="10" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M0,10 L18,2 M0,10 L18,10 M0,10 L18,18" stroke="${accent}" stroke-width="2" fill="none" stroke-linecap="round"/>
    </marker>
    <marker id="one-line-composite-${index}" markerWidth="16" markerHeight="20" refX="14" refY="10" orient="auto" markerUnits="userSpaceOnUse">
      <line x1="4" y1="2" x2="4" y2="18" stroke="${accent}" stroke-width="2.5" stroke-linecap="round"/>
      <line x1="12" y1="2" x2="12" y2="18" stroke="${accent}" stroke-width="2.5" stroke-linecap="round"/>
    </marker>`;
    }).join('');

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" data-positions='${positionsJson}'>
  <defs>
    <style>
      .table-header { font-family: 'Segoe UI', 'SF Pro Display', Arial, sans-serif; font-size: 13px; font-weight: 600; fill: white; }
      .svg-background { fill: var(--bg-main, #1e1e1e); }
      .table-bg { fill: var(--erd-table-bg, #2a2a2a); }
      .column-name { font-family: 'Segoe UI', 'SF Pro Display', Arial, sans-serif; font-size: 11px; fill: var(--erd-text-primary, #e0e0e0); }
      .column-type { font-family: 'Segoe UI', 'SF Pro Display', Arial, sans-serif; font-size: 10px; fill: var(--erd-text-muted, #888); }
      .pk-icon { font-family: 'Segoe UI', Arial, sans-serif; font-size: 9px; fill: #ffd700; font-weight: bold; }
      .fk-icon { font-family: 'Segoe UI', Arial, sans-serif; font-size: 9px; fill: #64b5f6; font-weight: bold; }
      .composite-fk-icon { fill: var(--composite-accent); font-size: 8px; letter-spacing: .2px; }
      .composite-ref-swatch { cursor: pointer; stroke: var(--erd-table-bg, #2a2a2a); stroke-width: 1; }
      .column-highlight { fill: var(--composite-highlight, transparent); stroke: var(--composite-highlight, transparent); stroke-width: 1; opacity: 0; pointer-events: none; }
      .column.composite-highlighted .column-highlight { opacity: .2; }
      .group-label { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; fill: var(--erd-text-muted, #aaa); font-weight: 500; }
      .relation-line { stroke-width: 2; fill: none; }
      .cardinality-label { font-family: 'Segoe UI', Arial, sans-serif; font-size: 14px; font-weight: bold; }
      .cardinality-bg { fill: var(--erd-card-bg, #2a2a2a); }
      .col-row-alt { fill: var(--erd-row-alt, rgba(255,255,255,0.02)); }
      .col-sep { stroke: var(--erd-separator, rgba(255,255,255,0.05)); stroke-width: 1; }
      .draggable { cursor: move; }
      .dragging { opacity: 0.8; }
    </style>
    
    <!-- Arrow marker for end of line -->
    <marker id="arrow-end" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M0,0 L12,6 L0,12 L3,6 Z" fill="#64b5f6"/>
    </marker>
    
    <!-- Circle marker for "one" side -->
    <marker id="one-circle" markerWidth="16" markerHeight="16" refX="8" refY="8" orient="auto" markerUnits="userSpaceOnUse">
      <circle cx="8" cy="8" r="5" fill="none" stroke="#64b5f6" stroke-width="2"/>
    </marker>
    
    <!-- Crow's foot marker for "many" side -->
    <marker id="many-crow" markerWidth="20" markerHeight="20" refX="18" refY="10" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M0,10 L18,2 M0,10 L18,10 M0,10 L18,18" stroke="#64b5f6" stroke-width="2" fill="none" stroke-linecap="round"/>
    </marker>
    
    <!-- One with line marker -->
    <marker id="one-line" markerWidth="16" markerHeight="20" refX="14" refY="10" orient="auto" markerUnits="userSpaceOnUse">
      <line x1="4" y1="2" x2="4" y2="18" stroke="#64b5f6" stroke-width="2.5" stroke-linecap="round"/>
      <line x1="12" y1="2" x2="12" y2="18" stroke="#64b5f6" stroke-width="2.5" stroke-linecap="round"/>
    </marker>
    ${compositeMarkerDefs}

    
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="2" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.3"/>
    </filter>
    
    <filter id="glow">
      <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  
  <rect class="svg-background" width="100%" height="100%"/>
  
  <!-- Relationships layer -->
  <g class="relationships-layer">
`;

    // Draw relationships first (behind tables)
    for (const ref of schema.refs) {
      svg += this.renderRelationship(ref, schema);
    }

    // Build map of table colors from groups
    const tableColorFromGroup = new Map<string, string>();
    for (const group of schema.tableGroups) {
      const color = group.color || this.options.defaultGroupColor;
      for (const tableRef of group.tables) {
        // tableRef can be "schema.table" or just "table"
        // Extract just the table name and store both formats
        const tableName = tableRef.includes('.') ? tableRef.split('.').pop()! : tableRef;
        tableColorFromGroup.set(tableName, color);
      }
    }

    svg += `  </g>
  
  <!-- Groups layer -->
  <g class="groups-layer">
`;

    // Draw group backgrounds
    for (const group of schema.tableGroups) {
      svg += this.renderGroupBackground(group, schema.tables);
    }

    svg += `  </g>
  
  <!-- Tables layer -->
  <g class="tables-layer">
`;

    // Draw tables - color comes from group first, then table definition, then default
    for (const table of schema.tables) {
      // Priority: group color > table color > default
      const groupColor = tableColorFromGroup.get(table.name);
      const color = groupColor || table.color || table.headerColor || this.options.defaultTableColor;
      svg += this.renderTable(table, color, schema.refs);
    }

    svg += `  </g>
</svg>`;
    return svg;
  }

  private renderGroupBackground(group: TableGroup, tables: Table[]): string {
    // Normalize group table names (extract just the table name from schema.table format)
    const normalizedGroupTables = group.tables.map(t => t.includes('.') ? t.split('.').pop()! : t);
    
    // Match tables by normalized name
    const groupTables = tables.filter(t => normalizedGroupTables.includes(t.name));
    
    if (groupTables.length === 0) return '';

    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
    
    for (const table of groupTables) {
      const pos = this.tablePositions.get(table.name);
      if (pos) {
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
        maxX = Math.max(maxX, pos.x + pos.width);
        maxY = Math.max(maxY, pos.y + pos.height);
      }
    }
    
    if (minX === Infinity) return '';

    const padding = 25;
    const color = group.color || this.options.defaultGroupColor;
    
    return `
    <g class="table-group" data-group="${group.name}" style="pointer-events: all;">
      <rect x="${minX - padding}" y="${minY - padding - 30}" 
            width="${maxX - minX + padding * 2}" height="${maxY - minY + padding * 2 + 30}"
            fill="${color}15" stroke="${color}" stroke-width="2" stroke-dasharray="8,4" rx="12" ry="12"
            style="pointer-events: all; cursor: move;"/>
      <text x="${minX - padding + 12}" y="${minY - padding - 10}" class="group-label" fill="${color}">${group.name}</text>
    </g>`;
  }

  private renderTable(table: Table, color: string, refs: Ref[]): string {
    const pos = this.tablePositions.get(table.name);
    if (!pos) return '';
    
    const fkColumns = new Set<string>();
    const scalarFkColumns = new Set<string>();
    for (const ref of refs) {
      if (ref.fromTable === table.name) {
        ref.fromColumns.forEach(column => fkColumns.add(column));
        if (!isCompositeRef(ref)) ref.fromColumns.forEach(column => scalarFkColumns.add(column));
      }
    }


    const compositeMemberships = refs
      .map((ref, index) => ({ ref, ...getRefVisualMetadata(ref, index) }))
      .filter(item => item.composite && (item.ref.fromTable === table.name || item.ref.toTable === table.name));
    let svg = `
    <g class="table draggable" data-table="${table.name}" transform="translate(0,0)">
      <rect class="table-bg" x="${pos.x}" y="${pos.y}" width="${pos.width}" height="${pos.height}"
            fill="var(--erd-table-bg)" stroke="${color}" stroke-width="2" rx="8" ry="8" filter="url(#shadow)"/>
      
      <rect class="table-header-bg" x="${pos.x}" y="${pos.y}" width="${pos.width}" height="${this.headerHeight}"
            fill="${color}" rx="8" ry="8"/>
      <rect x="${pos.x}" y="${pos.y + this.headerHeight - 8}" width="${pos.width}" height="8" fill="${color}"/>
      
      <line x1="${pos.x}" y1="${pos.y + this.headerHeight}" x2="${pos.x + pos.width}" y2="${pos.y + this.headerHeight}"
            stroke="${color}" stroke-width="1" opacity="0.5"/>
      
      <text x="${pos.x + pos.width / 2}" y="${pos.y + 24}" text-anchor="middle" class="table-header">${table.name}</text>
`;

    let y = pos.y + this.headerHeight + this.tablePadding;
    
    for (let i = 0; i < table.columns.length; i++) {
      const column = table.columns[i];
      const isPK = column.pk;
      const isFK = fkColumns.has(column.name);
      const isScalarFK = scalarFkColumns.has(column.name);
      const isLast = i === table.columns.length - 1;
      
      const columnCompositeRefs = compositeMemberships.filter(item =>
        (item.ref.fromTable === table.name && item.ref.fromColumns.includes(column.name)) ||
        (item.ref.toTable === table.name && item.ref.toColumns.includes(column.name))
      );
      const sourceCompositeRefs = columnCompositeRefs.filter(item =>
        item.ref.fromTable === table.name && item.ref.fromColumns.includes(column.name)
      );
      const isCompositeFK = sourceCompositeRefs.length > 0;
      if (i % 2 === 1) {
        svg += `
      <rect class="col-row-alt" x="${pos.x + 2}" y="${y - 2}" width="${pos.width - 4}" height="${this.rowHeight}" rx="2"/>`;
      }
      
      svg += `
      <g class="column${columnCompositeRefs.length > 0 ? ' composite-column' : ''}" data-table="${table.name}" data-column="${column.name}"${columnCompositeRefs.length > 0 ? ` data-composite-refs="${columnCompositeRefs.map(item => item.id).join(' ')}"` : ''}>
        <rect class="column-highlight" x="${pos.x + 2}" y="${y - 2}" width="${pos.width - 4}" height="${this.rowHeight}" rx="2"/>`;
      
      let iconOffset = pos.x + 10;
      
      if (isPK) {
        svg += `
        <text x="${iconOffset}" y="${y + 13}" class="pk-icon">🔑</text>`;
        iconOffset += 18;
      }
      
      if (isFK) {
        if (isCompositeFK) {
          const compositeAccent = sourceCompositeRefs.length === 1 ? sourceCompositeRefs[0].accent : '#bdbdbd';
          const compositeLabel = isScalarFK ? 'FK+CFK' : 'CFK';
          const badgeWidth = isScalarFK ? 40 : 24;
          const swatches = sourceCompositeRefs.length > 1
            ? sourceCompositeRefs.map((item, index) => `<circle cx="${iconOffset + badgeWidth - 5 + index * 5}" cy="${y + 10}" r="2" fill="${item.accent}" class="composite-ref-swatch" data-ref-id="${item.id}"/>`).join('')
            : '';
          svg += `
        <text x="${iconOffset}" y="${y + 13}" class="fk-icon composite-fk-icon" data-composite-refs="${sourceCompositeRefs.map(item => item.id).join(' ')}" style="--composite-accent:${compositeAccent}">${compositeLabel}</text>${swatches}`;
          iconOffset += badgeWidth + (sourceCompositeRefs.length > 1 ? sourceCompositeRefs.length * 5 : 0);
        } else {
          svg += `
        <text x="${iconOffset}" y="${y + 13}" class="fk-icon">🔗</text>`;
          iconOffset += 18;
        }
      }
      
      if (!isPK && !isFK) iconOffset += 4;
      
      svg += `
        <text x="${iconOffset}" y="${y + 13}" class="column-name">${column.name}</text>
        <text x="${pos.x + pos.width - 10}" y="${y + 13}" text-anchor="end" class="column-type">${column.type}</text>
      </g>`;
      
      if (!isLast) {
        svg += `
      <line class="col-sep" x1="${pos.x + 8}" y1="${y + this.rowHeight - 1}" x2="${pos.x + pos.width - 8}" y2="${y + this.rowHeight - 1}"/>`;
      }
      
      y += this.rowHeight;
    }

    svg += `
    </g>`;
    
    return svg;
  }

  private renderRelationship(ref: Ref, schema: DBMLSchema): string {
    const fromColumn = ref.fromColumns[0];
    const toColumn = ref.toColumns[0];
    const fromColPos = this.columnPositions.get(`${ref.fromTable}.${fromColumn}`);
    const refIndex = schema.refs.indexOf(ref);
    const visual = getRefVisualMetadata(ref, refIndex);
    const toColPos = this.columnPositions.get(`${ref.toTable}.${toColumn}`);
    const fromTablePos = this.tablePositions.get(ref.fromTable);
    const toTablePos = this.tablePositions.get(ref.toTable);
    
    if (!fromColPos || !toColPos || !fromTablePos || !toTablePos) return '';

    const fromCenterX = fromTablePos.x + fromTablePos.width / 2;
    const toCenterX = toTablePos.x + toTablePos.width / 2;
    
    let fromX: number, toX: number;
    let fromSide: 'left' | 'right';
    let toSide: 'left' | 'right';
    
    if (fromTablePos.x + fromTablePos.width + 20 < toTablePos.x) {
      fromX = fromColPos.x + fromColPos.width;
      toX = toColPos.x;
      fromSide = 'right';
      toSide = 'left';
    } else if (toTablePos.x + toTablePos.width + 20 < fromTablePos.x) {
      fromX = fromColPos.x;
      toX = toColPos.x + toColPos.width;
      fromSide = 'left';
      toSide = 'right';
    } else {
      if (fromCenterX < toCenterX) {
        fromX = fromColPos.x + fromColPos.width;
        toX = toColPos.x;
        fromSide = 'right';
        toSide = 'left';
      } else {
        fromX = fromColPos.x;
        toX = toColPos.x + toColPos.width;
        fromSide = 'left';
        toSide = 'right';
      }
    }
    
    const fromY = fromColPos.y;
    const toY = toColPos.y;

    const horizontalDistance = Math.abs(toX - fromX);
    const verticalDistance = Math.abs(toY - fromY);
    
    let controlOffset = Math.max(50, Math.min(horizontalDistance * 0.4, 120));
    
    if (horizontalDistance < 50 && verticalDistance > 100) {
      controlOffset = Math.max(70, verticalDistance * 0.3);
    }
    
    const cp1x = fromSide === 'right' ? fromX + controlOffset : fromX - controlOffset;
    const cp2x = toSide === 'left' ? toX - controlOffset : toX + controlOffset;
    
    const path = `M ${fromX} ${fromY} C ${cp1x} ${fromY}, ${cp2x} ${toY}, ${toX} ${toY}`;
    
    // Determine marker based on cardinality
    const markerSuffix = visual.composite ? `-composite-${visual.paletteIndex}` : '';
    const startMarker = ref.fromRelation === '*' ? `url(#many-crow${markerSuffix})` : `url(#one-line${markerSuffix})`;
    const endMarker = ref.toRelation === '*' ? `url(#many-crow${markerSuffix})` : `url(#one-line${markerSuffix})`;
    
    const fromCardLabel = ref.fromRelation === '*' ? 'N' : '1';
    const toCardLabel = ref.toRelation === '*' ? 'N' : '1';
    
    // Position labels with more offset and background
    const fromLabelX = fromSide === 'right' ? fromX + 28 : fromX - 28;
    const toLabelX = toSide === 'left' ? toX - 28 : toX + 28;
    const labelOffsetY = -12;
    
    return `
    <g class="relationship${visual.composite ? ' composite-relationship' : ''}" data-from="${ref.fromTable}.${fromColumn}" data-to="${ref.toTable}.${toColumn}"
       data-from-table="${ref.fromTable}" data-to-table="${ref.toTable}"
       data-ref-id="${visual.id}" data-composite="${visual.composite}" data-accent="${visual.accent}"
       data-from-columns="${ref.fromColumns.join(',')}" data-to-columns="${ref.toColumns.join(',')}"
       style="--constraint-accent:${visual.accent}">
      <path d="${path}" class="relation-line" stroke="${visual.accent}" stroke-opacity="${visual.composite ? '0.75' : '0.6'}" stroke-width="${visual.composite ? '2.5' : '2'}"
            marker-start="${startMarker}" marker-end="${endMarker}"/>
      <path d="${path}" stroke="transparent" stroke-width="20" fill="none" class="relation-hover-target"/>
      
      <!-- From cardinality label with background -->
      <rect x="${fromLabelX - 12}" y="${fromY + labelOffsetY - 12}" width="24" height="20" rx="4"
            class="cardinality-bg" stroke="${visual.accent}" stroke-width="1" opacity="0.9"/>
      <text x="${fromLabelX}" y="${fromY + labelOffsetY + 2}" text-anchor="middle"
            class="cardinality-label" fill="${visual.accent}">${fromCardLabel}</text>

      <!-- To cardinality label with background -->
      <rect x="${toLabelX - 12}" y="${toY + labelOffsetY - 12}" width="24" height="20" rx="4"
            class="cardinality-bg" stroke="${visual.accent}" stroke-width="1" opacity="0.9"/>
      <text x="${toLabelX}" y="${toY + labelOffsetY + 2}" text-anchor="middle"
            class="cardinality-label" fill="${visual.accent}">${toCardLabel}</text>
    </g>`;
  }
}
