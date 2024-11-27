document.addEventListener('DOMContentLoaded', () => {
    const wordListTextarea = document.getElementById('wordList');
    const saveButton = document.getElementById('saveButton');
    const syncButton = document.getElementById('syncButton');
    const syncStatus = document.getElementById('syncStatus');
    const userNameSpan = document.getElementById('userName');
    const configButton = document.getElementById('configButton');

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

    // Initialize configurations on popup load
    initializeConfigs();

    // Handle configuration button click
    configButton.addEventListener('click', () => {
        chrome.tabs.create({ url: 'config.html' });
    });

    // Save words and trigger highlighting
    saveButton.addEventListener('click', () => {
        const newWords = wordListTextarea.value
            .split('\n')
            .map(line => line.replace(/\s*\(★\d+\)$/, '').trim()) // Remove star count from display
            .filter(word => word.length > 0);

        chrome.storage.sync.get(['wordList'], (result) => {
            let wordList = result.wordList || [];
            
            // Update existing words and add new ones
            const updatedList = newWords.map(word => {
                const existing = wordList.find(item => item.word === word);
                if (existing) {
                    return existing;
                }
                return {
                    word: word,
                    user_id: 1, // You'll need to get this from your auth system
                    star: 0,
                    create_time: new Date().toISOString(),
                    update_time: new Date().toISOString(),
                    del_flag: false
                };
            });

            chrome.storage.sync.set({ wordList: updatedList }, () => {
                if (chrome.runtime.lastError) {
                    console.error('Error saving words:', chrome.runtime.lastError);
                    return;
                }

                // Send message to content script to highlight words
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]) {
                        chrome.tabs.sendMessage(
                            tabs[0].id,
                            { action: 'highlight', wordList: updatedList }
                        );
                    }
                });
            });
        });
    });

    // Updated sync functionality
    syncButton.addEventListener('click', async () => {
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

            syncStatus.textContent = 'Syncing...';
            syncButton.disabled = true;

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
                // Update local storage with server's universal set
                await chrome.storage.sync.set({ wordList: serverResponse.data });

                // Update textarea display
                const activeWords = serverResponse.data
                    .filter(item => !item.del_flag)
                    .map(item => `${item.word} (★${item.star})`)
                    .join('\n');
                wordListTextarea.value = activeWords;

                // Update all open tabs
                const tabs = await chrome.tabs.query({});
                for (const tab of tabs) {
                    try {
                        await chrome.tabs.sendMessage(tab.id, {
                            action: 'highlight',
                            wordList: serverResponse.data
                        });
                    } catch (err) {
                        console.log(`Could not update tab ${tab.id}:`, err);
                    }
                }

                syncStatus.textContent = 'Sync completed successfully!';
                syncStatus.style.color = '#4CAF50';
            } else {
                throw new Error(serverResponse.message || 'Sync failed');
            }
        } catch (error) {
            console.error('Sync error:', error);
            syncStatus.textContent = `Sync failed: ${error.message}`;
            syncStatus.style.color = '#f44336';
        } finally {
            syncButton.disabled = false;
            setTimeout(() => {
                syncStatus.textContent = '';
                syncStatus.style.color = '#666';
            }, 3000);
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
});
