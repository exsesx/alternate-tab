const CONFIG = {
  DEBUG: false,
  MAX_HISTORY_SIZE: 10,
  STORAGE_KEY: 'tabsHistory',
};

/**
 * Manages tab history state and ensures atomic updates to storage
 * to prevent race conditions.
 */
const TabHistoryManager = {
  _operation: Promise.resolve(),

  /**
   * Queues an operation to modify the tab history, ensuring serial execution.
   * @param {function(Array<object>): Promise<Array<object>>} modifier - A function that takes the current history and returns the new history.
   */
  async modify(modifier) {
    this._operation = this._operation.then(async () => {
      try {
        const currentHistory = await this._get();
        const newHistory = await modifier(currentHistory);
        await this._set(newHistory);
      } catch (error) {
        console.error('Error during history modification:', error);
      }
    });

    return this._operation;
  },

  async _get() {
    try {
      const result = await chrome.storage.local.get(CONFIG.STORAGE_KEY);

      return result[CONFIG.STORAGE_KEY] || [];
    } catch (error) {
      console.error('Error getting tabs history:', error);

      return [];
    }
  },

  async _set(tabsHistory) {
    try {
      const trimmedHistory = tabsHistory.slice(0, CONFIG.MAX_HISTORY_SIZE);

      await chrome.storage.local.set({ [CONFIG.STORAGE_KEY]: trimmedHistory });

      if (CONFIG.DEBUG) {
        console.log('Tab history updated:', trimmedHistory);
      }
    } catch (error) {
      console.error('Error setting tabs history:', error);
    }
  },

  async getHistory() {
    await this._operation;

    return this._get();
  }
};

/**
 * Cleans invalid tabs and non-normal windows from history in parallel.
 * @param {Array<object>} tabsHistory 
 * @returns {Promise<Array<object>>}
 */
async function getCleanedHistory(tabsHistory) {
  const historyChecks = tabsHistory.map(async (entry) => {
    try {
      const tab = await chrome.tabs.get(entry.tabId);
      const window = await chrome.windows.get(tab.windowId);

      if (window.type !== 'normal') {

        return null;
      }

      return { tabId: tab.id, windowId: tab.windowId };
    } catch (error) {

      return null;
    }
  });

  const cleanedEntries = await Promise.all(historyChecks);

  return cleanedEntries.filter(Boolean);
}

async function findNextValidTarget(tabsHistory) {
  let needsCleanup = false;

  for (let index = 1; index < tabsHistory.length; index += 1) {
    const entry = tabsHistory[index];

    try {
      const tab = await chrome.tabs.get(entry.tabId);
      const window = await chrome.windows.get(tab.windowId);

      if (window.type !== 'normal') {
        needsCleanup = true;

        continue;
      }

      if (tab.windowId !== entry.windowId) {
        needsCleanup = true;
      }

      return {
        tabInfo: {
          tabId: tab.id,
          windowId: tab.windowId,
        },
        needsCleanup,
      };
    } catch (error) {
      needsCleanup = true;
    }
  }

  return { tabInfo: null, needsCleanup };
}

async function handleTabActivated(tabInfo) {
  if (CONFIG.DEBUG) {
    console.log('Tab activated:', tabInfo.tabId);
  }

  try {
    const tab = await chrome.tabs.get(tabInfo.tabId);
    const window = await chrome.windows.get(tab.windowId);

    if (window.type !== 'normal') {
      if (CONFIG.DEBUG) {
        console.log('Skipping non-normal window:', window.type);
      }

      return;
    }

    const normalizedInfo = {
      tabId: tab.id,
      windowId: tab.windowId,
    };

    await TabHistoryManager.modify(async (currentHistory) => {
      const newHistory = currentHistory.filter(
        historyTab => historyTab.tabId !== normalizedInfo.tabId
      );

      newHistory.unshift(normalizedInfo);

      return newHistory;
    });
  } catch (error) {
    if (CONFIG.DEBUG) {
      console.log('Failed to handle tab activation:', error);
    }
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  if (CONFIG.DEBUG) {
    console.log('Extension installed');
  }

  try {
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (currentTab) {
      const initialHistory = [{ tabId: currentTab.id, windowId: currentTab.windowId }];
      await TabHistoryManager.modify(() => Promise.resolve(initialHistory));
    }
  } catch (error) {
    console.error('Error during extension installation:', error);
  }
});

chrome.tabs.onActivated.addListener(handleTabActivated);

chrome.tabs.onRemoved.addListener((tabId) => {
  if (CONFIG.DEBUG) {
    console.log('Tab removed:', tabId);
  }

  TabHistoryManager.modify(async (currentHistory) => {
    return currentHistory.filter(historyTab => historyTab.tabId !== tabId);
  });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'switch-to-previous-tab') {
    return;
  }

  if (CONFIG.DEBUG) {
    console.log('Switch command triggered');
  }

  try {
    const tabsHistory = await TabHistoryManager.getHistory();

    if (tabsHistory.length < 2) {
      if (CONFIG.DEBUG) {
        console.log('Insufficient tab history.');
      }

      return;
    }

    const { tabInfo: targetTabInfo, needsCleanup } = await findNextValidTarget(tabsHistory);

    if (!targetTabInfo) {
      if (CONFIG.DEBUG) {
        console.log('No valid tab to switch to, skipping.');
      }

      if (needsCleanup) {
        TabHistoryManager.modify(getCleanedHistory);
      }

      return;
    }

    const currentWindow = await chrome.windows.getCurrent();

    if (targetTabInfo.windowId !== currentWindow.id) {
      await chrome.windows.update(targetTabInfo.windowId, { focused: true });
    }

    await chrome.tabs.update(targetTabInfo.tabId, { active: true });

    if (CONFIG.DEBUG) {
      console.log('Switched to tab:', targetTabInfo.tabId);
    }

    if (needsCleanup) {
      TabHistoryManager.modify(getCleanedHistory);
    }
  } catch (error) {
    console.error('Error switching tabs:', error);
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  if (CONFIG.DEBUG) {
    console.log('Window focused:', windowId);
  }

  try {
    const [currentTab] = await chrome.tabs.query({ active: true, windowId: windowId });

    if (currentTab) {
      await handleTabActivated({
        tabId: currentTab.id,
        windowId: currentTab.windowId
      });
    }
  } catch (error) {
    console.error('Error on window focus change:', error);
  }
});
