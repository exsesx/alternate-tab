const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '../background.js'), 'utf8');

function browser({ history = [2, 1], tabs, windows } = {}) {
  const listeners = {};
  const event = name => ({ addListener(fn) { listeners[name] = fn; } });
  const tabMap = new Map((tabs || [
    { id: 1, windowId: 1, active: false, lastAccessed: 10 },
    { id: 2, windowId: 1, active: true, lastAccessed: 20 },
  ]).map(tab => [tab.id, { ...tab }]));
  const windowMap = new Map((windows || [{ id: 1, type: 'normal', focused: true }])
    .map(win => [win.id, { state: 'normal', ...win }]));
  const data = history === null ? {} : { tabsHistory: [...history] };
  const errors = [];
  const calls = [];
  let focusOrder = [...windowMap.values()].sort((a, b) => b.focused - a.focused).map(win => win.id);

  const emit = (name, ...args) => listeners[name]?.(...args);
  const getTab = id => {
    if (!tabMap.has(id)) throw Error('No tab');

    return { ...tabMap.get(id) };
  };
  const getWindow = id => {
    if (!windowMap.has(id)) throw Error('No window');

    return { ...windowMap.get(id) };
  };

  function focus(id) {
    for (const win of windowMap.values()) win.focused = win.id === id;
    if (id !== -1) focusOrder = [id, ...focusOrder.filter(item => item !== id)];
    emit('focus', id);
  }

  function activate(id) {
    const { windowId } = tabMap.get(id);
    for (const tab of tabMap.values()) {
      if (tab.windowId === windowId) tab.active = tab.id === id;
    }
    emit('activated', { tabId: id, windowId });
  }

  const chrome = {
    storage: {
      session: {
        async get(key) { return structuredClone({ [key]: data[key] }); },
        async set(next) { Object.assign(data, structuredClone(next)); },
      },
    },
    action: { onClicked: event('click') },
    commands: { onCommand: event('command') },
    tabs: {
      onActivated: event('activated'),
      onRemoved: event('removed'),
      onReplaced: event('replaced'),
      async get(id) { return getTab(id); },
      async query(query) {
        return [...tabMap.values()].filter(tab =>
          (query.active === undefined || tab.active === query.active) &&
          (query.windowId === undefined || tab.windowId === query.windowId) &&
          (!query.windowType || windowMap.get(tab.windowId).type === query.windowType)
        ).map(tab => ({ ...tab }));
      },
      async update(id) {
        const tab = getTab(id);
        calls.push(['tab', id]);
        if (!tab.active) activate(id);

        return getTab(id);
      },
    },
    windows: {
      onFocusChanged: event('focus'),
      async get(id) { return getWindow(id); },
      async getLastFocused({ windowTypes }) {
        return getWindow(focusOrder.find(id => windowTypes.includes(windowMap.get(id)?.type)));
      },
      async update(id, options) {
        const wasFocused = getWindow(id).focused;
        calls.push(['window', id]);
        Object.assign(windowMap.get(id), options);
        if (options.focused && !wasFocused) focus(id);

        return getWindow(id);
      },
    },
  };

  function load() {
    vm.runInNewContext(source, { chrome, console: { error: (...args) => errors.push(args) } });
  }

  load();

  return {
    chrome, emit, focus, activate, calls, errors, tabMap, windowMap, data, load,
    async flush() { for (let i = 0; i < 20; i++) await new Promise(setImmediate); },
    async switch() { emit('command', 'switch-to-previous-tab'); await this.flush(); },
  };
}

const twoWindows = [{ id: 1, type: 'normal', focused: true }, { id: 2, type: 'normal', focused: false }];

test('shortcut alternates repeatedly within a window', async () => {
  const b = browser();

  await b.switch();
  await b.switch();

  assert.deepEqual(b.calls, [['tab', 1], ['tab', 2]]);
});

test('toolbar button switches to the previous tab', async () => {
  const b = browser();

  b.emit('click', b.tabMap.get(2));
  await b.flush();

  assert.equal(b.tabMap.get(1).active, true);
});

test('rapid commands alternate twice before activation events settle', async () => {
  const b = browser();

  b.emit('command', 'switch-to-previous-tab');
  b.emit('command', 'switch-to-previous-tab');
  await b.flush();

  assert.deepEqual(b.calls, [['tab', 1], ['tab', 2]]);
});

test('manually visited tabs become the previous tab', async () => {
  const b = browser({ tabs: [
    { id: 1, windowId: 1, active: false }, { id: 2, windowId: 1, active: true },
    { id: 3, windowId: 1, active: false },
  ] });

  b.activate(3);
  await b.flush();
  b.activate(1);
  await b.flush();
  await b.switch();

  assert.equal(b.tabMap.get(3).active, true);
});

test('history keeps at most 10 tabs', async () => {
  const b = browser();

  for (let id = 10; id < 22; id++) {
    b.tabMap.set(id, { id, windowId: 1, active: false });
    b.activate(id);
    await b.flush();
  }

  assert.equal(b.data.tabsHistory.length, 10);
  assert.equal(b.data.tabsHistory[0], 21);
});

test('activation in an unfocused window is not a visit', async () => {
  const b = browser({ tabs: [
    { id: 1, windowId: 1, active: false }, { id: 2, windowId: 1, active: true },
    { id: 3, windowId: 2, active: false }, { id: 4, windowId: 2, active: true },
  ], windows: twoWindows });

  b.activate(3);
  await b.flush();
  await b.switch();

  assert.equal(b.tabMap.get(1).active, true);
  assert.equal(b.windowMap.get(1).focused, true);
});

test('activations while Chrome is unfocused are not visits', async () => {
  const b = browser({ tabs: [
    { id: 1, windowId: 1, active: false }, { id: 2, windowId: 1, active: true },
    { id: 3, windowId: 1, active: false },
  ] });

  b.focus(-1);
  b.activate(3);
  await b.flush();
  b.activate(1);
  await b.flush();
  b.focus(1);
  await b.flush();
  await b.switch();

  assert.equal(b.tabMap.get(2).active, true);
});

test('focusing another window visits its active tab', async () => {
  const b = browser({ tabs: [
    { id: 1, windowId: 1, active: false }, { id: 2, windowId: 1, active: true },
    { id: 3, windowId: 2, active: true },
  ], windows: twoWindows });

  b.focus(2);
  await b.flush();
  await b.switch();

  assert.equal(b.windowMap.get(1).focused, true);
  assert.equal(b.tabMap.get(2).active, true);

  await b.switch();

  assert.equal(b.windowMap.get(2).focused, true);
});

test('cross-window switching activates the target before focusing its window', async () => {
  const b = browser({ tabs: [
    { id: 2, windowId: 1, active: true },
    { id: 1, windowId: 2, active: false }, { id: 3, windowId: 2, active: true },
  ], windows: twoWindows });

  await b.switch();

  assert.deepEqual(b.calls, [['tab', 1], ['window', 2]]);

  await b.switch();

  assert.equal(b.windowMap.get(1).focused, true);
  assert.equal(b.tabMap.get(2).active, true);
});

test('a minimized target window is restored and focused', async () => {
  const b = browser({ tabs: [
    { id: 2, windowId: 1, active: true }, { id: 1, windowId: 2, active: true },
  ], windows: [
    { id: 1, type: 'normal', focused: true },
    { id: 2, type: 'normal', focused: false, state: 'minimized' },
  ] });

  await b.switch();

  assert.equal(b.windowMap.get(2).state, 'normal');
  assert.equal(b.windowMap.get(2).focused, true);
});

test('popup focus and unfocused Chrome leave the normal-tab pair intact', async () => {
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

test('closed tabs and tabs in popup windows are skipped', async () => {
  const b = browser({ history: [2, 99, 3, 1] });
  b.windowMap.set(3, { id: 3, type: 'popup', focused: false });
  b.tabMap.set(3, { id: 3, windowId: 3, active: true });

  await b.switch();

  assert.deepEqual(b.calls, [['tab', 1]]);
});

test('closing the previous tab falls back to the one visited before it', async () => {
  const b = browser({ history: [2, 1, 3] });
  b.tabMap.set(3, { id: 3, windowId: 1, active: false });

  b.tabMap.delete(1);
  b.emit('removed', 1);
  await b.switch();

  assert.equal(b.tabMap.get(3).active, true);
});

test('closed tabs do not push open tabs out of the history limit', async () => {
  const b = browser();

  for (let id = 10; id < 20; id++) {
    b.tabMap.set(id, { id, windowId: 1, active: false });
    b.activate(id);
    await b.flush();
    b.tabMap.delete(id);
    b.emit('removed', id);
    b.activate(2);
    await b.flush();
  }
  await b.switch();

  assert.equal(b.tabMap.get(1).active, true);
});

test('a replaced tab keeps its history position', async () => {
  const b = browser({ history: [2, 1, 3] });
  b.tabMap.set(3, { id: 3, windowId: 1, active: false });

  b.tabMap.delete(1);
  b.tabMap.set(4, { id: 4, windowId: 1, active: false });
  b.emit('replaced', 4, 1);
  await b.switch();

  assert.equal(b.tabMap.get(4).active, true);
});

test('empty session storage seeds history from tab recency', async () => {
  const b = browser({ history: null, tabs: [
    { id: 1, windowId: 1, active: false, lastAccessed: 10 },
    { id: 2, windowId: 1, active: true, lastAccessed: 30 },
    { id: 3, windowId: 1, active: false, lastAccessed: 20 },
  ] });

  await b.switch();

  assert.equal(b.tabMap.get(3).active, true);
});

test('worker restart uses the stored history, not tab recency', async () => {
  const b = browser({ history: [2, 1], tabs: [
    { id: 1, windowId: 1, active: false, lastAccessed: 10 },
    { id: 2, windowId: 1, active: true, lastAccessed: 30 },
    { id: 3, windowId: 1, active: false, lastAccessed: 20 },
  ] });

  b.load();
  await b.switch();

  assert.equal(b.tabMap.get(1).active, true);
});

test('one tab is a harmless no-op', async () => {
  const b = browser({ history: [2], tabs: [{ id: 2, windowId: 1, active: true }] });

  await b.switch();

  assert.deepEqual(b.calls, []);
  assert.deepEqual(b.errors, []);
});

test('an API failure does not block the next press', async () => {
  const b = browser();
  const update = b.chrome.tabs.update;
  b.chrome.tabs.update = async () => { throw Error('Transient update failure'); };

  await b.switch();

  assert.equal(b.errors.length, 1);

  b.chrome.tabs.update = update;
  await b.switch();

  assert.equal(b.tabMap.get(1).active, true);
});
