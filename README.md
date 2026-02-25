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


## Example - e-comerce

``` dbml
// =============================================
// E-commerce Database Schema
// Example file to test DBML Viewer
// =============================================

Project ecommerce {
  database_type: 'PostgreSQL'
  Note: 'E-commerce platform database schema'
}


// =============================================
// User Tables
// =============================================

Table user.users {
  id int [pk, increment]
  email varchar(255) [unique, not null]
  password_hash varchar(255) [not null]
  is_active boolean [default: true]
  is_admin boolean [default: false]
  created_at timestamp [default: `now()`]
  updated_at timestamp
  
  Note: 'Main users table'
}

Table user.user_profiles {
  id int [pk, increment]
  user_id int [unique, not null, ref: - users.id]
  first_name varchar(100)
  last_name varchar(100)
  phone varchar(20)
  birth_date date
  avatar_url varchar(500)
  
  Note: 'Extended user profile information'
}

Table user.user_addresses {
  id int [pk, increment]
  user_id int [not null, ref: > users.id]
  label varchar(50) [note: 'e.g., Home, Work']
  street varchar(200) [not null]
  number varchar(20)
  complement varchar(100)
  neighborhood varchar(100)
  city varchar(100) [not null]
  state varchar(50) [not null]
  country varchar(50) [not null, default: 'Brasil']
  postal_code varchar(20) [not null]
  is_default boolean [default: false]
  
  Note: 'User shipping/billing addresses'
}

// =============================================
// Product Tables
// =============================================

Table categories {
  id int [pk, increment]
  name varchar(100) [not null]
  slug varchar(100) [unique, not null]
  description text
  parent_id int [ref: > categories.id]
  image_url varchar(500)
  is_active boolean [default: true]
  sort_order int [default: 0]
  
  Note: 'Product categories with self-referencing hierarchy'
}

Table products {
  id int [pk, increment]
  sku varchar(50) [unique, not null]
  name varchar(200) [not null]
  slug varchar(200) [unique, not null]
  description text
  price decimal(10,2) [not null]
  compare_at_price decimal(10,2)
  cost_price decimal(10,2)
  category_id int [ref: > categories.id]
  is_active boolean [default: true]
  is_featured boolean [default: false]
  weight decimal(8,3)
  created_at timestamp [default: `now()`]
  updated_at timestamp
  
  Note: 'Main products table'
}

Table product_images {
  id int [pk, increment]
  product_id int [not null, ref: > products.id]
  url varchar(500) [not null]
  alt_text varchar(200)
  sort_order int [default: 0]
  is_primary boolean [default: false]
}

Table inventory {
  id int [pk, increment]
  product_id int [unique, not null, ref: - products.id]
  quantity int [not null, default: 0]
  reserved_quantity int [default: 0]
  low_stock_threshold int [default: 10]
  updated_at timestamp
  
  Note: 'Product inventory tracking'
}

// =============================================
// Order Tables
// =============================================

Table order.orders {
  id int [pk, increment]
  order_number varchar(50) [unique, not null]
  user_id int [not null, ref: > users.id]
  status order_status [not null, default: 'pending']
  subtotal decimal(10,2) [not null]
  shipping_cost decimal(10,2) [default: 0]
  discount decimal(10,2) [default: 0]
  tax decimal(10,2) [default: 0]
  total decimal(10,2) [not null]
  shipping_address_id int [ref: > user_addresses.id]
  billing_address_id int [ref: > user_addresses.id]
  notes text
  created_at timestamp [default: `now()`]
  updated_at timestamp
  
  Note: 'Customer orders'
}

Table order.order_items {
  id int [pk, increment]
  order_id int [not null, ref: > orders.id]
  product_id int [not null, ref: > products.id]
  quantity int [not null]
  unit_price decimal(10,2) [not null]
  total_price decimal(10,2) [not null]
  
  Note: 'Individual items in an order'
}

Table payments {
  id int [pk, increment]
  order_id int [not null, ref: > orders.id]
  payment_method payment_method [not null]
  status payment_status [not null, default: 'pending']
  amount decimal(10,2) [not null]
  transaction_id varchar(100)
  gateway_response text
  paid_at timestamp
  created_at timestamp [default: `now()`]
  
  Note: 'Payment transactions'
}

Table shipping {
  id int [pk, increment]
  order_id int [unique, not null, ref: - orders.id]
  carrier varchar(100)
  tracking_number varchar(100)
  status shipping_status [default: 'pending']
  estimated_delivery date
  shipped_at timestamp
  delivered_at timestamp
  
  Note: 'Shipping information for orders'
}

// =============================================
// Review Tables
// =============================================

Table reviews {
  id int [pk, increment]
  product_id int [not null, ref: > products.id]
  user_id int [not null, ref: > users.id]
  rating int [not null, note: '1-5 stars']
  title varchar(200)
  content text
  is_verified_purchase boolean [default: false]
  is_approved boolean [default: false]
  helpful_count int [default: 0]
  created_at timestamp [default: `now()`]
  
  Note: 'Product reviews from customers'
}

Table review_images {
  id int [pk, increment]
  review_id int [not null, ref: > reviews.id]
  url varchar(500) [not null]
  sort_order int [default: 0]
}

// =============================================
// Enums
// =============================================

Enum order_status {
  pending [note: 'Order placed, awaiting payment']
  paid [note: 'Payment confirmed']
  processing [note: 'Being prepared']
  shipped [note: 'Handed to carrier']
  delivered [note: 'Received by customer']
  cancelled [note: 'Order cancelled']
  refunded [note: 'Money returned']
}

Enum payment_method {
  credit_card
  debit_card
  pix
  boleto
  paypal
  apple_pay
  google_pay
}

Enum payment_status {
  pending
  processing
  approved
  rejected
  refunded
  chargeback
}

Enum shipping_status {
  pending
  processing
  shipped
  in_transit
  out_for_delivery
  delivered
  returned
}

// =============================================
// Table Groups with Colors
// =============================================

TableGroup users_group [color: #3498db] {
  users
  user_profiles
  user_addresses
}

TableGroup products_group [color: #2ecc71] {
  products
  categories
  product_images
  inventory
}

TableGroup orders_group [color: #e74c3c] {
  orders
  order_items
  payments
  shipping
}

TableGroup reviews_group [color: #9b59b6] {
  reviews
  review_images
}

```