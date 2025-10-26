// Cross-browser compatibility: support both Chrome and Firefox
const browserAPI = typeof chrome !== 'undefined' ? chrome : browser;

// Track status per tab
const tabStatus = new Map(); // tabId -> {isActive, isCapturing, captureProgress}

async function injectContentScript(tabId) {
    try {
        // Manifest V3 uses scripting API
        if (browserAPI.scripting) {
            await browserAPI.scripting.executeScript({
                target: { tabId: tabId },
                files: ["content.js"]
            });
        } else {
            // Fallback for older Firefox versions
            await browserAPI.tabs.executeScript(tabId, {
                file: "content.js"
            });
        }
        console.log(`Script injected into tab ${tabId}`);
    } catch (error) {
        console.error('Failed to inject script:', error);
    }
}

async function toggleReader(tabId) {
    try {
        if (!tabId) {
            let tabs = await browserAPI.tabs.query({active: true, currentWindow: true});
            if (tabs[0]) {
                tabId = tabs[0].id;
            }
        }
        if (tabId) {
            try {
                const response = await browserAPI.tabs.sendMessage(tabId, {
                    command: "toggleReader"
                });
                // Update the background's stored state based on the content script's response
                if (response && response.success) {
                    updateTabStatus(tabId, {
                        isActive: response.isActive,
                        isCapturing: false,
                        captureProgress: ''
                    });
                }
                return response;
            } catch (error) {
                // If content script not loaded, inject it first
                if (error.message && error.message.includes('Receiving end does not exist')) {
                    console.log('Content script not loaded, injecting...');
                    await injectContentScript(tabId);
                    // Wait a bit for script to initialize
                    await new Promise(resolve => setTimeout(resolve, 100));
                    // Try again
                    const response = await browserAPI.tabs.sendMessage(tabId, {
                        command: "toggleReader"
                    });
                    // Update the background's stored state
                    if (response && response.success) {
                        updateTabStatus(tabId, {
                            isActive: response.isActive,
                            isCapturing: false,
                            captureProgress: ''
                        });
                    }
                    return response;
                } else {
                    throw error;
                }
            }
        }
    } catch (error) {
        console.error('Failed to toggle reader:', error);
        return { success: false, error: error.message };
    }
}

async function recaptureReader(tabId) {
    try {
        if (!tabId) {
            let tabs = await browserAPI.tabs.query({active: true, currentWindow: true});
            if (tabs[0]) {
                tabId = tabs[0].id;
            }
        }
        if (tabId) {
            try {
                const response = await browserAPI.tabs.sendMessage(tabId, {
                    command: "recaptureReader"
                });
                // The content script will handle updating status during recapture
                return response;
            } catch (error) {
                // If content script not loaded, inject it first
                if (error.message && error.message.includes('Receiving end does not exist')) {
                    console.log('Content script not loaded, injecting...');
                    await injectContentScript(tabId);
                    // Wait a bit for script to initialize
                    await new Promise(resolve => setTimeout(resolve, 100));
                    // Try again
                    const response = await browserAPI.tabs.sendMessage(tabId, {
                        command: "recaptureReader"
                    });
                    return response;
                } else {
                    throw error;
                }
            }
        }
    } catch (error) {
        console.error('Failed to recapture:', error);
        return { success: false, error: error.message };
    }
}

function updateTabStatus(tabId, status) {
    const currentStatus = tabStatus.get(tabId) || {};
    tabStatus.set(tabId, { ...currentStatus, ...status });
}

async function getTabStatus(tabId) {
    if (!tabId) {
        let tabs = await browserAPI.tabs.query({active: true, currentWindow: true});
        if (tabs[0]) {
            tabId = tabs[0].id;
        }
    }
    return tabStatus.get(tabId) || { isActive: false, isCapturing: false, captureProgress: '' };
}

// Handle messages from content script and popup
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.command === "captureVisibleTab") {
        // Capture the visible tab as a screenshot
        browserAPI.tabs.captureVisibleTab(null, {format: 'png'}, (dataUrl) => {
            if (browserAPI.runtime.lastError) {
                const errorMsg = browserAPI.runtime.lastError.message || 'Unknown capture error';
                console.error('Capture error:', errorMsg, browserAPI.runtime.lastError);
                sendResponse({error: errorMsg});
            } else {
                sendResponse({dataUrl: dataUrl});
            }
        });
        return true; // Keep the message channel open for async response
    } else if (message.command === "updateStatus") {
        // Content script is updating its status
        const tabId = sender.tab ? sender.tab.id : message.tabId;
        if (tabId) {
            updateTabStatus(tabId, {
                isActive: message.isActive,
                isCapturing: message.isCapturing,
                captureProgress: message.captureProgress
            });
        }
        sendResponse({ success: true });
        return false;
    } else if (message.command === "getStatus") {
        // Popup is requesting status
        getTabStatus(message.tabId).then(status => {
            sendResponse(status);
        });
        return true; // Keep the message channel open for async response
    } else if (message.command === "toggleReader") {
        // Popup is requesting to toggle reader
        toggleReader(message.tabId).then((response) => {
            sendResponse(response);
        });
        return true; // Keep the message channel open for async response
    } else if (message.command === "recaptureReader") {
        // Popup is requesting to recapture page
        recaptureReader(message.tabId).then((response) => {
            sendResponse(response);
        });
        return true; // Keep the message channel open for async response
    }
});

// Note: With a popup defined in manifest, the onClicked event is not triggered.
// The popup handles the toggle action instead.
// If you need direct icon click without popup, remove "default_popup" from manifest.json

// Listen for keyboard shortcut command
browserAPI.commands.onCommand.addListener((command) => {
    if (command === 'toggle-reader') {
        // Get the active tab and toggle reader
        browserAPI.tabs.query({active: true, currentWindow: true}).then(tabs => {
            if (tabs[0]) {
                toggleReader(tabs[0].id);
            }
        });
    }
});
