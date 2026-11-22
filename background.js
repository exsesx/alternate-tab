const HISTORY_KEY = 'tabsHistory';
const HISTORY_LIMIT = 10;

let queue = Promise.resolve();

function serialize(task) {
  queue = queue.then(task).catch(error => console.error('Alternate Tab:', error));
}

async function readHistory() {
  const { [HISTORY_KEY]: history } = await chrome.storage.session.get(HISTORY_KEY);
  if (history) return history;

  // Tab IDs belong to a browser session. After reload/restart, recover from
  // Chrome's recency data rather than reuse IDs persisted by another session.
  const tabs = await chrome.tabs.query({ windowType: 'normal' });

  return tabs.sort((a, b) => b.lastAccessed - a.lastAccessed).map(tab => tab.id);
}

function writeHistory(history) {
  return chrome.storage.session.set({ [HISTORY_KEY]: history.slice(0, HISTORY_LIMIT) });
}

function withVisit(history, tabId) {
  return [tabId, ...history.filter(id => id !== tabId)];
}

async function getLastFocusedNormalWindow() {
  const window = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  const [activeTab] = await chrome.tabs.query({ active: true, windowId: window.id });

  return { window, activeTab };
}

async function recordVisit() {
  const { window, activeTab } = await getLastFocusedNormalWindow();
  if (!window.focused || !activeTab) return;

  await writeHistory(withVisit(await readHistory(), activeTab.id));
}

async function forgetTab(tabId) {
  const history = await readHistory();
  if (history.includes(tabId)) await writeHistory(history.filter(id => id !== tabId));
}

async function replaceTab(addedTabId, removedTabId) {
  const history = await readHistory();
  if (!history.includes(removedTabId)) return;

  await writeHistory(history.map(id => (id === removedTabId ? addedTabId : id)));
}

async function findSwitchTarget(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const window = await chrome.windows.get(tab.windowId);

    return window.type === 'normal' ? { tab, window } : undefined;
  } catch {
    return undefined;
  }
}

async function switchToPreviousTab() {
  const { activeTab } = await getLastFocusedNormalWindow();
  if (!activeTab) return;

  const history = await readHistory();
  const candidates = history.filter(tabId => tabId !== activeTab.id);

  for (const tabId of candidates) {
    const target = await findSwitchTarget(tabId);
    if (!target) continue;

    await chrome.tabs.update(target.tab.id, { active: true });

    if (target.window.state === 'minimized') {
      await chrome.windows.update(target.window.id, { state: 'normal' });
    }

    if (!target.window.focused) {
      await chrome.windows.update(target.window.id, { focused: true });
    }

    return;
  }
}

chrome.commands.onCommand.addListener(() => serialize(switchToPreviousTab));
chrome.action.onClicked.addListener(() => serialize(switchToPreviousTab));

chrome.tabs.onActivated.addListener(() => serialize(recordVisit));
chrome.windows.onFocusChanged.addListener(() => serialize(recordVisit));

chrome.tabs.onRemoved.addListener(tabId => serialize(() => forgetTab(tabId)));
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) =>
  serialize(() => replaceTab(addedTabId, removedTabId)));
