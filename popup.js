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
            // Get configurations
            const [syncConfig, localData] = await Promise.all([
                chrome.storage.sync.get(['wordSyncURL', 'wordUser', 'syncEnabled']),
                chrome.storage.local.get(['wordList'])
            ]);
            
            // Validate configuration
            if (!syncConfig.wordSyncURL) {
                console.error('Missing wordSyncURL in config:', syncConfig);
                throw new Error('Sync URL not configured');
            }
            if (!syncConfig.wordUser) {
                console.error('Missing wordUser in config:', syncConfig);
                throw new Error('User not configured');
            }

            if (showStatus) {
                syncStatus.textContent = 'Syncing...';
                syncButton.disabled = true;
            }

            const currentList = localData.wordList || [];

            // Send sync request to configured server
            const response = await fetch(syncConfig.wordSyncURL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Id': syncConfig.wordUser.id.toString(),
                    'User-Name': syncConfig.wordUser.name
                },
                body: JSON.stringify({
                    data: currentList
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const serverResponse = await response.json();
            
            if (serverResponse.code === 200) {
                // Merge server response with local deleted words
                const localList = await chrome.storage.local.get(['wordList']);
                const localDeletedWords = (localList.wordList || [])
                    .filter(item => item.del_flag);

                // Combine server words with local deleted words
                const mergedList = [
                    ...serverResponse.data,
                    ...localDeletedWords.filter(deletedWord => 
                        !serverResponse.data.some(serverWord => 
                            serverWord.word.toLowerCase() === deletedWord.word.toLowerCase()
                        )
                    )
                ];

                await chrome.storage.local.set({ wordList: mergedList });

                // Update all open tabs
                const tabs = await chrome.tabs.query({});
                for (const tab of tabs) {
                    try {
                        // Skip chrome:// pages, extension pages, and other restricted URLs
                        if (!tab.url || 
                            tab.url.startsWith('chrome://') || 
                            tab.url.startsWith('chrome-extension://') ||
                            tab.url.startsWith('about:') ||
                            tab.url.startsWith('edge://')) {
                            continue;
                        }
                        await chrome.tabs.sendMessage(tab.id, {
                            action: 'highlight',
                            wordList: mergedList
                        });
                    } catch (err) {
                        // Only log if it's not a connection error
                        if (!err.message.includes('Receiving end does not exist')) {
                            console.log(`Could not update tab ${tab.id}:`, err);
                        }
                    }
                }

                if (showStatus) {
                    syncStatus.textContent = 'Sync completed successfully!';
                    syncStatus.style.color = '#4CAF50';
                }
            } else {
                throw new Error(serverResponse.message || 'Sync failed');
            }
        } catch (error) {
            console.error('Sync error:', error);
            if (showStatus) {
                syncStatus.textContent = `Sync failed: ${error.message}`;
                syncStatus.style.color = '#f44336';
            }
        } finally {
            if (showStatus) {
                syncButton.disabled = false;
                setTimeout(() => {
                    syncStatus.textContent = '';
                    syncStatus.style.color = '#666';
                }, 3000);
            }
        }
    }

    // Listen for sync triggers from content script or background
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'triggerSync') {
            syncWithServer(false);  // Single point of sync
        }
    });
});
