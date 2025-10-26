// Cross-browser compatibility
const browserAPI = typeof chrome !== 'undefined' ? chrome : browser;

const statusDiv = document.getElementById('status');
const toggleButton = document.getElementById('toggleButton');

// Poll for status updates
async function updateStatus() {
    try {
        const status = await browserAPI.runtime.sendMessage({ command: 'getStatus' });

        if (status) {
            // Remove all status classes
            statusDiv.className = 'status';

            if (status.isCapturing) {
                statusDiv.classList.add('capturing');
                statusDiv.innerHTML = `
                    <div class="status-text">Capturing content...</div>
                    <div class="progress-text">${status.captureProgress || 'Please wait...'}</div>
                `;
                toggleButton.disabled = true;
                toggleButton.textContent = 'Capturing...';
            } else if (status.isActive) {
                statusDiv.classList.add('reading');
                statusDiv.innerHTML = `
                    <div class="status-text">Reader Active</div>
                    <div class="progress-text">Reading in progress</div>
                `;
                toggleButton.disabled = false;
                toggleButton.textContent = 'Deactivate Reader';
            } else {
                statusDiv.classList.add('ready');
                statusDiv.innerHTML = `
                    <div class="status-text">Ready</div>
                    <div class="progress-text">Click the button below to activate</div>
                `;
                toggleButton.disabled = false;
                toggleButton.textContent = 'Activate Reader';
            }
        }
    } catch (error) {
        console.error('Failed to get status:', error);
    }
}

// Toggle reader on button click
toggleButton.addEventListener('click', async () => {
    try {
        const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) {
            const response = await browserAPI.runtime.sendMessage({
                command: 'toggleReader',
                tabId: tabs[0].id
            });

            // Use the response to immediately update UI with the actual state
            if (response && response.success) {
                // Update status immediately to reflect the new state
                updateStatus();
            }
        }
    } catch (error) {
        console.error('Failed to toggle reader:', error);
    }
});

// Update status on load and periodically
updateStatus();
setInterval(updateStatus, 500); // Poll every 500ms for smooth progress updates
