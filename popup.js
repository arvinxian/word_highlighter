document.addEventListener('DOMContentLoaded', () => {
    const wordListTextarea = document.getElementById('wordList');
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
            const result = await chrome.storage.sync.get(['wordList', 'wordSyncURL', 'wordUser']);
            
            // Set default sync URL if not set
            if (!result.wordSyncURL) {
                await chrome.storage.sync.set({ wordSyncURL: DEFAULT_SYNC_URL });
            }

            // Load user info
            if (result.wordUser) {
                userNameSpan.textContent = result.wordUser.name;
            }

            // Load word list
            if (result.wordList) {
                const activeWords = result.wordList
                    .filter(item => !item.del_flag)
                    .map(item => `${item.word} (★${item.star})`)
                    .join('\n');
                wordListTextarea.value = activeWords;
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

    // Save words and trigger highlighting
    saveButton.addEventListener('click', async () => {
        const newWords = wordListTextarea.value
            .split('\n')
            .map(line => line.replace(/\s*\(★\d+\)$/, '').trim())
            .filter(word => word.length > 0);

        try {
            const { wordList = [] } = await chrome.storage.sync.get(['wordList']);
            
            // Update existing words and add new ones
            const updatedList = newWords.map(word => {
                const existing = wordList.find(item => 
                    item.word.toLowerCase() === word.toLowerCase()
                );
                if (existing) {
                    if (existing.del_flag) {
                        return {
                            ...existing,
                            del_flag: false,
                            star: 0,
                            update_time: new Date().toISOString()
                        };
                    }
                    return existing;
                }
                return {
                    word: word,
                    user_id: 1,
                    star: 0,
                    create_time: new Date().toISOString(),
                    update_time: new Date().toISOString(),
                    del_flag: false
                };
            });

            // Keep deleted words that aren't in the new list
            const deletedWords = wordList.filter(item => 
                item.del_flag && !newWords.some(word => 
                    word.toLowerCase() === item.word.toLowerCase()
                )
            );

            const finalList = [...updatedList, ...deletedWords];

            await chrome.storage.sync.set({ wordList: finalList });
            chrome.runtime.sendMessage({ action: 'triggerSync' });  // Trigger sync through background script

            // Send message to content script to highlight words
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                chrome.tabs.sendMessage(
                    tab.id,
                    { action: 'highlight', wordList: finalList }
                );
            }
        } catch (error) {
            console.error('Error saving words:', error);
        }
    });

    // Updated sync functionality
    syncButton.addEventListener('click', () => syncWithServer(true));

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
            const config = await chrome.storage.sync.get(['wordSyncURL', 'wordUser', 'wordList']);
            
            // Validate configuration
            if (!config.wordSyncURL) {
                throw new Error('Sync URL not configured');
            }
            if (!config.wordUser) {
                throw new Error('User not configured');
            }

            if (showStatus) {
                syncStatus.textContent = 'Syncing...';
                syncButton.disabled = true;
            }

            const currentList = config.wordList || [];

            // Send sync request to configured server
            const response = await fetch(config.wordSyncURL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Id': config.wordUser.id.toString(),
                    'User-Name': config.wordUser.name
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
                const localList = await chrome.storage.sync.get(['wordList']);
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

                await chrome.storage.sync.set({ wordList: mergedList });

                // Update textarea display if showing status
                if (showStatus) {
                    const activeWords = serverResponse.data
                        .filter(item => !item.del_flag)
                        .map(item => `${item.word} (★${item.star})`)
                        .join('\n');
                    wordListTextarea.value = activeWords;
                }

                // Update all open tabs
                const tabs = await chrome.tabs.query({});
                for (const tab of tabs) {
                    try {
                        await chrome.tabs.sendMessage(tab.id, {
                            action: 'highlight',
                            wordList: mergedList
                        });
                    } catch (err) {
                        console.log(`Could not update tab ${tab.id}:`, err);
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

    // Listen for sync triggers from content script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'triggerSync') {
            syncWithServer(false);  // Sync without showing status
        }
    });
});
