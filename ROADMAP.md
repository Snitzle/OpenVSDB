# vscode-db Roadmap

## Context

The maintainer migrated from IntelliJ/DataGrip and most misses its database integration. The extension today is a competent **MySQL + SQLite table browser/editor**: a webview sidebar tree, a table panel with paginated data, inline CRUD with transactions, and view-only DDL — all hand-rolled vanilla JS with no bundler.

This roadmap reorganizes work **UX-first** around the five workflows actually used day to day — **inspect, change values, export, import, run queries** — and defers broader DataGrip parity until those are excellent.

The driving insight: **one great data grid is the backbone of four of the five workflows.** Inspect, edit, export, and query-results all render rows in a grid, so we build the grid + native theming first and every workflow inherits that quality.

## Locked decisions

- **Data grid:** [Tabulator](https://tabulator.info/), bundled via a new **esbuild** step for webview assets.
- **Sidebar:** migrate to a **native VS Code `TreeDataProvider`** (replaces the webview tree). Connection add/edit moves to a small webview or multi-step QuickPick.
- **SQL editor:** **native `.sql` editor + Run** command, with a status-bar active-connection indicator; results render in the shared grid.

## Architecture principles

- **Shared ResultGrid:** refactor the table panel ([src/webview/tablePanelManager.ts](src/webview/tablePanelManager.ts) + [media/tablePanel.js](media/tablePanel.js)) into a reusable *ResultGrid* webview used by **both** table browsing and query results.
- **`executeRaw()` linchpin:** add `executeRaw(sql): Promise<RawResult[]>` to `DatabaseClient` ([src/db/client.ts](src/db/client.ts)) + both clients. Unlocks Run Queries, copy-as-SQL, EXPLAIN, and DDL execution.
- **Native theming:** VS Code theme tokens + codicons throughout; consistent toolbars; explicit loading / empty / error states.

## UI shell ✅ (implemented 2026-06-23)
The Database Explorer opens as a **main-window editor tab**, not a sidebar view. The activity-bar icon is a lightweight launcher (`viewsWelcome`) whose button opens/reveals the tab, and the view auto-opens it when shown. Tables open as their own grid tabs beside the explorer. See `src/webview/explorerPanel.ts` and the `dbExplorer.open` command.

**Explorer polish ✅ (2026-07-01):** constrained-width column; compact tree rows with `@vscode/codicons` icons (table / view / schema / connection), hover + selection states, per-schema counts, and an in-tree filter box; connection status as a dot; Edit/Remove as icon buttons; Add/Edit connection moved into a modal dialog. `media/main.js` is now bundled by esbuild (for the codicon CSS import) → `dist/main.js` + `dist/main.css` (codicon font inlined; `font-src data:` allows it).

**Grid density pass ✅ (2026-07-01):** table view rebuilt to a single compact toolbar (icon buttons; right-sized page-size select; find box), the structured filter collapsed behind a Filter toggle + active-filter chip, Apply/Cancel replaced by a contextual pending-changes bar, a collapsible DDL panel, ~28px Tabulator rows, aggregate strip that excludes PK / auto-increment columns, sentence-case section headers, and codicons bundled into the grid webview (`dist/tablePanel.css`).

## Stage 0 — UX foundation ✅ (implemented 2026-06-23)
- [x] esbuild build for webview assets (`media/tablePanel.js` → `dist/`), wired into npm scripts + the F5 preLaunchTask (`esbuild.js`).
- [x] Integrate Tabulator: virtual scroll, column resize/reorder/show-hide, row selection, sticky header. (Freeze via header menu; multi-sort deferred to Stage 1 — the backend supports single-column sort today.)
- [x] Table panel rebuilt on Tabulator. (Extracting it into a standalone ResultGrid module shared with the query console lands in Stage 4.)
- [x] Native theming: VS Code theme tokens for controls + grid (`media/tabulator-vscode.css`); removed the hardcoded teal gradient. (Codicons deferred to Stage 1.)
- [x] Add `executeRaw()` to the client interface + `mysqlClient` (multi-statement) / `sqliteClient` (statement splitter in `src/sql/statements.ts`, unit-tested).

## Stage 1 — Inspect (in progress, 2026-06-23)
- [x] "Filter by this value" cell context action (right-click a cell).
- [x] Cell **value viewer** (right-click → View value): pretty-prints JSON, scrolls for long text; Copy value.
- [x] **Aggregate strip** under the grid: count + sum/avg/min/max per numeric column, over the selection (or the loaded page).
- [x] **Find in page**: client-side filter across the loaded rows.
- [ ] Multi-column sort (needs a backend `ORDER BY` list — `queryFragments.ts`, `TableQuery.sort`).
- [ ] Raw `WHERE` filter bar (needs `TableQuery.where` threaded through both clients + count query).
- [ ] Jump-to-page control; image / hex-blob value viewers.
- Touches: `media/tablePanel.js`, `media/tabulator-vscode.css` (done); `queryFragments.ts`, `types.ts`, `protocol.ts`, both clients (remaining).

## Stage 2 — Change values
- [ ] Type-aware inline editors (text / number / boolean / date / NULL).
- [ ] Changed-cell highlighting + sticky "N changes · Submit / Revert" bar.
- [ ] **DML preview** — show the exact SQL before commit.
- [ ] Add / duplicate / delete rows via toolbar + context menu + multi-select.
- [ ] Transaction-mode toggle (auto / manual commit).
- Touches: `tablePanelManager.ts` mutation handlers, client insert/update/delete, `keyStrategy.ts`.

## Stage 3 — Export
- [ ] Scope: selection / current page / whole table.
- [ ] Formats: CSV, TSV, JSON, SQL `INSERT`s, Markdown.
- [ ] Destinations: file (save dialog) + clipboard; "Copy as …" context actions.
- [ ] Options: headers, delimiter, NULL token, include DDL, encoding.
- Touches: new `src/export/*` extractors, `valueCodec.ts`, `protocol.ts`.

## Stage 4 — Run queries
- [ ] Command: **New SQL Console** → untitled `.sql` bound to a connection; status-bar connection picker.
- [ ] Run statement-under-cursor / selection / whole file (keybindings).
- [ ] `executeRaw` → multi-statement, multiple result sets in tabs; exec time, rows affected, inline errors.
- [ ] Results reuse ResultGrid.
- [ ] Query history (persist to `globalState`; search + re-run).
- Touches: new `src/sql/console.ts`, `extension.ts`, `package.json` (commands/keybindings/menus), ResultGrid.

## Stage 5 — Import
- [ ] CSV / TSV / JSON → existing table via a column-mapping UI with live preview.
- [ ] Header toggle, delimiter, type coercion, NULL handling, error policy.
- [ ] Optional: create table from file (infer columns).
- [ ] Batched insert in a transaction with progress.
- Touches: new `src/import/*`, clients (batch insert), webview mapping UI.

## Later — full DataGrip parity
PostgreSQL / MariaDB / MSSQL clients · context-aware autocomplete (`CompletionItemProvider`) · richer schema tree (indexes / FKs / procedures / functions / triggers / sequences / users) · DDL execution + visual table editor · FK navigation in grid · ER diagrams · EXPLAIN viewer · environment color-coding & safety guards · schema/data compare · AI NL→SQL · SSH tunnels.

## Verification
- **Unit:** extend `test/` for export extractors, raw-WHERE building, and `executeRaw` result shaping.
- **Manual:** launch the extension (F5), connect to a local MySQL and a SQLite file, then per stage run the workflow end-to-end — inspect a large table → edit + submit with DML preview → export CSV/JSON/SQL → run a multi-statement query → import a CSV.
- **Later:** docker-based integration tests for the clients.
