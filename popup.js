document.addEventListener('DOMContentLoaded', () => {
    const saveButton = document.getElementById('saveButton');
    const syncButton = document.getElementById('syncButton');
    const syncStatus = document.getElementById('syncStatus');
    const userNameSpan = document.getElementById('userName');
    const configButton = document.getElementById('configButton');
    const enableSwitch = document.getElementById('enableSwitch');
    let currentUrl = '';

    // Default sync URL
    const DEFAULT_SYNC_URL = 'http://localhost:8080/api/v1/stars/sync';

    // Initialize and load configurations
    async function initializeConfigs() {
        try {
            const result = await chrome.storage.sync.get(['wordSyncURL', 'wordUser', 'syncEnabled']);
            
            // Initialize sync configuration if not set
            const defaults = {
                wordSyncURL: result.wordSyncURL || DEFAULT_SYNC_URL,
                syncEnabled: result.syncEnabled || false
            };
            
            await chrome.storage.sync.set(defaults);
            console.log('Initialized sync configuration:', defaults);  // Debug log

            // Load user info
            if (result.wordUser) {
                userNameSpan.textContent = result.wordUser.name;
            }
        } catch (error) {
            console.error('Error initializing configurations:', error);
        }
    }

    // Get current tab URL
    async function getCurrentTab() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return new URL(tab.url).hostname;
    }

    // Initialize switch state
    async function initializeSwitch() {
        try {
            currentUrl = await getCurrentTab();
            const { ignoredSites = [] } = await chrome.storage.sync.get('ignoredSites');
            enableSwitch.checked = !ignoredSites.includes(currentUrl);
        } catch (error) {
            console.error('Error initializing switch:', error);
        }
    }

    // Handle switch change
    enableSwitch.addEventListener('change', async () => {
        try {
            const { ignoredSites = [] } = await chrome.storage.sync.get('ignoredSites');
            const isEnabled = enableSwitch.checked;
            
            let updatedSites;
            if (isEnabled) {
                // Remove site from ignored list
                updatedSites = ignoredSites.filter(site => site !== currentUrl);
            } else {
                // Add site to ignored list
                updatedSites = [...ignoredSites, currentUrl];
            }
            
            await chrome.storage.sync.set({ ignoredSites: updatedSites });
            
            // Get current tab and refresh it
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            await chrome.tabs.sendMessage(tab.id, {
                action: isEnabled ? 'enable' : 'disable'
            });
            chrome.tabs.reload(tab.id);
            window.close();
        } catch (error) {
            console.error('Error updating ignored sites:', error);
        }
    });

    // Initialize configurations and switch
    async function initialize() {
        await initializeConfigs();
        await initializeSwitch();
    }

    // Initialize everything
    initialize();

    // Handle configuration button click
    configButton.addEventListener('click', () => {
        chrome.tabs.create({ url: 'config.html' }, () => {
            window.close(); // Close the popup after opening config page
        });
    });

    // Updated sync functionality
    syncButton.addEventListener('click', async () => {
        // Get all required sync configurations
        const config = await chrome.storage.sync.get(['syncEnabled', 'wordSyncURL', 'wordUser']);
        console.log('Sync config:', {
            syncEnabled: config.syncEnabled,
            wordSyncURL: config.wordSyncURL,
            hasUser: !!config.wordUser,
            userDetails: config.wordUser
        });
        
        if (!config.wordSyncURL) {
            console.warn('No sync URL found in config');
        }

        if (!config.syncEnabled) {
            syncStatus.textContent = 'Sync is disabled. Enable it in settings.';
            syncStatus.style.color = '#f44336';
            setTimeout(() => {
                syncStatus.textContent = '';
                syncStatus.style.color = '#666';
            }, 3000);
            return;
        }

        // Validate sync configuration
        if (!config.wordSyncURL || !config.wordUser) {
            syncStatus.textContent = 'Sync configuration incomplete. Please check settings.';
            syncStatus.style.color = '#f44336';
            setTimeout(() => {
                syncStatus.textContent = '';
                syncStatus.style.color = '#666';
            }, 3000);
            return;
        }

        // Get word list from local storage
        const { wordList } = await chrome.storage.local.get(['wordList']);
        
        console.log('Passing to syncWithServer:', {
            wordSyncURL: config.wordSyncURL,
            hasUser: !!config.wordUser,
            wordListLength: wordList ? wordList.length : 0
        });

        // Trigger sync with local data
        try {
            await syncWithServer(true);
        } catch (error) {
            console.error('Error during sync:', error);
            console.error('Sync error details:', {
                hasURL: !!config.wordSyncURL,
                hasUser: !!config.wordUser,
                errorMessage: error.message
            });
        }
    });

    // Initialize default user if not exists (for development)
    chrome.storage.sync.get(['wordUser'], (result) => {
        if (!result.wordUser) {
            const defaultUser = {
                id: 1,
                name: "xy",
                token: 3,
                create_time: new Date().toISOString(),
                update_time: new Date().toISOString(),
                del_flag: false
            };
            chrome.storage.sync.set({ wordUser: defaultUser }, () => {
                console.log('Default user initialized:', defaultUser);
                userNameSpan.textContent = defaultUser.name;
            });
        }
    });

    // Utility function for synchronization
    async function syncWithServer(showStatus = true) {
        try {
            console.log('[Sync Debug] Starting sync operation from popup');
            // Delegate sync to background script
            chrome.runtime.sendMessage({ action: 'triggerSync' });
            
            if (showStatus) {
                syncStatus.textContent = 'Sync initiated...';
                syncStatus.style.color = '#4CAF50';
                setTimeout(() => {
                    syncStatus.textContent = '';
                    syncStatus.style.color = '#666';
                }, 3000);
            }
        } catch (error) {
            console.error('[Sync Debug] Sync operation failed:', error);
            if (showStatus) {
                syncStatus.textContent = `Sync failed: ${error.message}`;
                syncStatus.style.color = '#f44336';
            }
        }
    }

    // Listen for sync triggers from content script or background
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'triggerSync') {
            console.log('[Sync Debug] Received sync trigger from:', sender.tab ? 
                `tab ${sender.tab.id}` : 'extension');
            syncWithServer(false);  // Single point of sync
        }
    });
});
