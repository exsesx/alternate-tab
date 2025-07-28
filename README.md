# Alternate Tab

A modern Chrome extension that allows you to quickly switch between your current tab and the previously active tab with a keyboard shortcut.

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
Press **Alt+Q** to switch between your current tab and the previously active tab.

### Customizing the Shortcut
1. Go to `chrome://extensions/shortcuts/`
2. Find "Alternate Tab" in the list
3. Click the pencil icon next to "Switch to the previously active tab"
4. Set your preferred keyboard shortcut

## Advanced: Using Ctrl+Tab (Developer Hack)

Chrome normally restricts `Ctrl+Tab` as a keyboard shortcut, but you can enable it using the developer console:

1. Find your extension ID:
   - Go to `chrome://extensions/`
   - Enable "Developer mode" 
   - Copy the extension ID (long string under the extension name)

2. Open Chrome DevTools (F12) on any page
3. Go to the Console tab
4. Run this command (replace `YOUR_EXTENSION_ID` with your actual extension ID):

```javascript
await chrome.developerPrivate.updateExtensionCommand({
    extensionId: "YOUR_EXTENSION_ID",
    commandName: "switch-to-previous-tab",
    keybinding: "Ctrl+Tab"
});
```

**Note**: This hack uses Chrome's internal developer API and may not work in all Chrome versions. Use at your own discretion.

## How It Works

The extension maintains a history of recently active tabs in Chrome's local storage. When you activate a tab, it moves to the front of the history. When you use the keyboard shortcut, it switches to the second tab in the history (your previous tab).

### Key Components

- **Tab History Management**: Tracks tab activation and maintains a clean history
- **Cross-Window Support**: Handles focus changes between Chrome windows
- **Automatic Cleanup**: Removes closed tabs from history to prevent errors
- **Race Condition Prevention**: Uses semaphores to handle rapid tab operations

## Browser Compatibility

- **Chrome**: Fully supported (Manifest V3)
- **Chromium-based browsers**: Should work (Brave, Edge, etc.)
- **Other browsers**: Not supported (uses Chrome Extension APIs)

## Development

The extension is built with:
- **Manifest V3**: Modern Chrome extension format
- **Service Worker**: Background script that conserves resources
- **Chrome Storage API**: Persistent tab history storage
- **Chrome Tabs API**: Tab management and switching

### Project Structure

```
├── manifest.json       # Extension configuration
├── background.js       # Main extension logic
└── README.md          # This file
```

## Troubleshooting

### Extension Not Working
1. Check that the extension is enabled in `chrome://extensions/`
2. Verify the keyboard shortcut is set in `chrome://extensions/shortcuts/`
3. Make sure you have at least 2 tabs open with history

### Shortcut Not Responding
1. Try a different keyboard shortcut in case of conflicts
2. Restart Chrome and try again
3. Check Chrome DevTools console for any errors

### Performance Issues
The extension limits tab history to 10 entries and automatically cleans up closed tabs to maintain optimal performance.

## License

This project is provided as-is for educational and personal use.