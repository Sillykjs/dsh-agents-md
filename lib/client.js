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
      subtitle: '编辑 DSH 与当前工作区实际加载的 AGENTS.md。保存后从下一条消息开始生效。',
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
      'scope.dsh': '用户全局 · DSH 家目录',
      'scope.agents': '用户全局 · Agents 家目录',
      'scope.workspaceRoot': '工作区根',
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
    };

    const DICT_EN = {
      'view.label': 'Agent docs',
      title: 'Agent docs',
      subtitle: 'Edit the AGENTS.md files DSH loads for this workspace. Changes apply from your next message.',
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
      'scope.dsh': 'User-global · DSH home',
      'scope.agents': 'User-global · Agents home',
      'scope.workspaceRoot': 'Workspace root',
      'scope.workspace': 'Workspace subdirectory',
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
        failure.code = 'HTTP';
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
    function describeError(error, tr) {
      const code = error && typeof error === 'object' ? error.code : undefined;
      if (code === 'CONFLICT') return tr('conflict');
      if (code === 'FILE_TOO_LARGE') return tr('tooLarge');
      if (code === 'PATH_NOT_ALLOWED') return tr('notAllowed');
      const detail = error instanceof Error && error.message !== '' ? error.message : String(error);
      return tr('writeFail') + ' ' + detail;
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
     * The conversation view: file list plus editor.
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
      const [reloadToken, setReloadToken] = React.useState(0);

      const loadList = React.useCallback(async () => {
        if (cwd === undefined || cwd === null || cwd === '') return;
        setListState('loading');
        try {
          const result = await callHost('list', { cwd });
          const nextFiles = Array.isArray(result.files) ? result.files : [];
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
        callHost('read', { cwd, path: selectedPath }).then((result) => {
          if (cancelled) return;
          setDoc({
            path: result.path,
            exists: result.exists === true,
            content: typeof result.content === 'string' ? result.content : '',
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
        if (doc === null || cwd === undefined || saving || !doc.dirty) return;
        setSaving(true);
        setNotice(null);
        try {
          const result = await callHost('write', { cwd, path: doc.path, content: doc.content, version: doc.version });
          setDoc((current) => (current === null || current.path !== doc.path ? current : Object.assign({}, current, {
            exists: true,
            version: result.version,
            size: result.size,
            mtimeMs: result.mtimeMs,
            dirty: false,
          })));
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
      }, [doc, cwd, saving, loadList]);

      const reload = React.useCallback(() => {
        if (doc !== null && doc.dirty && typeof window.confirm === 'function' && !window.confirm(trRef.current('unsavedConfirm'))) return;
        setNotice(null);
        setReloadToken((value) => value + 1);
      }, [doc]);

      /**
       * @param {object} event - React change event.
       */
      const handleChange = (event) => {
        const value = event.target.value;
        setDoc((current) => (current === null ? current : Object.assign({}, current, { content: value, dirty: true })));
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
          React.createElement('p', { className: 'dam-sub' }, tr('subtitle'))),
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
          onClick: () => { setSelectedPath(file.path); },
        },
        React.createElement('span', { className: 'dam-file-top' },
          React.createElement('span', { className: 'dam-file-name' }, file.fileName),
          file.exists ? null : React.createElement('span', { className: 'dam-badge' }, tr('missing'))),
        React.createElement('span', { className: 'dam-file-path' }, file.displayPath),
        React.createElement('span', { className: 'dam-file-meta' }, scopeText(file, tr) + ' · ' + formatBytes(file.size))));

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
        const name = selected === null ? doc.path.split('/').pop() : selected.fileName;
        const displayPath = selected === null ? doc.path : selected.displayPath;
        const scopeLabel = selected === null ? '' : scopeText(selected, tr);
        editorChildren.push(React.createElement('div', { className: 'dam-filehead', key: 'filehead' },
          React.createElement('div', { className: 'dam-filehead-main' },
            React.createElement('div', { className: 'dam-filehead-title' },
              React.createElement('span', { className: 'dam-filename' }, name),
              scopeLabel === '' ? null : React.createElement('span', { className: 'dam-chip' }, scopeLabel)),
            React.createElement('div', { className: 'dam-filepath', title: doc.path }, displayPath)),
          React.createElement('div', { className: 'dam-filehead-actions' },
            doc.dirty ? React.createElement('span', { className: 'dam-dirty' }, tr('dirty')) : null,
            React.createElement('button', {
              type: 'button',
              className: 'dam-btn dam-btn-ghost',
              onClick: reload,
              disabled: saving,
            }, tr('reload')),
            React.createElement('button', {
              type: 'button',
              className: 'dam-btn dam-btn-primary',
              onClick: () => { void save(); },
              disabled: !doc.dirty || saving,
              'data-testid': 'dsh-agents-md-save',
            }, saving ? tr('saving') : tr('save')))));

        if (notice !== null) {
          editorChildren.push(React.createElement('div', { className: 'dam-notice', 'data-kind': notice.kind, key: 'notice' },
            React.createElement('span', { className: 'dam-notice-text' }, notice.text),
            notice.kind === 'warn' ? React.createElement('button', {
              type: 'button',
              className: 'dam-link',
              onClick: reload,
            }, tr('reload')) : null));
        }

        editorChildren.push(React.createElement('textarea', {
          key: 'editor',
          className: 'dam-textarea',
          value: doc.content,
          spellCheck: false,
          placeholder: doc.exists ? '' : tr('emptyDoc'),
          onChange: handleChange,
          onKeyDown: handleKeyDown,
          'aria-label': tr('title'),
          'data-testid': 'dsh-agents-md-editor',
        }));

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
      '.dam-sub{margin:2px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8a9099)}',
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
      '.dam-chip{flex:none;font-size:11px;line-height:16px;padding:0 6px;border-radius:6px;background:var(--dsw-alias-bg-secondary,#f2f3f5);color:var(--dsw-alias-label-tertiary,#8a9099)}',
      '.dam-filepath{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption,#a0a6ad);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dam-filehead-actions{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none}',
      '.dam-dirty{font-size:11px;color:var(--dsw-alias-state-warning-primary,#d97706)}',
      '.dam-notice{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px;font-size:12px;line-height:18px;flex:none}',
      '.dam-notice[data-kind=ok]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary,#16a34a) 10%, transparent);color:var(--dsw-alias-state-success-primary,#15803d)}',
      '.dam-notice[data-kind=warn]{background:color-mix(in srgb, var(--dsw-alias-state-warning-primary,#d97706) 12%, transparent);color:var(--dsw-alias-state-warning-primary,#b45309)}',
      '.dam-notice[data-kind=error]{background:color-mix(in srgb, var(--dsw-alias-state-error-primary,#dc2626) 10%, transparent);color:var(--dsw-alias-state-error-primary,#b91c1c)}',
      '.dam-notice-text{min-width:0;overflow-wrap:anywhere}',
      '.dam-link{appearance:none;border:none;background:transparent;padding:0;font:inherit;color:inherit;cursor:pointer;text-decoration:underline;flex:none}',
      '.dam-textarea{flex:1 1 auto;width:100%;box-sizing:border-box;min-height:min(52vh,520px);resize:none;padding:14px 16px;border-radius:10px;border:1px solid var(--dam-border);background:var(--dsw-alias-bg-base,#fff);color:inherit;font:13px/1.65 var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);outline:none;tab-size:2}',
      '.dam-textarea:focus{border-color:var(--dam-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dam-primary) 16%, transparent)}',
      '.dam-textarea::placeholder{color:var(--dsw-alias-label-caption,#a0a6ad)}',
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
    };
    //#endregion
    return module.exports;
  },
});
