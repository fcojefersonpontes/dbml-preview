# DBML Previewer

A VS Code extension to preview Entity-Relationship Diagrams from DBML (Database Markup Language) files.

## Features

- **Interactive Diagram Preview**: Visualize your database schema as an ERD
- **Drag & Drop**: Reposition tables and groups by dragging
- **Multiple Schemas**: Support for schema-prefixed tables (e.g., `core.users`, `sales.orders`)
- **Table Groups**: Visual grouping with colored borders
- **Relationships**: Automatic relationship lines with cardinality (1:N, N:1, 1:1, N:N)
- **Save Layout**: Persist your custom table positions
- **Export SVG**: Export the diagram as an SVG file
- **Navigation**: Click on tables/columns to jump to their definition in the source file

## Usage

1. Open a `.dbml` file in VS Code
2. Click the "Preview Diagram" button in the editor title bar, or:
   - Use the command palette: `DBML: Preview Diagram`
   - Click the code lens "Preview Diagram" at the top of the file
3. Drag tables to reposition them
4. Click "Save" (or Ctrl+S) to persist the layout
5. Click "Export SVG" to save the diagram

## DBML Syntax Support

### Tables with Schemas
```dbml
Table core.users {
  id int [pk]
  email varchar(255)
}

Table sales.orders {
  id int [pk]
  user_id int [ref: > core.users.id]
}
```

### Table Groups with Colors
```dbml
TableGroup core_entities [color: #3498db] {
  core.users
  core.roles
  core.addresses
}

TableGroup sales_entities [color: #e74c3c] {
  sales.orders
  sales.order_items
}
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+S | Save layout |
| Ctrl+0 | Fit to screen |
| Ctrl++ | Zoom in |
| Ctrl+- | Zoom out |
| Escape | Deselect all |

## Mouse Controls

| Action | How to |
|--------|--------|
| Pan | Click and drag on empty space |
| Move table | Drag a table |
| Move group | Drag the group border, or Shift+drag a table |
| Zoom | Ctrl + mouse wheel |

## License

MIT
