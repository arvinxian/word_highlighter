document.addEventListener('DOMContentLoaded', () => {
    const syncUrlInput = document.getElementById('syncUrl');
    const saveSyncUrlButton = document.getElementById('saveSyncUrl');
    const urlStatus = document.getElementById('urlStatus');

    // Default sync URL
    const DEFAULT_SYNC_URL = 'http://localhost:8080/api/v1/stars/sync';

    // Load current configuration
    async function loadConfig() {
        try {
            const result = await chrome.storage.sync.get(['wordSyncURL']);
            syncUrlInput.value = result.wordSyncURL || DEFAULT_SYNC_URL;
        } catch (error) {
            console.error('Error loading configuration:', error);
        }
    }

    // Initialize configuration
    loadConfig();

    // Handle sync URL save
    saveSyncUrlButton.addEventListener('click', async () => {
        const url = syncUrlInput.value.trim();
        
        if (!url) {
            urlStatus.textContent = 'URL cannot be empty';
            urlStatus.style.color = '#f44336';
            return;
        }

        try {
            // Validate URL format
            new URL(url);
            
            await chrome.storage.sync.set({ wordSyncURL: url });
            urlStatus.textContent = 'URL saved successfully';
            urlStatus.style.color = '#4CAF50';
        } catch (error) {
            urlStatus.textContent = 'Invalid URL format';
            urlStatus.style.color = '#f44336';
        }

        // Clear status message after 3 seconds
        setTimeout(() => {
            urlStatus.textContent = '';
        }, 3000);
    });
}); 