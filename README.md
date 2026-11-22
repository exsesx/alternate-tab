# Alternate Tab

A Chrome extension that switches between your current tab and the previously active tab, including tabs in other windows.

## Features

- **Fast tab switching**: Instantly switch to your previous tab
- **Multi-window support**: Works across different Chrome windows
- **Memory efficient**: Maintains a clean history of up to 10 tabs
- **Error resilient**: Automatically cleans up closed tabs from history
- **Modern architecture**: Built with Manifest V3 and ES6+

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in the top-right corner)
4. Click "Load unpacked"
5. Select the folder containing this extension
6. The extension will appear in your extensions list

## Usage

### Default Shortcut
Press **Alt+Q** or click the pinned extension toolbar button to switch to the previously active tab. Press again to switch back.

### Multiple Windows
History is one list shared by all normal browser windows, so the previous tab can be in another window. A target in another window is activated first, then its window is restored if minimized and brought forward. Pressing again returns to the tab and window you came from.

A tab counts as visited when it becomes the active tab of the focused window, or when its window gains focus. A tab that something activates in a background window is not a visit and does not replace your previous tab. Closing a window removes its tabs from history. A tab moved to another window keeps its place.

Only tabs in normal browser windows enter history. Activity in popup windows, DevTools, and Picture-in-Picture does not replace your last visited tab. The PiP source tab remains eligible as an ordinary tab. Switching leaves PiP playback alone. If Chrome delivers the shortcut while PiP is focused, switching uses the last focused normal window.

### Customizing the Shortcut
1. Go to `chrome://extensions/shortcuts/`
2. Find "Alternate Tab" in the list
3. Click the pencil icon next to "Switch to the previously active tab"
4. Set your preferred keyboard shortcut

### Using Ctrl+Tab
The shortcut editor refuses `Ctrl+Tab`, but the API behind that page accepts it. Open `chrome://extensions/shortcuts/`, open DevTools on that page (the API exists only there), and run this in the console:

```js
const extensions = await chrome.developerPrivate.getExtensionsInfo();
const { id } = extensions.find(extension => extension.name === 'Alternate Tab');

await chrome.developerPrivate.updateExtensionCommand({
  extensionId: id,
  commandName: 'switch-to-previous-tab',
  keybinding: 'Ctrl+Tab',
});
```

On macOS this binds Control+Tab, shown as ⌃⇥. The binding replaces Chrome's own Ctrl+Tab (next tab), which stays available as Ctrl+PgDn on Windows and Linux and Cmd+Option+Right on macOS. The shortcut editor saves through this same call, so the binding is stored like any other custom shortcut and survives extension reloads. To undo it, set another shortcut in the editor.

`chrome.developerPrivate` is an internal Chrome API without compatibility guarantees. This was checked on Chrome 158.

## How it works

The extension records the active tab in the focused normal browser window. Each shortcut or toolbar click checks the current tab and selects the most recently visited different tab. Complete operations run sequentially so rapid presses cannot read the same unfinished switch.

The worker keeps no tab or window state in memory. Every press, tab activation, and window-focus change reads the live browser state and the stored history, so a worker restart changes nothing. These reads take well under a millisecond, against a few milliseconds for the tab activation itself.

### Stored State

The only state is a list of up to 10 tab IDs, most recent first, under the `tabsHistory` key in `chrome.storage.session`. Chrome holds that storage area in memory and never writes it to disk. The list contains no URLs or titles, and the extension does not request the `tabs` permission needed to read them.

Entries leave the list in these cases:

- **Tab closed**: its ID is removed, including every tab of a closed window.
- **Tab ID replaced**: when Chrome gives a tab a new ID, for example after Memory Saver discards it, the new ID takes the old one's position.
- **Limit reached**: the oldest ID drops off when an eleventh tab is visited.

Chrome clears the whole list when the browser restarts and when the extension is reloaded, updated, or disabled. Tab IDs are valid only within one browser session, so nothing is carried over. The next press or visit then seeds the list from Chrome's `lastAccessed` values. This is a best-effort starting order, and subsequent visits establish the exact order.

An ID that is stale anyway, or that belongs to a tab in a popup window, is skipped at switch time.

## Browser Compatibility

- **Chrome**: Version 121 or newer (Manifest V3)
- **Chromium-based browsers**: Should work (Brave, Edge, etc.)
- **Other browsers**: Not supported (uses Chrome Extension APIs)

## Development

The extension is built with:
- **Manifest V3**: Modern Chrome extension format
- **Service Worker**: Background script that conserves resources
- **Chrome Storage API**: Session tab history storage
- **Chrome Tabs API**: Tab management and switching

### Project Structure

```
├── manifest.json       # Extension configuration
├── background.js       # Main extension logic
├── tests/background.test.cjs # Chrome API event regression tests
└── README.md          # This file
```

### Verification

Run the regression suite with Node.js 18 or newer, without installing dependencies:

```sh
node --test tests/background.test.cjs
```

The tests execute the real background script with simulated Chrome APIs. For a browser smoke test, reload the extension at `chrome://extensions/`, visit two tabs, and alternate repeatedly with both the shortcut and toolbar button. Repeat across two windows, with a minimized destination, and with PiP open. Browser shortcut delivery and native PiP behavior require this live check.

## Troubleshooting

### Extension Not Working
1. Check that the extension is enabled in `chrome://extensions/`. After updating these files, click its Reload button and confirm version 2.0.0.
2. Verify the keyboard shortcut is set in `chrome://extensions/shortcuts/`
3. Visit at least two tabs in normal browser windows

### Shortcut Not Responding
1. Try a different keyboard shortcut in case of conflicts
2. Restart Chrome and try again
3. Check Chrome DevTools console for any errors

### Performance Issues
The extension limits tab history to 10 entries and automatically cleans up closed tabs to maintain optimal performance.

## License

This project is provided as-is for educational and personal use.
