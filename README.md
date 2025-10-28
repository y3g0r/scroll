# Scroll

An automatic scrolling reader extension for comfortable reading of long web pages.

**Original Demo:** https://www.dropbox.com/s/yrnv9xuo6u7ycfl/Screen%20Recording%202020-05-05%20at%2010.06.51%20PM.mov?dl=0

## Features

- **Keyboard shortcut**: Press `Ctrl+Shift+Y` (or `Cmd+Shift+Y` on Mac) to instantly activate/deactivate the reader
- **Automatic scrolling**: Click to start/pause smooth auto-scrolling
- **Manual control**: Use mouse wheel to scroll manually through content
- **Speed toggle**: Press spacebar to switch between normal and 3x speed
- **Page dividers**: Visual separation between pages for easier reading
- **Cross-browser support**: Works on both Firefox and Chrome-based browsers

## Browser Compatibility

### Firefox
- **Rendering**: Uses `browser.tabs.captureVisibleTab()` API
- **Status**: ✅ Fully supported (Firefox 109+)

### Chrome/Chromium-based browsers
- **Rendering**: Uses `chrome.tabs.captureVisibleTab()` API
- **Status**: ✅ Fully supported

**Note**: A single unified manifest.json now works for both Firefox and Chrome-based browsers.

## Installation

### Firefox

1. Open Firefox and navigate to `about:debugging`
2. Click "This Firefox" in the left sidebar
3. Click "Load Temporary Add-on..."
4. Navigate to the extension folder and select `manifest.json`
5. The Scroll icon should appear in your toolbar

### Chrome/Edge/Brave/Opera

1. Open your browser and navigate to:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
   - Brave: `brave://extensions/`
   - Opera: `opera://extensions/`

2. Enable "Developer mode" (toggle in top-right corner)
3. Click "Load unpacked"
4. Select the extension folder
5. The Scroll icon should appear in your toolbar

## Usage

1. Navigate to any web page with long content
2. Activate the reader using either:
   - **Keyboard shortcut**: Press `Ctrl+Shift+Y` (or `Cmd+Shift+Y` on Mac) for instant activation
   - **Extension icon**: Click the Scroll icon in your browser toolbar
3. The reader will capture the page content and start automatic scrolling
4. **Controls**:
   - **Keyboard shortcut**: Press `Ctrl+Shift+Y` (or `Cmd+Shift+Y`) to toggle on/off
   - **Click canvas**: Pause/resume automatic scrolling
   - **Mouse wheel**: Manually scroll up or down
   - **Spacebar**: Toggle between normal and 3x speed

### Keyboard Shortcut

The default keyboard shortcut is `Ctrl+Shift+Y` (Windows/Linux) or `Cmd+Shift+Y` (Mac). This can be customized in your browser's extension settings:

- **Chrome/Edge/Brave**: Navigate to `chrome://extensions/shortcuts` (or equivalent for your browser)
- **Firefox**: Navigate to `about:addons`, click the gear icon, then "Manage Extension Shortcuts"

## How It Works

Scroll transforms any web page into a comfortable reading experience by creating a visual "reading surface" that auto-scrolls through your content.

### Core Concept

When activated, the extension:

1. **Captures the page content** as a series of viewport screenshots
2. **Creates a reading canvas** that overlays the original page
3. **Progressively displays content** with smooth auto-scrolling
4. **Adds visual page breaks** between each viewport section for easier reading
5. **Maintains your position** so you can resume normal browsing when deactivated

Think of it as a teleprompter for web pages - content flows upward at a steady pace while you read comfortably without manual scrolling.

### User Experience

The reading flow is designed to be:
- **Hands-free**: Automatic scrolling eliminates the need for constant mouse/trackpad interaction
- **Adjustable**: Speed can be toggled on-the-fly with spacebar
- **Interruptible**: Click to pause, mouse wheel to manually navigate
- **Non-destructive**: Original page remains untouched; simply deactivate to return to normal browsing

### Architecture

The extension consists of three main components:

- **Background Service**: Coordinates communication between components and handles screenshot capture requests
- **Content Script**: Manages the reading canvas, user interactions, and content rendering
- **Popup Interface**: Provides status feedback and control for activating/deactivating the reader

### Cross-Browser Support

Scroll works on both Firefox and Chrome-based browsers using a unified Manifest V3 configuration. The extension uses browser-native screenshot APIs and requires no external dependencies or libraries. Chrome ignores Firefox-specific settings (like `browser_specific_settings`), while modern Firefox (109+) now supports the same `service_worker` background script format as Chrome, allowing us to use a single manifest.json for both browsers.

## License

Original extension created for Firefox. Updated for cross-browser compatibility.

## Changelog

### v.0.3
- Same as v0.2, just want to upload clean artifact to AMO (previous included some unnecessary files in it)

### v0.2 (2025)
- Migrated to Manifest V3
- Added cross-browser support (Chrome, Edge, Brave, Opera)
- Enhanced reading experience with improved rendering
- Modernized to use native browser APIs
- Added configurable keyboard shortcut (`Ctrl+Shift+Y` / `Cmd+Shift+Y`) for instant activation
- Status and progress shown in extension popup UI
- Improved error handling for content script injection

### v0.1 (2020)
- Initial Firefox-only release
- Basic automatic scrolling functionality
