// dsh-agents-md — browser half (client plugin module).
//
// Adds a "Agent docs" tab to the conversation view switcher
// (`conversation.view`, id `agents-md`). The tab lists every AGENTS.md /
// CLAUDE.md file DSH loads for the current Session — the user-global files
// under the DSH homes and the project-root-to-cwd chain — and edits them in
// place. It talks to the host half through same-origin JSON routes
// (`/__dsh-agents-md/*`).
//
// Client plugin entry: exports a Cordis plugin (`apply` + `inject`); the loader
// wrapper (`window.__ModuleLoader__.load`) resolves `react` through the module
// table and calls `apply` once the `slots` service is available.
window.__ModuleLoader__.load({
  id: 'dsh-agents-md',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    //#region
    const React = require('react');

    const NS = 'dsh-agents-md';
    const ROUTE_PREFIX = '/__dsh-agents-md/';

    const DICT_ZH = {
      'view.label': '智能体文档',
      title: '智能体文档',
      intro: 'AGENTS.md文件是AI在本会话里要遵守的规则，是项目的说明书。',
      subtitle: '编辑 DSH 与当前工作区实际加载的 AGENTS.md。保存后从下一条消息开始生效。',
      edit: '编辑',
      create: '创建',
      cancel: '取消',
      previewEmpty: '（空文件）',
      discardConfirm: '放弃未保存的修改？',
      save: '保存',
      saving: '保存中…',
      saved: '已保存，下一条消息生效。',
      reload: '重新读取',
      refresh: '刷新',
      loading: '加载中…',
      dirty: '未保存',
      conflict: '文件在磁盘上已被修改，请重新读取后再保存。',
      unsavedConfirm: '放弃未保存的修改并重新读取？',
      emptyDoc: '这个文件还不存在，保存后即创建。',
      empty: '没有找到任何指令文件。',
      missing: '尚未创建',
      budget: '指令预算',
      tabHint: '保存后下一条消息生效',
      'scope.dsh': '全局 DSH 目录',
      'scope.agents': '全局 Agents 目录',
      'scope.workspaceRoot': '工作区目录',
      'scope.workspace': '工作区子目录',
      size: '大小',
      modified: '修改时间',
      noSelection: '从左侧选择一个文件。',
      waitSession: '等待会话信息…',
      retry: '重试',
      listFail: '无法读取工作区信息',
      readFail: '读取失败',
      writeFail: '保存失败',
      tooLarge: '文件超过 1 MiB，无法在页面中编辑。',
      notAllowed: '该路径不允许编辑。',
      workspace: '当前工作区',
      openWorkspace: '在资源管理器中打开工作区目录',
      opened: '已在资源管理器中打开。',
      openFail: '打开工作区失败',
      needRestart: '这个操作要先重启 DSH 才会生效（新的 host 代码还没加载）。',
    };

    const DICT_EN = {
      'view.label': 'Agent docs',
      title: 'Agent docs',
      intro: 'AGENTS.md files are the rules the AI follows in this session, and the project manual.',
      subtitle: 'Edit the AGENTS.md files DSH loads for this workspace. Changes apply from your next message.',
      edit: 'Edit',
      create: 'Create',
      cancel: 'Cancel',
      previewEmpty: '(empty file)',
      discardConfirm: 'Discard unsaved changes?',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved. Applies from your next message.',
      reload: 'Reload',
      refresh: 'Refresh',
      loading: 'Loading…',
      dirty: 'Unsaved',
      conflict: 'The file changed on disk. Reload it before saving.',
      unsavedConfirm: 'Discard unsaved changes and reload?',
      emptyDoc: 'This file does not exist yet. Saving creates it.',
      empty: 'No instruction files found.',
      missing: 'Not created',
      budget: 'Instruction budget',
      tabHint: 'Applies from your next message',
      'scope.dsh': 'Global DSH dir',
      'scope.agents': 'Global Agents dir',
      'scope.workspaceRoot': 'Workspace dir',
      'scope.workspace': 'Workspace subdir',
      size: 'Size',
      modified: 'Modified',
      noSelection: 'Select a file on the left.',
      waitSession: 'Waiting for session…',
      retry: 'Retry',
      listFail: 'Could not read the workspace',
      readFail: 'Read failed',
      writeFail: 'Save failed',
      tooLarge: 'The file exceeds 1 MiB and cannot be edited here.',
      notAllowed: 'That path is not editable.',
      workspace: 'Workspace',
      openWorkspace: 'Open the workspace directory in the file manager',
      opened: 'Opened the workspace in the file manager.',
      openFail: 'Could not open the workspace',
      needRestart: 'This action needs a DSH restart before the new host code is loaded.',
    };

    /**
     * Pick the fallback dictionary language from the browser locale.
     * @returns {'zh' | 'en'} language code.
     */
    function preferredLanguage() {
      try {
        const language = String(window.navigator.language || '');
        return language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
      } catch (error) {
        return 'zh';
      }
    }

    /**
     * Translate with the bundled dictionaries (used before/without the host
     * locale service and as the tab-label fallback).
     * @param {string} key - message key.
     * @returns {string} localized text.
     */
    function fallbackTranslate(key) {
      const dictionary = preferredLanguage() === 'zh' ? DICT_ZH : DICT_EN;
      if (Object.prototype.hasOwnProperty.call(dictionary, key)) return dictionary[key];
      return key;
    }

    /**
     * Call one host route.
     * @param {string} action - `list`, `read`, or `write`.
     * @param {object} payload - JSON body.
     * @returns {Promise<object>} parsed `{ok:true,...}` payload.
     */
    async function callHost(action, payload) {
      let response = null;
      try {
        response = await fetch(ROUTE_PREFIX + action, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        const failure = new Error('network request failed');
        failure.code = 'NETWORK';
        throw failure;
      }
      let data = null;
      try {
        data = await response.json();
      } catch (error) {
        data = null;
      }
      if (data === null || typeof data !== 'object') {
        const failure = new Error('HTTP ' + String(response.status));
        failure.code = response.status === 404 || response.status === 405 ? 'ROUTE_MISSING' : 'HTTP';
        throw failure;
      }
      if (data.ok !== true) {
        const failure = new Error(typeof data.message === 'string' ? data.message : 'request failed');
        failure.code = typeof data.code === 'string' ? data.code : 'REQUEST';
        throw failure;
      }
      return data;
    }

    /**
     * Turn one failure into a user-facing message.
     * @param {unknown} error - thrown value.
     * @param {Function} tr - translate function.
     * @returns {string} message text.
     */
    function describeError(error, tr, fallbackKey) {
      const code = error && typeof error === 'object' ? error.code : undefined;
      if (code === 'CONFLICT') return tr('conflict');
      if (code === 'FILE_TOO_LARGE') return tr('tooLarge');
      if (code === 'PATH_NOT_ALLOWED') return tr('notAllowed');
      if (code === 'ROUTE_MISSING') return tr('needRestart');
      const detail = error instanceof Error && error.message !== '' ? error.message : String(error);
      return tr(typeof fallbackKey === 'string' ? fallbackKey : 'writeFail') + ' ' + detail;
    }

    /**
     * @param {number} bytes - byte count.
     * @returns {string} compact size text.
     */
    function formatBytes(bytes) {
      const value = typeof bytes === 'number' && Number.isFinite(bytes) ? bytes : 0;
      if (value < 1024) return String(value) + ' B';
      if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
      return (value / (1024 * 1024)).toFixed(1) + ' MB';
    }

    /**
     * @param {number | null} time - epoch milliseconds.
     * @returns {string} localized timestamp, or an empty string.
     */
    function formatTime(time) {
      if (typeof time !== 'number' || !Number.isFinite(time)) return '';
      try {
        return new Date(time).toLocaleString();
      } catch (error) {
        return '';
      }
    }

    /**
     * @param {string} text - editor text.
     * @returns {number} UTF-8 byte length.
     */
    function byteLength(text) {
      try {
        return new TextEncoder().encode(text).length;
      } catch (error) {
        return text.length;
      }
    }

    /**
     * Scope label for one file row.
     * @param {object} file - listed file.
     * @param {Function} tr - translate function.
     * @returns {string} label.
     */
    function scopeText(file, tr) {
      if (file.scope === 'dsh-home') return tr('scope.dsh');
      if (file.scope === 'agents-home') return tr('scope.agents');
      if (file.relativeDir === '' || file.relativeDir === '.') return tr('scope.workspaceRoot');
      return tr('scope.workspace') + ' · ' + String(file.relativeDir).split('/').join(' / ');
    }

    /**
     * Path shown under the scope label. Workspace files get the full absolute
     * path (the user asked for it); the user-global files keep the compact
     * `~/...` form the host already computes.
     * @param {object} file - listed file.
     * @returns {string} display path.
     */
    function displayPathOf(file) {
      if (file.scope === 'project') return file.path;
      return typeof file.displayPath === 'string' ? file.displayPath : file.path;
    }

    /**
     * Display order of the sidebar list: the workspace chain first (it is the
     * file users edit most, so it is pinned to the top), then the user-global
     * DSH home file, and the user-global agents home file last (rarely edited,
     * kept out of the way at the bottom). Within one rank the discovery order
     * is kept, because Array#sort is stable. This is presentation only — DSH
     * still injects the files in discovery order.
     * @type {Record<string, number>}
     */
    const SCOPE_ORDER = { project: 0, 'dsh-home': 1, 'agents-home': 2 };

    /**
     * Order listed instruction files for the sidebar.
     * @param {object[]} files - files as returned by the host `list` route.
     * @returns {object[]} a new array in display order.
     */
    function orderFiles(files) {
      const list = Array.isArray(files) ? files.slice() : [];
      const rankOf = (file) => (file !== null && typeof file === 'object' && Object.prototype.hasOwnProperty.call(SCOPE_ORDER, file.scope)
        ? SCOPE_ORDER[file.scope]
        : 1);
      // Array#sort is stable, so files sharing a rank keep the discovery order.
      list.sort((left, right) => rankOf(left) - rankOf(right));
      return list;
    }

    /**
     * Split one Markdown table row into trimmed cells.
     * @param {string} line - table row text.
     * @returns {string[]} cell texts.
     */
    function splitTableRow(line) {
      return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim());
    }

    /**
     * Column alignments from one Markdown table delimiter row.
     * @param {string} line - delimiter row such as `| :--- | ---: |`.
     * @returns {string[]} CSS text-align values.
     */
    function tableAlignments(line) {
      return splitTableRow(line).map((cell) => {
        const left = cell.charAt(0) === ':';
        const right = cell.charAt(cell.length - 1) === ':';
        if (left && right) return 'center';
        if (right) return 'right';
        return 'left';
      });
    }

    /**
     * Whether a line starts a new Markdown block, used to end a paragraph.
     * @param {string} line - next line.
     * @param {string} after - the line after it (table delimiter probe).
     * @returns {boolean} true when the line starts another block.
     */
    function startsMarkdownBlock(line, after) {
      if (/^\s*$/.test(line)) return true;
      if (/^\s*(```|~~~)/.test(line)) return true;
      if (/^\s{0,3}#{1,6}\s+/.test(line)) return true;
      if (/^\s{0,3}>\s?/.test(line)) return true;
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) return true;
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) return true;
      if (line.indexOf('|') !== -1 && after !== undefined && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(after)) return true;
      return false;
    }

    /**
     * Inline Markdown: code spans, bold, italics, strikethrough and links.
     * @param {string} text - inline Markdown text.
     * @param {string} keyPrefix - React key prefix.
     * @returns {Array<string | object>} inline nodes.
     */
    function inlineNodes(text, keyPrefix) {
      const nodes = [];
      const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*|\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)\s]+\))/g;
      let index = 0;
      let sequence = 0;
      let match = pattern.exec(text);
      while (match !== null) {
        if (match.index > index) nodes.push(text.slice(index, match.index));
        const token = match[0];
        const key = keyPrefix + '-' + String(sequence);
        sequence += 1;
        if (token.charAt(0) === '`') {
          nodes.push(React.createElement('code', { key, className: 'dam-inline-code' }, token.slice(1, -1)));
        } else if (token.slice(0, 2) === '**') {
          nodes.push(React.createElement('strong', { key }, token.slice(2, -2)));
        } else if (token.slice(0, 2) === '~~') {
          nodes.push(React.createElement('del', { key }, token.slice(2, -2)));
        } else if (token.charAt(0) === '*') {
          nodes.push(React.createElement('em', { key }, token.slice(1, -1)));
        } else {
          const split = token.indexOf('](');
          nodes.push(React.createElement('a', {
            key,
            href: token.slice(split + 2, -1),
            target: '_blank',
            rel: 'noreferrer noopener',
          }, token.slice(1, split)));
        }
        index = match.index + token.length;
        match = pattern.exec(text);
      }
      if (index < text.length) nodes.push(text.slice(index));
      return nodes;
    }

    /**
     * Render one instruction file as a React tree (headings, lists, code,
     * tables, quotes). No HTML is interpreted, so the preview is safe.
     * @param {string} text - Markdown source.
     * @returns {object[]} block elements.
     */
    function renderMarkdown(text) {
      const source = typeof text === 'string' ? text.replace(/\r\n?/g, '\n') : '';
      const lines = source.split('\n');
      const blocks = [];
      let index = 0;
      let key = 0;
      const nextKey = () => 'md-' + String(key++);
      while (index < lines.length) {
        const line = lines[index];
        if (/^\s*$/.test(line)) {
          index += 1;
          continue;
        }
        const fence = line.match(/^\s*(```|~~~)\s*([A-Za-z0-9_+.-]*)\s*$/);
        if (fence !== null) {
          const marker = fence[1];
          const code = [];
          index += 1;
          while (index < lines.length && lines[index].trim().indexOf(marker) !== 0) {
            code.push(lines[index]);
            index += 1;
          }
          if (index < lines.length) index += 1;
          blocks.push(React.createElement('pre', {
            key: nextKey(),
            className: 'dam-pre',
            'data-lang': fence[2],
          }, React.createElement('code', null, code.join('\n'))));
          continue;
        }
        const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
        if (heading !== null) {
          const level = heading[1].length;
          blocks.push(React.createElement('h' + String(level), {
            key: nextKey(),
            className: 'dam-md-h dam-md-h' + String(level),
          }, inlineNodes(heading[2].trim(), 'h' + String(level))));
          index += 1;
          continue;
        }
        if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
          blocks.push(React.createElement('hr', { key: nextKey(), className: 'dam-hr' }));
          index += 1;
          continue;
        }
        if (line.indexOf('|') !== -1 && index + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[index + 1])) {
          const header = splitTableRow(line);
          const alignments = tableAlignments(lines[index + 1]);
          const rows = [];
          index += 2;
          while (index < lines.length && lines[index].indexOf('|') !== -1 && !/^\s*$/.test(lines[index])) {
            rows.push(splitTableRow(lines[index]));
            index += 1;
          }
          blocks.push(React.createElement('table', { key: nextKey(), className: 'dam-table' },
            React.createElement('thead', null, React.createElement('tr', null, header.map((cell, cellIndex) => React.createElement('th', {
              key: 'th' + String(cellIndex),
              style: { textAlign: alignments[cellIndex] === undefined ? 'left' : alignments[cellIndex] },
            }, inlineNodes(cell, 'th' + String(cellIndex)))))),
            React.createElement('tbody', null, rows.map((row, rowIndex) => React.createElement('tr', { key: 'tr' + String(rowIndex) },
              row.map((cell, cellIndex) => React.createElement('td', {
                key: 'td' + String(cellIndex),
                style: { textAlign: alignments[cellIndex] === undefined ? 'left' : alignments[cellIndex] },
              }, inlineNodes(cell, 'td' + String(rowIndex) + '-' + String(cellIndex)))))))));
          continue;
        }
        if (/^\s{0,3}>\s?/.test(line)) {
          const quote = [];
          while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) {
            quote.push(lines[index].replace(/^\s{0,3}>\s?/, ''));
            index += 1;
          }
          blocks.push(React.createElement('blockquote', { key: nextKey(), className: 'dam-quote' }, inlineNodes(quote.join('\n'), 'q')));
          continue;
        }
        const itemMatch = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (itemMatch !== null) {
          const ordered = /^\s*\d+[.)]\s+/.test(line);
          const marker = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
          const items = [];
          while (index < lines.length) {
            const match = lines[index].match(marker);
            if (match === null) break;
            const itemLines = [match[1]];
            index += 1;
            while (index < lines.length && /^\s+\S/.test(lines[index]) && !marker.test(lines[index])) {
              itemLines.push(lines[index].trim());
              index += 1;
            }
            items.push(React.createElement('li', { key: 'li' + String(items.length) }, inlineNodes(itemLines.join(' '), 'li' + String(items.length))));
          }
          blocks.push(React.createElement(ordered ? 'ol' : 'ul', { key: nextKey(), className: 'dam-md-list' }, items));
          continue;
        }
        const paragraph = [line.trim()];
        index += 1;
        while (index < lines.length && !startsMarkdownBlock(lines[index], lines[index + 1])) {
          paragraph.push(lines[index].trim());
          index += 1;
        }
        blocks.push(React.createElement('p', { key: nextKey(), className: 'dam-p' }, inlineNodes(paragraph.join(' '), 'p')));
      }
      return blocks;
    }

    /**
     * The conversation view: file list, Markdown preview and editor.
     * @param {object} props - standard Session-scope slot kit plus owner props.
     * @returns {object} React element tree.
     */
    function AgentsMdView(props) {
      const sessionId = props.sessionId;
      const tr = typeof props.t === 'function' ? props.t : fallbackTranslate;
      const useSessions = props.useSessions;
      const cwd = typeof useSessions === 'function'
        ? useSessions((snapshot) => (snapshot.byId[sessionId] === undefined ? undefined : snapshot.byId[sessionId].cwd))
        : undefined;

      const trRef = React.useRef(tr);
      trRef.current = tr;

      const [files, setFiles] = React.useState([]);
      const [budget, setBudget] = React.useState(65536);
      const [totalBytes, setTotalBytes] = React.useState(0);
      const [selectedPath, setSelectedPath] = React.useState(null);
      const [doc, setDoc] = React.useState(null);
      const [listState, setListState] = React.useState('idle');
      const [docState, setDocState] = React.useState('idle');
      const [saving, setSaving] = React.useState(false);
      const [notice, setNotice] = React.useState(null);
      const [openNotice, setOpenNotice] = React.useState(null);
      const [reloadToken, setReloadToken] = React.useState(0);
      const [mode, setMode] = React.useState('preview');

      const loadList = React.useCallback(async () => {
        if (cwd === undefined || cwd === null || cwd === '') return;
        setListState('loading');
        try {
          const result = await callHost('list', { cwd });
          const nextFiles = orderFiles(Array.isArray(result.files) ? result.files : []);
          setFiles(nextFiles);
          setBudget(typeof result.budget === 'number' ? result.budget : 65536);
          setTotalBytes(typeof result.totalBytes === 'number' ? result.totalBytes : 0);
          setListState('ready');
          setSelectedPath((current) => {
            if (current !== null && nextFiles.some((file) => file.path === current)) return current;
            return nextFiles.length > 0 ? nextFiles[0].path : null;
          });
        } catch (error) {
          setListState('error');
          setNotice({ kind: 'error', text: trRef.current('listFail') + ' ' + describeError(error, trRef.current) });
        }
      }, [cwd]);

      React.useEffect(() => {
        setSelectedPath(null);
        setDoc(null);
        setDocState('idle');
        setNotice(null);
        void loadList();
      }, [loadList]);

      React.useEffect(() => {
        if (selectedPath === null || cwd === undefined) return undefined;
        let cancelled = false;
        setDocState('loading');
        setMode('preview');
        callHost('read', { cwd, path: selectedPath }).then((result) => {
          if (cancelled) return;
          const content = typeof result.content === 'string' ? result.content : '';
          setDoc({
            path: result.path,
            exists: result.exists === true,
            content,
            base: content,
            version: result.version === undefined ? null : result.version,
            size: typeof result.size === 'number' ? result.size : 0,
            mtimeMs: typeof result.mtimeMs === 'number' ? result.mtimeMs : null,
            dirty: false,
          });
          setDocState('ready');
        }, (error) => {
          if (cancelled) return;
          setDocState('error');
          setNotice({ kind: 'error', text: trRef.current('readFail') + ' ' + describeError(error, trRef.current) });
        });
        return () => {
          cancelled = true;
        };
      }, [selectedPath, cwd, reloadToken]);

      const save = React.useCallback(async () => {
        if (doc === null || cwd === undefined || saving || !doc.dirty || mode !== 'edit') return;
        setSaving(true);
        setNotice(null);
        try {
          const result = await callHost('write', { cwd, path: doc.path, content: doc.content, version: doc.version });
          setDoc((current) => (current === null || current.path !== doc.path ? current : Object.assign({}, current, {
            exists: true,
            base: current.content,
            version: result.version,
            size: result.size,
            mtimeMs: result.mtimeMs,
            dirty: false,
          })));
          setMode('preview');
          setNotice({ kind: 'ok', text: trRef.current('saved') });
          void loadList();
        } catch (error) {
          if (error && error.code === 'CONFLICT') {
            setNotice({ kind: 'warn', text: trRef.current('conflict') });
          } else {
            setNotice({ kind: 'error', text: describeError(error, trRef.current) });
          }
        } finally {
          setSaving(false);
        }
      }, [doc, cwd, saving, loadList, mode]);

      const reload = React.useCallback(() => {
        if (doc !== null && doc.dirty && typeof window.confirm === 'function' && !window.confirm(trRef.current('unsavedConfirm'))) return;
        setNotice(null);
        setReloadToken((value) => value + 1);
      }, [doc]);

      const openWorkspace = React.useCallback(async () => {
        if (cwd === undefined || cwd === null || cwd === '') return;
        setOpenNotice(null);
        try {
          await callHost('open', { cwd });
          setOpenNotice({ kind: 'ok', text: trRef.current('opened') });
        } catch (error) {
          setOpenNotice({ kind: 'error', text: describeError(error, trRef.current, 'openFail') });
        }
      }, [cwd]);

      const startEdit = React.useCallback(() => {
        if (doc === null) return;
        setNotice(null);
        setMode('edit');
      }, [doc]);

      const cancelEdit = React.useCallback(() => {
        if (doc === null) return;
        if (doc.dirty && typeof window.confirm === 'function' && !window.confirm(trRef.current('discardConfirm'))) return;
        setDoc((current) => (current === null ? current : Object.assign({}, current, {
          content: typeof current.base === 'string' ? current.base : current.content,
          dirty: false,
        })));
        setNotice(null);
        setMode('preview');
      }, [doc]);

      /**
       * @param {string} path - file path to select.
       */
      const selectFile = (path) => {
        if (path === selectedPath) return;
        if (doc !== null && doc.dirty && typeof window.confirm === 'function' && !window.confirm(trRef.current('discardConfirm'))) return;
        setNotice(null);
        setSelectedPath(path);
      };

      /**
       * @param {object} event - React change event.
       */
      const handleChange = (event) => {
        const value = event.target.value;
        setDoc((current) => (current === null ? current : Object.assign({}, current, {
          content: value,
          dirty: value !== (typeof current.base === 'string' ? current.base : current.content),
        })));
      };

      /**
       * @param {object} event - React keyboard event.
       */
      const handleKeyDown = (event) => {
        if ((event.ctrlKey || event.metaKey) && (event.key === 's' || event.key === 'S')) {
          event.preventDefault();
          void save();
          return;
        }
        if (event.key === 'Tab' && !event.shiftKey && doc !== null) {
          event.preventDefault();
          const target = event.target;
          const start = typeof target.selectionStart === 'number' ? target.selectionStart : doc.content.length;
          const end = typeof target.selectionEnd === 'number' ? target.selectionEnd : start;
          const next = doc.content.slice(0, start) + '  ' + doc.content.slice(end);
          setDoc((current) => (current === null ? current : Object.assign({}, current, { content: next, dirty: true })));
          if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => {
              try {
                target.selectionStart = start + 2;
                target.selectionEnd = start + 2;
              } catch (error) { /* detached editor */ }
            });
          }
        }
      };

      const selected = selectedPath === null ? null : files.find((file) => file.path === selectedPath) || null;
      const children = [];

      children.push(React.createElement('div', { className: 'dam-head', key: 'head' },
        React.createElement('div', { className: 'dam-headtext' },
          React.createElement('h2', { className: 'dam-title' }, tr('title')),
          React.createElement('p', { className: 'dam-intro' }, tr('intro')),
          React.createElement('p', { className: 'dam-sub' }, tr('subtitle')),
          cwd === undefined || cwd === null || cwd === ''
            ? null
            : React.createElement('div', { className: 'dam-workspace-row' },
              React.createElement('button', {
                type: 'button',
                className: 'dam-workspace',
                title: tr('openWorkspace'),
                onClick: () => { void openWorkspace(); },
                'data-testid': 'dsh-agents-md-workspace',
              },
              React.createElement('span', { className: 'dam-workspace-label' }, tr('workspace')),
              React.createElement('span', { className: 'dam-workspace-path' }, cwd)),
              openNotice === null
                ? null
                : React.createElement('span', {
                  className: 'dam-notice dam-notice-inline',
                  'data-kind': openNotice.kind,
                  'data-testid': 'dsh-agents-md-open-notice',
                }, React.createElement('span', { className: 'dam-notice-text' }, openNotice.text)))),
        React.createElement('div', { className: 'dam-headactions' },
          React.createElement('span', {
            className: 'dam-budget',
            'data-over': totalBytes > budget ? 'true' : 'false',
            title: tr('budget'),
          }, tr('budget') + ' ' + formatBytes(totalBytes) + ' / ' + formatBytes(budget)),
          React.createElement('button', {
            type: 'button',
            className: 'dam-btn',
            onClick: () => { void loadList(); },
            disabled: listState === 'loading',
          }, listState === 'loading' ? tr('loading') : tr('refresh')))));

      const listChildren = files.length === 0
        ? [React.createElement('p', { className: 'dam-empty', key: 'empty' }, listState === 'loading' ? tr('loading') : tr('empty'))]
        : files.map((file) => React.createElement('button', {
          key: file.path,
          type: 'button',
          className: 'dam-file',
          'data-active': file.path === selectedPath ? 'true' : 'false',
          title: file.path,
          onClick: () => { selectFile(file.path); },
        },
        React.createElement('span', { className: 'dam-file-top' },
          React.createElement('span', { className: 'dam-file-name' }, scopeText(file, tr)),
          file.exists ? null : React.createElement('span', { className: 'dam-badge' }, tr('missing'))),
        React.createElement('span', { className: 'dam-file-path', title: file.path }, displayPathOf(file)),
        React.createElement('span', { className: 'dam-file-meta' }, file.fileName + ' · ' + formatBytes(file.size))));

      const editorChildren = [];
      if (cwd === undefined || cwd === null || cwd === '') {
        editorChildren.push(React.createElement('p', { className: 'dam-empty', key: 'wait' }, tr('waitSession')));
      } else if (listState === 'error' && files.length === 0) {
        editorChildren.push(React.createElement('div', { className: 'dam-empty', key: 'error' },
          React.createElement('p', null, notice !== null && notice.kind === 'error' ? notice.text : tr('listFail')),
          React.createElement('button', { type: 'button', className: 'dam-btn', onClick: () => { void loadList(); } }, tr('retry'))));
      } else if (selectedPath === null) {
        editorChildren.push(React.createElement('p', { className: 'dam-empty', key: 'none' }, tr('noSelection')));
      } else if (docState === 'loading' || doc === null) {
        editorChildren.push(React.createElement('p', { className: 'dam-empty', key: 'loading' }, tr('loading')));
      } else {
        // The location label is the title; the file name lives in the path line.
        const heading = selected === null ? doc.path.split('/').pop() : scopeText(selected, tr);
        const displayPath = selected === null ? doc.path : displayPathOf(selected);
        // Edit mode measures the textarea content, so the number follows the typing.
        const sizeText = formatBytes(mode === 'edit' ? byteLength(doc.content) : doc.size);
        editorChildren.push(React.createElement('div', { className: 'dam-filehead', key: 'filehead' },
          React.createElement('div', { className: 'dam-filehead-main' },
            React.createElement('div', { className: 'dam-filehead-title' },
              React.createElement('span', { className: 'dam-filename' }, heading)),
            React.createElement('div', { className: 'dam-filehead-meta' },
              React.createElement('span', { className: 'dam-filepath', title: doc.path }, displayPath),
              React.createElement('span', { className: 'dam-docsize' }, tr('size') + ' ' + sizeText))),
          React.createElement('div', { className: 'dam-filehead-actions' },
            mode === 'edit'
              ? [
                doc.dirty ? React.createElement('span', { className: 'dam-dirty', key: 'dirty' }, tr('dirty')) : null,
                React.createElement('button', {
                  key: 'cancel',
                  type: 'button',
                  className: 'dam-btn dam-btn-ghost',
                  onClick: cancelEdit,
                  disabled: saving,
                  'data-testid': 'dsh-agents-md-cancel',
                }, tr('cancel')),
                React.createElement('button', {
                  key: 'save',
                  type: 'button',
                  className: 'dam-btn dam-btn-primary',
                  onClick: () => { void save(); },
                  disabled: !doc.dirty || saving,
                  'data-testid': 'dsh-agents-md-save',
                }, saving ? tr('saving') : tr('save')),
              ]
              : [
                React.createElement('button', {
                  key: 'reload',
                  type: 'button',
                  className: 'dam-btn dam-btn-ghost',
                  onClick: reload,
                  disabled: saving,
                }, tr('reload')),
                React.createElement('button', {
                  key: 'edit',
                  type: 'button',
                  className: 'dam-btn dam-btn-primary',
                  onClick: startEdit,
                  disabled: saving,
                  'data-testid': 'dsh-agents-md-edit',
                }, doc.exists ? tr('edit') : tr('create')),
              ])));

        if (notice !== null) {
          editorChildren.push(React.createElement('div', { className: 'dam-notice', 'data-kind': notice.kind, key: 'notice' },
            React.createElement('span', { className: 'dam-notice-text' }, notice.text),
            notice.kind === 'warn' ? React.createElement('button', {
              type: 'button',
              className: 'dam-link',
              onClick: reload,
            }, tr('reload')) : null));
        }

        editorChildren.push(mode === 'edit'
          ? React.createElement('textarea', {
            key: 'editor',
            className: 'dam-textarea',
            value: doc.content,
            spellCheck: false,
            placeholder: doc.exists ? '' : tr('emptyDoc'),
            onChange: handleChange,
            onKeyDown: handleKeyDown,
            'aria-label': tr('title'),
            'data-testid': 'dsh-agents-md-editor',
          })
          : React.createElement('div', {
            key: 'preview',
            className: 'dam-preview',
            'data-testid': 'dsh-agents-md-preview',
          }, doc.content.trim() === ''
            ? [React.createElement('p', { className: 'dam-empty', key: 'emptyPreview' }, tr('previewEmpty'))]
            : renderMarkdown(doc.content)));

        editorChildren.push(React.createElement('div', { className: 'dam-footer', key: 'footer' },
          React.createElement('span', null, tr('size') + ' ' + formatBytes(byteLength(doc.content))),
          doc.exists
            ? React.createElement('span', null, tr('modified') + ' ' + formatTime(doc.mtimeMs))
            : React.createElement('span', { className: 'dam-missing' }, tr('missing')),
          React.createElement('span', { className: 'dam-hint' }, tr('tabHint'))));
      }

      children.push(React.createElement('div', { className: 'dam-body', key: 'body' },
        React.createElement('nav', { className: 'dam-list', 'aria-label': tr('title') }, listChildren),
        React.createElement('section', { className: 'dam-editor' }, editorChildren)));

      return React.createElement('div', {
        className: 'dam-root',
        'data-testid': 'dsh-agents-md',
        'data-cwd': cwd === undefined ? '' : String(cwd),
      }, children);
    }

    const CSS = [
      '.dam-root{--dam-border:var(--dsw-alias-border-l3,#e3e5e8);--dam-hover:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.045));--dam-active:var(--dsw-alias-bg-module,rgba(77,107,254,.09));--dam-primary:var(--dsw-alias-state-business-primary,#4d6bfe);box-sizing:border-box;display:flex;flex-direction:column;gap:12px;width:100%;height:100%;min-height:360px;padding:18px 24px 20px;color:var(--dsw-alias-label-primary,#1f2329);font-size:13px}',
      '.dam-head{display:flex;align-items:flex-start;gap:16px;flex:none}',
      '.dam-headtext{min-width:0}',
      '.dam-title{margin:0;font-size:16px;font-weight:600;line-height:24px}',
      '.dam-intro{margin:6px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#5a6169)}',
      '.dam-sub{margin:2px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#5a6169)}',
      '.dam-workspace-row{display:flex;align-items:center;gap:8px;margin-top:7px;min-width:0}',
      '.dam-workspace{display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border:1px solid var(--dam-border);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,#5a6169);cursor:pointer;font:inherit;max-width:100%;min-width:0}',
      '.dam-workspace:hover{background:var(--dam-hover);border-color:var(--dam-primary)}',
      '.dam-workspace:hover .dam-workspace-path{text-decoration:underline}',
      '.dam-workspace-label{flex:none;font-size:13px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2329)}',
      '.dam-workspace-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 12px/18px var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);color:var(--dsw-alias-state-business-primary,#4d6bfe)}',
      '.dam-headactions{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none}',
      '.dam-budget{font-size:12px;color:var(--dsw-alias-label-tertiary,#8a9099);white-space:nowrap}',
      '.dam-budget[data-over=true]{color:var(--dsw-alias-state-warning-primary,#d97706);font-weight:500}',
      '.dam-btn{appearance:none;border:1px solid var(--dam-border);background:var(--dsw-alias-bg-base,#fff);color:inherit;border-radius:8px;padding:5px 12px;font-size:13px;line-height:18px;cursor:pointer;white-space:nowrap}',
      '.dam-btn:hover:not(:disabled){background:var(--dam-hover)}',
      '.dam-btn:disabled{opacity:.5;cursor:default}',
      '.dam-btn-primary{border-color:transparent;background:var(--dam-primary);color:#fff}',
      '.dam-btn-primary:hover:not(:disabled){background:var(--dam-primary);filter:brightness(.94)}',
      '.dam-btn-ghost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary,#5a6169)}',
      '.dam-body{display:flex;flex:1 1 auto;gap:14px;min-height:0;overflow:hidden}',
      '.dam-list{width:250px;flex:none;display:flex;flex-direction:column;gap:2px;overflow:auto;padding:2px 10px 2px 2px;border-right:1px solid var(--dam-border)}',
      '.dam-file{display:flex;flex-direction:column;gap:2px;text-align:left;border:none;background:transparent;border-radius:8px;padding:7px 9px;cursor:pointer;color:inherit;font:inherit}',
      '.dam-file:hover{background:var(--dam-hover)}',
      '.dam-file[data-active=true]{background:var(--dam-active)}',
      '.dam-file-top{display:flex;align-items:center;gap:6px;min-width:0}',
      '.dam-file-name{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dam-badge{flex:none;font-size:11px;line-height:16px;padding:0 6px;border-radius:6px;background:var(--dsw-alias-bg-secondary,#f2f3f5);color:var(--dsw-alias-label-tertiary,#8a9099)}',
      '.dam-file-path{font-size:11px;color:var(--dsw-alias-label-caption,#a0a6ad);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dam-file-meta{font-size:11px;color:var(--dsw-alias-label-caption,#a0a6ad);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dam-editor{display:flex;flex:1 1 auto;flex-direction:column;gap:10px;min-width:0;min-height:0}',
      '.dam-filehead{display:flex;align-items:flex-start;gap:12px;flex:none;min-height:0}',
      '.dam-filehead-main{min-width:0}',
      '.dam-filehead-title{display:flex;align-items:center;gap:8px;min-width:0}',
      '.dam-filename{font-size:14px;font-weight:600;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dam-filehead-meta{display:flex;align-items:center;gap:8px;min-width:0}',
      '.dam-docsize{flex:none;white-space:nowrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8a9099)}',
      '.dam-filepath{min-width:0;font:500 12px/18px var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);color:var(--dsw-alias-label-secondary,#5a6169);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dam-filehead-actions{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none}',
      '.dam-dirty{font-size:11px;color:var(--dsw-alias-state-warning-primary,#d97706)}',
      '.dam-notice{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px;font-size:12px;line-height:18px;flex:none}',
      '.dam-notice[data-kind=ok]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary,#16a34a) 10%, transparent);color:var(--dsw-alias-state-success-primary,#15803d)}',
      '.dam-notice[data-kind=warn]{background:color-mix(in srgb, var(--dsw-alias-state-warning-primary,#d97706) 12%, transparent);color:var(--dsw-alias-state-warning-primary,#b45309)}',
      '.dam-notice[data-kind=error]{background:color-mix(in srgb, var(--dsw-alias-state-error-primary,#dc2626) 10%, transparent);color:var(--dsw-alias-state-error-primary,#b91c1c)}',
      '.dam-notice-text{min-width:0;overflow-wrap:anywhere}',
      '.dam-notice-inline{padding:2px 8px;border-radius:6px;font-size:11px;line-height:16px;flex:none;max-width:60%}',
      '.dam-notice-inline .dam-notice-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dam-link{appearance:none;border:none;background:transparent;padding:0;font:inherit;color:inherit;cursor:pointer;text-decoration:underline;flex:none}',
      '.dam-textarea{flex:1 1 auto;width:100%;box-sizing:border-box;min-height:min(52vh,520px);resize:none;padding:14px 16px;border-radius:10px;border:1px solid var(--dam-border);background:var(--dsw-alias-bg-base,#fff);color:inherit;font:13px/1.65 var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);outline:none;tab-size:2}',
      '.dam-textarea:focus{border-color:var(--dam-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dam-primary) 16%, transparent)}',
      '.dam-textarea::placeholder{color:var(--dsw-alias-label-caption,#a0a6ad)}',
      '.dam-preview{flex:1 1 auto;min-height:min(52vh,520px);overflow:auto;box-sizing:border-box;padding:16px 20px;border-radius:10px;border:1px solid var(--dam-border);background:var(--dsw-alias-bg-base,#fff);font:13px/1.7 var(--ds-font-family-base,inherit);color:inherit;overflow-wrap:anywhere}',
      '.dam-preview>:first-child{margin-top:0}',
      '.dam-preview>:last-child{margin-bottom:0}',
      '.dam-md-h{margin:18px 0 8px;font-weight:600;line-height:1.35}',
      '.dam-md-h1{font-size:20px}',
      '.dam-md-h2{font-size:17px}',
      '.dam-md-h3{font-size:15px}',
      '.dam-md-h4,.dam-md-h5,.dam-md-h6{font-size:13px}',
      '.dam-p{margin:8px 0}',
      '.dam-md-list{margin:8px 0;padding-left:22px}',
      '.dam-md-list li{margin:3px 0}',
      '.dam-pre{margin:10px 0;padding:12px 14px;border-radius:8px;background:var(--dsw-alias-bg-secondary,#f6f7f8);border:1px solid var(--dam-border);overflow:auto;font:12px/1.6 var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);white-space:pre}',
      '.dam-inline-code{padding:1px 5px;border-radius:5px;background:var(--dsw-alias-bg-secondary,#f2f3f5);font:12px/1.5 var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace)}',
      '.dam-quote{margin:10px 0;padding:4px 0 4px 12px;border-left:3px solid var(--dam-border);color:var(--dsw-alias-label-secondary,#5a6169);white-space:pre-wrap}',
      '.dam-table{width:100%;border-collapse:collapse;margin:10px 0;font-size:12px}',
      '.dam-table th,.dam-table td{border:1px solid var(--dam-border);padding:6px 9px;vertical-align:top}',
      '.dam-table th{background:var(--dsw-alias-bg-secondary,#f6f7f8);font-weight:600}',
      '.dam-hr{margin:14px 0;border:none;border-top:1px solid var(--dam-border)}',
      '.dam-preview a{color:var(--dam-primary);text-decoration:underline}',
      '.dam-footer{display:flex;align-items:center;gap:14px;flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption,#a0a6ad)}',
      '.dam-hint{margin-left:auto}',
      '.dam-missing{color:var(--dsw-alias-state-warning-primary,#b45309)}',
      '.dam-empty{margin:12px 2px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary,#8a9099)}',
      '@media (max-width:720px){.dam-root{padding:14px}.dam-body{flex-direction:column}.dam-list{width:auto;max-height:190px;border-right:none;border-bottom:1px solid var(--dam-border);padding:2px 2px 10px}}',
    ].join('');

    /**
     * Register the view.
     * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => {
        const styleEl = document.createElement('style');
        styleEl.setAttribute('data-dsh-agents-md', '1');
        styleEl.textContent = CSS;
        document.head.appendChild(styleEl);
        return () => {
          if (styleEl.parentNode !== null) styleEl.parentNode.removeChild(styleEl);
        };
      }, 'dsh-agents-md: styles');

      let translate = fallbackTranslate;
      const locale = ctx.get('locale');
      if (locale !== undefined && typeof locale.register === 'function' && typeof locale.bind === 'function') {
        ctx.effect(() => locale.register(NS, { zh: DICT_ZH, en: DICT_EN }), 'dsh-agents-md: dictionaries');
        translate = locale.bind(NS);
      }

      const slots = ctx.get('slots');
      if (slots === undefined) return;

      ctx.effect(() => {
        const dispose = slots.inject('conversation.view', () => slots.register({
          name: 'conversation.view',
          id: 'agents-md',
          order: 20,
          locale: NS,
          label: () => translate('view.label'),
        }, AgentsMdView));
        return () => {
          if (typeof dispose === 'function') dispose();
        };
      }, 'dsh-agents-md: conversation view');
    }

    module.exports = {
      apply,
      inject: ['slots', 'locale'],
      __messages: { zh: DICT_ZH, en: DICT_EN },
      __test: { renderMarkdown, inlineNodes, orderFiles, scopeText, displayPathOf },
    };
    //#endregion
    return module.exports;
  },
});
