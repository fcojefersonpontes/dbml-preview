# DBML Preview

A VS Code extension to preview Entity-Relationship Diagrams from `.dbml` files with interactive visualization.

## Features

- **Interactive ERD Preview** — visualize your database schema as a diagram directly in VS Code
- **Drag & Drop** — reposition tables and groups freely
- **Schema Support** — schema-prefixed tables (`core.users`, `sales.orders`)
- **Table Groups** — visual grouping with colored borders
- **Relationship Lines** — automatic lines with cardinality labels (1:N, N:1, 1:1, N:N)
- **Save Layout** — persist custom table positions to a `.erd-layout.json` file
- **Export SVG** — export the diagram as an SVG file
- **Syntax Highlighting** — full `.dbml` grammar with TextMate support
- **Navigation** — click a table or column to jump to its definition in the source file
- **Hover Documentation** — hover over a table in the editor for a quick column reference
- **Focus Mode** — isolate a table and its related tables; ideal for large Data Warehouse schemas with multiple star schemas

## Usage

1. Open a `.dbml` file in VS Code
2. Click the preview icon in the editor title bar, or use the command palette: `DBML: Preview Diagram`
3. Drag tables or groups to reposition them
4. Press **Ctrl+S** to save the layout
5. Use **Export SVG** in the toolbar to save the diagram as a file

## Focus Mode

Focus Mode lets you isolate a single table and its related tables, hiding everything else. Perfect for exploring a star schema inside a large Data Warehouse model.

**Activate:**
- Right-click a table on the canvas → **Focus on this table**
- Hover a table in the sidebar → click the 🎯 icon
- Select a table and press **F**

**While active:**
- A banner at the top shows the focal table name and how many tables are visible
- Use **−** / **+** in the banner to adjust depth (depth 1 = direct neighbors / star schema; depth 2 = snowflake)
- Zoom, drag, and pan work normally on the visible tables

**Exit:** click **✕ Exit Focus** in the banner, press **Escape**, or click empty canvas space.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+S | Save layout |
| Ctrl+0 | Fit diagram to screen |
| Ctrl++ | Zoom in |
| Ctrl+- | Zoom out |
| F | Activate Focus Mode on selected table |
| Escape | Exit Focus Mode (if active), otherwise deselect all |

## Mouse Controls

| Action | How |
|--------|-----|
| Pan canvas | Click and drag on empty space |
| Move table | Drag a table header |
| Move group | Drag the group border |
| Zoom | Ctrl + scroll wheel |

## DBML Syntax Support

### Tables with schemas

```dbml
Table core.users {
  id int [pk, increment]
  email varchar(255) [unique, not null]
  created_at timestamp [default: `now()`]

  Note: 'Main users table'
}

Table sales.orders {
  id int [pk, increment]
  user_id int [not null, ref: > core.users.id]
  status order_status [not null, default: 'pending']
  total decimal(10,2) [not null]
}
```

### Table groups with colors

```dbml
TableGroup core_entities [color: #3498db] {
  core.users
  core.roles
}

TableGroup sales_entities [color: #e74c3c] {
  sales.orders
  sales.order_items
}
```

### Enums

```dbml
Enum order_status {
  pending [note: 'Awaiting payment']
  paid
  shipped
  delivered
  cancelled
}
```

### Column notes

```dbml
Table user.user_addresses {
  label varchar(50) [note: 'e.g., Home, Work']
  postal_code varchar(20) [not null]
}
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `dbmlPreviewer.defaultTableColor` | `#3498db` | Default color for tables without a specified color |
| `dbmlPreviewer.defaultGroupColor` | `#95a5a6` | Default color for groups without a specified color |
| `dbmlPreviewer.showRelationshipLabels` | `true` | Show cardinality labels on relationship lines |

## License

MIT — created by [JefersonPontes](https://github.com/fcojefersonpontes/dbml-preview)
