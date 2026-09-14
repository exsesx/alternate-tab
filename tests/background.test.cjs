const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const source = readFileSync(new URL('../background.js', pathToFileURL(__filename)), 'utf8');
const entry = (tabId, windowId = 1) => ({ tabId, windowId, windowType: 'normal' });

function browser({ history = [entry(2), entry(1)], localHistory = history, tabs, windows } = {}) {
  const listeners = {};
  const event = name => ({ addListener(fn) { listeners[name] = fn; } });
  const tabMap = new Map((tabs || [
    { id: 1, windowId: 1, active: false, lastAccessed: 10 },
    { id: 2, windowId: 1, active: true, lastAccessed: 20 },
  ]).map(tab => [tab.id, { ...tab }]));
  const windowMap = new Map((windows || [{ id: 1, type: 'normal', focused: true }])
    .map(win => [win.id, { state: 'normal', ...win }]));
  const data = history === null ? {} : { tabsHistory: structuredClone(history) };
  const storage = values => ({
    async get(key) { return structuredClone({ [key]: values[key] }); },
    async set(next) { Object.assign(values, structuredClone(next)); },
  });
  const errors = [];
  const calls = [];
  let lastFocused = [...windowMap.values()].find(win => win.focused)?.id;
  let focusOrder = [lastFocused, ...windowMap.keys()].filter((id, index, ids) => ids.indexOf(id) === index);
  const emit = (name, ...args) => listeners[name]?.(...args);
  const getTab = id => {
    if (!tabMap.has(id)) throw Error('No tab');
    return { ...tabMap.get(id) };
  };
  const getWindow = id => {
    if (!windowMap.has(id)) throw Error('No window');
    return { ...windowMap.get(id) };
  };
  const chrome = {
    storage: { local: storage({ tabsHistory: structuredClone(localHistory) }), session: storage(data) },
    runtime: { onInstalled: event('installed'), onStartup: event('startup') },
    action: { onClicked: event('click') },
    commands: { onCommand: event('command') },
    tabs: {
      onActivated: event('activated'), onRemoved: event('removed'),
      onReplaced: event('replaced'), onAttached: event('attached'), onDetached: event('detached'),
      async get(id) { return getTab(id); },
      async query(query) {
        return [...tabMap.values()].filter(tab =>
          (query.active === undefined || tab.active === query.active) &&
          (query.windowId === undefined || tab.windowId === query.windowId) &&
          (!query.currentWindow || tab.windowId === lastFocused) &&
          (!query.lastFocusedWindow || tab.windowId === lastFocused) &&
          (!query.windowType || windowMap.get(tab.windowId).type === query.windowType)
        ).map(tab => ({ ...tab }));
      },
      async update(id) {
        const tab = getTab(id);
        calls.push(['tab', id]);
        if (!tab.active) {
          for (const item of tabMap.values()) {
            if (item.windowId === tab.windowId) item.active = item.id === id;
          }
          emit('activated', { tabId: id, windowId: tab.windowId });
        }
        return getTab(id);
      },
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: event('focus'),
      async get(id) { return getWindow(id); },
      async getCurrent() { return getWindow(lastFocused); },
      async getLastFocused(options = {}) {
        let win = getWindow(lastFocused);
        if (options.windowTypes && !options.windowTypes.includes(win.type)) {
          win = getWindow(focusOrder.find(id => options.windowTypes.includes(windowMap.get(id)?.type)));
        }
        if (options.populate) win.tabs = [...tabMap.values()].filter(tab => tab.windowId === win.id).map(tab => ({ ...tab }));
        return win;
      },
      async getAll() { return [...windowMap.values()].map(w => ({ ...w })); },
      async update(id, options) {
        getWindow(id);
        calls.push(['window', id]);
        Object.assign(windowMap.get(id), options);
        if (options.focused && id !== lastFocused) focus(id);
        return getWindow(id);
      },
    },
  };
  function focus(id) {
    for (const win of windowMap.values()) win.focused = win.id === id;
    if (id !== -1) {
      lastFocused = id;
      focusOrder = [id, ...focusOrder.filter(item => item !== id)];
    }
    emit('focus', id);
  }
  function load() {
    vm.runInNewContext(source, { chrome, console: { error: (...args) => errors.push(args), log() {} } });
  }
  load();
  return {
    chrome, emit, focus, calls, errors, tabMap, windowMap, data, load,
    async flush() { for (let i = 0; i < 20; i++) await new Promise(setImmediate); },
    async switch() { emit('command', 'switch-to-previous-tab'); await this.flush(); },
  };
}

test('shortcut alternates repeatedly within a window', async () => {
  const b = browser();
  await b.switch();
  await b.switch();
  assert.deepEqual(b.calls.filter(c => c[0] === 'tab'), [['tab', 1], ['tab', 2]]);
});

test('toolbar button switches to the previous tab', async () => {
  const b = browser();
  b.emit('click', b.tabMap.get(2));
  await b.flush();
  assert.equal(b.tabMap.get(1).active, true);
});

test('background-window activation cannot make the shortcut select the current tab', async () => {
  const b = browser({ tabs: [
    { id: 1, windowId: 1, active: false }, { id: 2, windowId: 1, active: true },
    { id: 3, windowId: 2, active: true },
  ], windows: [{ id: 1, type: 'normal', focused: true }, { id: 2, type: 'normal', focused: false }] });
  b.emit('activated', { tabId: 3, windowId: 2 });
  await b.flush();
  await b.switch();
  assert.equal(b.tabMap.get(1).active, true);
});

test('stale history head does not cause a no-op on the current tab', async () => {
  const b = browser({ history: [entry(99), entry(2), entry(1)] });
  await b.switch();
  assert.equal(b.tabMap.get(1).active, true);
});

test('rapid commands alternate twice even before activation callbacks settle', async () => {
  const b = browser();
  b.emit('command', 'switch-to-previous-tab');
  b.emit('command', 'switch-to-previous-tab');
  await b.flush();
  assert.deepEqual(b.calls.filter(c => c[0] === 'tab'), [['tab', 1], ['tab', 2]]);
});

test('cross-window switching activates the target before focusing its window', async () => {
  const b = browser({ history: [entry(2), entry(1, 2)], tabs: [
    { id: 2, windowId: 1, active: true },
    { id: 1, windowId: 2, active: false }, { id: 3, windowId: 2, active: true },
  ], windows: [{ id: 1, type: 'normal', focused: true }, { id: 2, type: 'normal', focused: false }] });
  await b.switch();
  assert.deepEqual(b.calls.slice(0, 2), [['tab', 1], ['window', 2]]);
  await b.switch();
  assert.equal(b.windowMap.get(1).focused, true);
  assert.equal(b.tabMap.get(2).active, true);
});

test('PiP/popup focus and unfocused Chrome leave the normal-tab pair intact', async () => {
  const b = browser();
  b.windowMap.set(3, { id: 3, type: 'popup', focused: false });
  b.tabMap.set(3, { id: 3, windowId: 3, active: true });
  b.focus(-1);
  b.focus(3);
  b.emit('activated', { tabId: 3, windowId: 3 });
  await b.flush();
  await b.switch();
  assert.equal(b.tabMap.get(1).active, true);
  assert.equal(b.windowMap.get(1).focused, true);
});

test('empty history recovers from browser tab recency', async () => {
  const b = browser({ history: null });
  await b.switch();
  assert.equal(b.tabMap.get(1).active, true);
});

test('worker restart preserves the alternating pair', async () => {
  const b = browser();
  await b.switch();
  b.load();
  await b.switch();
  assert.equal(b.tabMap.get(2).active, true);
});

test('closed and popup targets are skipped', async () => {
  const b = browser({ history: [entry(2), entry(99), entry(3, 3), entry(1)] });
  b.windowMap.set(3, { id: 3, type: 'popup', focused: false });
  b.tabMap.set(3, { id: 3, windowId: 3, active: true });
  await b.switch();
  assert.equal(b.tabMap.get(1).active, true);
  assert.deepEqual(b.data.tabsHistory.map(e => e.tabId), [1, 2]);
});

test('moved tabs use their live window and restore a minimized window', async () => {
  const b = browser();
  b.tabMap.get(1).windowId = 2;
  b.tabMap.get(1).active = true;
  b.windowMap.set(2, { id: 2, type: 'normal', focused: false, state: 'minimized' });
  await b.switch();
  assert.equal(b.windowMap.get(2).focused, true);
  assert.equal(b.windowMap.get(2).state, 'normal');
  await b.switch();
  assert.equal(b.windowMap.get(1).focused, true);
});

test('manual focus changes update history even if the tab was already active', async () => {
  const b = browser();
  b.tabMap.set(3, { id: 3, windowId: 2, active: true });
  b.windowMap.set(2, { id: 2, type: 'normal', focused: false });
  b.focus(2);
  await b.flush();
  await b.switch();
  assert.equal(b.windowMap.get(1).focused, true);
  await b.switch();
  assert.equal(b.windowMap.get(2).focused, true);
});

test('replacement preserves the previous tab position', async () => {
  const b = browser();
  b.tabMap.delete(1);
  b.tabMap.set(4, { id: 4, windowId: 1, active: false });
  b.emit('replaced', 4, 1);
  await b.flush();
  await b.switch();
  assert.equal(b.tabMap.get(4).active, true);
});

test('one tab is a harmless no-op', async () => {
  const b = browser({ history: [entry(2)], tabs: [{ id: 2, windowId: 1, active: true }] });
  await b.switch();
  assert.deepEqual(b.calls, []);
  assert.deepEqual(b.errors, []);
});

test('an API failure does not poison the queue for the next press', async () => {
  const b = browser();
  const update = b.chrome.tabs.update;
  b.chrome.tabs.update = async () => { throw Error('Transient update failure'); };
  await b.switch();
  assert.equal(b.errors.length, 1);
  b.chrome.tabs.update = update;
  await b.switch();
  assert.equal(b.tabMap.get(1).active, true);
});

test('install/update seeds history from tab recency', async () => {
  const b = browser({ history: null });
  b.emit('installed', { reason: 'update' });
  await b.flush();
  await b.switch();
  assert.equal(b.tabMap.get(1).active, true);
});

test('browser restart ignores local history with reused tab IDs', async () => {
  const b = browser({ history: null, localHistory: [entry(2), entry(3), entry(1)] });
  b.tabMap.set(3, { id: 3, windowId: 1, active: false, lastAccessed: 1 });
  b.emit('startup');
  await b.flush();
  await b.switch();
  assert.equal(b.tabMap.get(1).active, true);
});

test('manifest exposes the toolbar action and recency-compatible Chrome version', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', pathToFileURL(__filename)), 'utf8'));
  assert.ok(manifest.action);
  assert.equal(manifest.minimum_chrome_version, '121');
});

test('warm same-window switch activates without browser reads', async () => {
  const b = browser();
  await b.switch();
  let reads = 0;
  for (const [api, method] of [
    [b.chrome.storage.session, 'get'], [b.chrome.windows, 'getLastFocused'],
    [b.chrome.tabs, 'query'], [b.chrome.tabs, 'get'], [b.chrome.windows, 'get'],
  ]) {
    const original = api[method];
    api[method] = async (...args) => { reads++; return original(...args); };
  }
  let readsBeforeActivation;
  const update = b.chrome.tabs.update;
  b.chrome.tabs.update = async (...args) => {
    readsBeforeActivation = reads;
    return update(...args);
  };
  b.calls.length = 0;
  await b.switch();
  assert.equal(readsBeforeActivation, 0, `Waited for ${readsBeforeActivation} reads before activation`);
  assert.equal(reads, 0, 'The activation callback should not repeat the completed switch checks');
  assert.equal(b.calls.filter(call => call[0] === 'window').length, 0);
});

test('slow session writes do not delay the next switch', async () => {
  const b = browser();
  await b.switch();
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const set = b.chrome.storage.session.set;
  b.chrome.storage.session.set = async values => { await blocked; return set(values); };
  try {
    await b.switch();
    await b.switch();
    assert.equal(b.tabMap.get(1).active, true, 'Second switch waited for storage');
  } finally {
    release();
    await b.flush();
  }
  assert.equal(b.data.tabsHistory[0].tabId, 1);
});

test('manual tab activation invalidates the warm window before the next press', async () => {
  const b = browser();
  await b.switch();
  b.tabMap.get(1).active = false;
  b.tabMap.set(3, { id: 3, windowId: 1, active: true });
  b.emit('activated', { tabId: 3, windowId: 1 });
  await b.switch();
  assert.equal(b.tabMap.get(1).active, true);
  await b.switch();
  assert.equal(b.tabMap.get(3).active, true);
});

test('moving a warm target into a popup makes it ineligible', async () => {
  const b = browser();
  await b.switch();
  b.windowMap.set(3, { id: 3, type: 'popup', focused: false });
  b.tabMap.get(2).windowId = 3;
  b.tabMap.get(2).active = true;
  b.emit('detached', 2, { oldWindowId: 1 });
  b.emit('attached', 2, { newWindowId: 3 });
  b.calls.length = 0;
  await b.switch();
  assert.deepEqual(b.calls, []);
  assert.deepEqual(b.data.tabsHistory.map(entry => entry.tabId), [1]);
});

test('closing a warm target falls back to the next visited tab', async () => {
  const b = browser({ history: [entry(2), entry(1), entry(3)] });
  b.tabMap.set(3, { id: 3, windowId: 1, active: false });
  await b.switch();
  b.tabMap.delete(2);
  b.emit('removed', 2);
  await b.switch();
  assert.equal(b.tabMap.get(3).active, true);
});

test('PiP focus invalidates a warm window so switching brings Chrome forward', async () => {
  const b = browser();
  await b.switch();
  b.windowMap.set(3, { id: 3, type: 'popup', focused: false });
  b.tabMap.set(3, { id: 3, windowId: 3, active: true });
  b.focus(3);
  await b.switch();
  assert.equal(b.windowMap.get(1).focused, true);
  assert.equal(b.tabMap.get(2).active, true);
});

test('a failed warm activation invalidates the snapshot and the next press recovers', async () => {
  const b = browser();
  await b.switch();
  const update = b.chrome.tabs.update;
  b.chrome.tabs.update = async () => { throw Error('Transient failure'); };
  await b.switch();
  assert.equal(b.errors.length, 1);
  b.chrome.tabs.update = update;
  await b.switch();
  assert.equal(b.tabMap.get(2).active, true);
});
