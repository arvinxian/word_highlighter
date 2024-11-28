// Utility function for synchronization
async function syncWithServer() {
    try {
        // Get configurations
        const config = await chrome.storage.sync.get(['wordSyncURL', 'wordUser', 'wordList']);
        
        // Validate configuration
        if (!config.wordSyncURL || !config.wordUser) {
            console.log('Sync configuration not complete');
            return;
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
        }
    } catch (error) {
        console.error('Sync error:', error);
    }
}

// Listen for sync triggers from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'triggerSync') {
        syncWithServer();
    }
});

// Create context menu item
chrome.runtime.onInstalled.addListener(() => {
    console.log('Extension installed/updated - creating context menu');
    chrome.contextMenus.create({
        id: "addToHighlight",
        title: "Add to Highlight List",
        contexts: ["selection"]
    });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "addToHighlight") {
        // Check if site is enabled first
        const currentSite = new URL(tab.url).hostname;
        chrome.storage.sync.get(['ignoredSites'], (result) => {
            const ignoredSites = result.ignoredSites || [];
            if (ignoredSites.includes(currentSite)) {
                console.log('Site is disabled, not adding word');
                return;
            }
            
            const selectedText = info.selectionText.trim();
            console.log('Context menu clicked for text:', selectedText);
            
            // Get existing word list
            chrome.storage.sync.get(['wordList'], (result) => {
                const wordList = result.wordList || [];
                console.log('Current word list:', wordList);
                
                // Check if word already exists
                if (!wordList.some(item => item.word === selectedText)) {
                    // Create new word object
                    const newWord = {
                        word: selectedText,
                        user_id: 1, // You'll need to get this from your auth system
                        star: 0,
                        create_time: new Date().toISOString(),
                        update_time: new Date().toISOString(),
                        del_flag: false
                    };
                    
                    wordList.push(newWord);
                    console.log('Adding new word to list:', newWord);
                    
                    // Save updated list
                    chrome.storage.sync.set({ wordList }, () => {
                        console.log('Updated word list saved:', wordList);
                        // Trigger sync after adding word
                        syncWithServer();
                        // Notify content script to update highlighting
                        chrome.tabs.sendMessage(tab.id, {
                            action: 'highlight',
                            wordList: wordList
                        });
                    });
                } else {
                    console.log('Word already exists in list:', selectedText);
                }
            });
        });
    }
});
