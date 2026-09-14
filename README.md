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

Only tabs in normal browser windows enter history. Activity in background windows, popup windows, DevTools, and Picture-in-Picture does not replace your last visited tab. The PiP source tab remains eligible as an ordinary tab. Switching leaves PiP playback alone. If Chrome delivers the shortcut while PiP is focused, switching uses the last focused normal window.

A target in another window brings that window forward, restoring it if minimized.

### Customizing the Shortcut
1. Go to `chrome://extensions/shortcuts/`
2. Find "Alternate Tab" in the list
3. Click the pencil icon next to "Switch to the previously active tab"
4. Set your preferred keyboard shortcut

## How it works

The extension records the active tab in the focused normal browser window. Each shortcut or toolbar click checks the current tab and selects the most recently visited different tab. Complete operations run sequentially so rapid presses cannot read the same unfinished switch.

History contains up to 10 tab IDs in Chrome session storage. It survives service-worker suspension but does not reuse stale IDs across browser sessions. After an extension reload or browser restart, history is seeded from Chrome's `lastAccessed` values. This is a best-effort starting order; subsequent visits establish the exact order.

While the worker is awake, it keeps history in memory and saves snapshots to session storage in order, without making the next press wait for a write. Repeated same-window switches use the last verified window snapshot and call tab activation without any preceding browser reads. External tab activations, window-focus changes, closures, replacements, and moves invalidate that snapshot. A worker restart reloads the latest saved history and checks the live window again.

Closed tabs and unsupported windows are skipped. Moved tabs use their current window, and Chrome tab replacements retain their history position.

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
1. Check that the extension is enabled in `chrome://extensions/`. After updating these files, click its Reload button and confirm version 1.1.2.
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
