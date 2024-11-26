document.addEventListener('DOMContentLoaded', () => {
    const wordListTextarea = document.getElementById('wordList');
    const saveButton = document.getElementById('saveButton');
    const syncButton = document.getElementById('syncButton');
    const syncStatus = document.getElementById('syncStatus');

    // Load saved words
    chrome.storage.sync.get(['wordList'], (result) => {
        console.log('Retrieved word list in popup:', result);
        if (result.wordList) {
            // Only show active words (not deleted)
            const activeWords = result.wordList
                .filter(item => !item.del_flag)
                .map(item => `${item.word} (★${item.star})`)
                .join('\n');
            wordListTextarea.value = activeWords;
        }
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

    // Add sync functionality
    syncButton.addEventListener('click', async () => {
        try {
            syncStatus.textContent = 'Syncing...';
            syncButton.disabled = true;

            // Get current word list
            const result = await chrome.storage.sync.get(['wordList']);
            const currentList = result.wordList || [];

            // Send sync request to server
            const response = await fetch('http://localhost:8080/api/v1/stars/sync', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
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
                syncStatus.style.color = '#4CAF50'; // Green color for success
            } else {
                throw new Error(serverResponse.message || 'Sync failed');
            }
        } catch (error) {
            console.error('Sync error:', error);
            syncStatus.textContent = `Sync failed: ${error.message}`;
            syncStatus.style.color = '#f44336'; // Red color for error
        } finally {
            syncButton.disabled = false;
            // Clear status message after 3 seconds
            setTimeout(() => {
                syncStatus.textContent = '';
                syncStatus.style.color = '#666';
            }, 3000);
        }
    });
});
