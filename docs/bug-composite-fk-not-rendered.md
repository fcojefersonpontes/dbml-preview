# Composite foreign key is not rendered

## Summary

DBML Preview 1.3.0 does not parse or render standalone relationships that use multiple columns.

## Reproduction

1. Open `examples/composite-fk-not-rendered.dbml`.
2. Run `DBML: Preview Diagram`.
3. Check the relationship count and the lines in the diagram.

## Expected behavior

The preview shows all three relationships, including:

```dbml
Ref: inspection.(organization_id, source_asset_id) > object_asset.(organization_id, asset_id)
```

The composite relationship connects `inspection` to `object_asset`.

## Actual behavior

Only the two scalar relationships are shown. The composite relationship is silently omitted, so the preview reports `Rels: 2` instead of `Rels: 3`.

No syntax error or unsupported-syntax warning is displayed.

## Cause

`DBMLParser.extractInlineRefs()` uses this regular expression for standalone relationships:

```ts
/Ref\s*(?:(\w+)\s*)?:\s*((?:\w+\.)?\w+)\.(\w+)\s*([<>\-])\s*((?:\w+\.)?\w+)\.(\w+)/gi
```

After each table name and dot, the expression accepts only one column via `(\w+)`. A composite reference starts with `(` instead:

```text
inspection.(organization_id, source_asset_id)
           ^
```

Therefore the expression does not match and the parser never adds the relationship to `schema.refs`. The renderer receives no relationship to draw.

## Impact

- The ERD is incomplete even though the DBML relationship is valid.
- The displayed relationship count is lower than the actual count.
- Multi-tenant schemas commonly use composite foreign keys such as `(organization_id, entity_id)`, so many tenant-isolation relationships disappear.
- Users may incorrectly conclude that the database schema has missing foreign keys.

## Fix scope

The parser and `Ref` model must support arrays of source and target columns. Updating only the regular expression is insufficient because the current `Ref` interface stores one `fromColumn` and one `toColumn`.
