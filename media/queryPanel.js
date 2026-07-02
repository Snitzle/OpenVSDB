import { TabulatorFull as Tabulator } from 'tabulator-tables';
import '@vscode/codicons/dist/codicon.css';
import 'tabulator-tables/dist/css/tabulator.min.css';
import './tabulator-vscode.css';
import { getVsCodeApi } from './vscodeApi.js';

(() => {
  const vscode = getVsCodeApi();

  const state = {
    dialect: '',
    connectionName: '',
    running: false,
    grids: [],
  };

  let requestCounter = 0;

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="root queryRoot">
      <div class="toolbar">
        <div class="toolbarTitle">
          <h1 id="queryTitle">Query</h1>
          <div id="queryMeta" class="muted">Connecting…</div>
        </div>
        <div class="inlineButtons">
          <button id="btnRunQuery" class="hasIcon" disabled><i class="codicon codicon-play" aria-hidden="true"></i>Run</button>
        </div>
      </div>

      <textarea id="sqlInput" class="sqlEditor" spellcheck="false" placeholder="SELECT * FROM …"></textarea>
      <div class="queryHint">⌘/Ctrl+Enter runs the script — or just the selected text when there is a selection.</div>

      <div id="queryResults" class="queryResults"></div>

      <div id="statusBar" class="status"></div>
    </div>
  `;

  const elements = {
    queryTitle: document.getElementById('queryTitle'),
    queryMeta: document.getElementById('queryMeta'),
    btnRunQuery: document.getElementById('btnRunQuery'),
    sqlInput: document.getElementById('sqlInput'),
    queryResults: document.getElementById('queryResults'),
    statusBar: document.getElementById('statusBar'),
  };

  elements.btnRunQuery.addEventListener('click', () => runQuery());
  elements.sqlInput.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      runQuery();
    }
  });

  window.addEventListener('message', (event) => {
    handleEvent(event.data);
  });

  sendRequest('ready');

  function handleEvent(message) {
    switch (message.kind) {
      case 'queryConfig':
        state.dialect = message.dialect;
        state.connectionName = message.connectionName;
        elements.queryTitle.textContent = `Query · ${message.connectionName}`;
        elements.queryMeta.textContent = message.dialect.toUpperCase();
        elements.btnRunQuery.disabled = false;
        elements.sqlInput.focus();
        break;

      case 'queryResults':
        setRunning(false);
        renderResults(message.results);
        showStatus(
          `${message.results.length} statement${message.results.length === 1 ? '' : 's'} executed.`,
        );
        break;

      case 'info':
        showStatus(message.message);
        break;

      case 'error':
        setRunning(false);
        showStatus(message.message, true);
        if (message.details) {
          console.error(message.details);
        }
        break;

      default:
        break;
    }
  }

  function sendRequest(kind, payload = {}) {
    requestCounter += 1;
    const requestId = `r${Date.now()}_${requestCounter}`;
    vscode.postMessage({ kind, requestId, ...payload });
  }

  function runQuery() {
    if (state.running) {
      return;
    }

    const { selectionStart, selectionEnd, value } = elements.sqlInput;
    const sql = (selectionStart !== selectionEnd ? value.slice(selectionStart, selectionEnd) : value).trim();
    if (!sql) {
      showStatus('Nothing to run — the editor is empty.', true);
      return;
    }

    setRunning(true);
    showStatus('Running…');
    sendRequest('runQuery', { sql });
  }

  function setRunning(running) {
    state.running = running;
    elements.btnRunQuery.disabled = running || !state.connectionName;
  }

  function renderResults(results) {
    for (const grid of state.grids) {
      try {
        grid.destroy();
      } catch (error) {
        console.error(error);
      }
    }
    state.grids = [];
    elements.queryResults.innerHTML = '';

    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'No statements were executed.';
      elements.queryResults.appendChild(empty);
      return;
    }

    results.forEach((result, index) => {
      const section = document.createElement('section');
      section.className = 'resultSection';

      const meta = document.createElement('div');
      meta.className = 'resultMeta';

      if (result.columns.length > 0) {
        meta.textContent = `Statement ${index + 1} · ${result.rowCount} row${
          result.rowCount === 1 ? '' : 's'
        } · ${result.durationMs}ms`;

        const header = document.createElement('div');
        header.className = 'resultHeader';
        header.appendChild(meta);

        const exportBtn = document.createElement('button');
        exportBtn.className = 'iconBtn';
        exportBtn.title = 'Export this result';
        exportBtn.setAttribute('aria-label', 'Export this result');
        exportBtn.innerHTML = '<i class="codicon codicon-desktop-download" aria-hidden="true"></i>';
        exportBtn.addEventListener('click', () => {
          sendRequest('exportResults', { statementIndex: index });
        });
        header.appendChild(exportBtn);

        section.appendChild(header);

        const gridWrap = document.createElement('div');
        section.appendChild(gridWrap);
        elements.queryResults.appendChild(section);

        // Field keys are positional: column names may contain dots or repeat
        // (e.g. `count(*)`, joined tables), which Tabulator fields can't hold.
        const columns = result.columns.map((name, columnIndex) => ({
          title: name,
          titleFormatter: () => escapeHtml(name),
          field: `c${columnIndex}`,
          headerSort: true,
          minWidth: 80,
          formatter: nullableFormatter,
        }));
        const data = result.rows.map((row, rowIndex) => {
          const item = { _i: rowIndex };
          row.forEach((valueCell, columnIndex) => {
            item[`c${columnIndex}`] = valueCell;
          });
          return item;
        });

        const grid = new Tabulator(gridWrap, {
          data,
          columns,
          index: '_i',
          layout: 'fitDataStretch',
          maxHeight: 320,
          placeholder: 'No rows.',
          reactiveData: false,
          rowHeight: 28,
          selectableRows: false,
          columnDefaults: { resizable: true },
        });
        state.grids.push(grid);
      } else {
        const parts = [`Statement ${index + 1}`];
        parts.push(`${result.affectedRows ?? 0} row${(result.affectedRows ?? 0) === 1 ? '' : 's'} affected`);
        if (result.lastInsertId !== undefined && result.lastInsertId !== null && result.lastInsertId !== 0) {
          parts.push(`last insert id ${result.lastInsertId}`);
        }
        parts.push(`${result.durationMs}ms`);

        const summary = document.createElement('div');
        summary.className = 'resultSummary';
        summary.textContent = parts.join(' · ');
        section.appendChild(summary);
        elements.queryResults.appendChild(section);
      }
    });
  }

  function nullableFormatter(cell) {
    const value = cell.getValue();
    if (value === null || value === undefined) {
      return '<span class="dbx-null">NULL</span>';
    }
    return escapeHtml(String(value));
  }

  function showStatus(message, isError = false) {
    elements.statusBar.textContent = message;
    elements.statusBar.classList.toggle('error', isError);

    window.clearTimeout(showStatus._timeout);
    showStatus._timeout = window.setTimeout(() => {
      elements.statusBar.textContent = '';
      elements.statusBar.classList.remove('error');
    }, 5000);
  }

  function escapeHtml(value) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
})();
