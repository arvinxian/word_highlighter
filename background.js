// Utility function for synchronization
async function syncWithServer(showStatus = true) {
    try {
        console.log('[Sync Debug] Starting sync operation from background');
        // Get configurations
        const [syncConfig, localData] = await Promise.all([
            chrome.storage.sync.get(['wordSyncURL', 'wordUser', 'syncEnabled']),
            chrome.storage.local.get(['wordList'])
        ]);
        
        console.log('[Sync Debug] Sync config loaded:', {
            hasURL: !!syncConfig.wordSyncURL,
            hasUser: !!syncConfig.wordUser,
            isEnabled: syncConfig.syncEnabled,
            wordCount: localData.wordList ? localData.wordList.length : 0
        });
        
        // Validate configuration
        if (!syncConfig.wordSyncURL) {
            console.error('[Sync Debug] Sync URL not configured');
            throw new Error('Sync URL not configured');
        }
        if (!syncConfig.wordUser) {
            console.error('[Sync Debug] User not configured');
            throw new Error('User not configured');
        }
        
        if (!syncConfig.syncEnabled) {
            console.log('[Sync Debug] Sync is disabled, skipping operation');
            return;
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
        
        console.log('[Sync Debug] Server response status:', response.status);
        
        if (!response.ok) {
            console.error('[Sync Debug] Server response not OK:', response.status);
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const serverResponse = await response.json();
        console.log('[Sync Debug] Server response:', {
            code: serverResponse.code,
            dataLength: serverResponse.data ? serverResponse.data.length : 0
        });
        
        if (serverResponse.code === 200) {
            await chrome.storage.local.set({ wordList: serverResponse.data });
            
            // Update all tabs with new word list
            const tabs = await chrome.tabs.query({});
            for (const tab of tabs) {
                try {
                    if (!tab.url || 
                        tab.url.startsWith('chrome://') || 
                        tab.url.startsWith('chrome-extension://') ||
                        tab.url.startsWith('about:') ||
                        tab.url.startsWith('edge://')) {
                        continue;
                    }
                    await chrome.tabs.sendMessage(tab.id, {
                        action: 'updateWordList',
                        wordList: serverResponse.data
                    });
                } catch (err) {
                    if (!err.message.includes('Receiving end does not exist')) {
                        console.log(`Could not update tab ${tab.id}:`, err);
                    }
                }
            }
        }
    } catch (error) {
        console.error('[Sync Debug] Sync operation failed:', error);
    }
}

// Listen for sync triggers from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'triggerSync') {
        console.log('[Sync Debug] Received sync trigger in background from:', 
            sender.tab ? `tab ${sender.tab.id}` : 'extension');
        syncWithServer();  // Handle sync in background script
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
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "addToHighlight") {
        try {
            // Check if site is enabled
            const currentSite = new URL(tab.url).hostname;
            const { ignoredSites = [] } = await chrome.storage.sync.get('ignoredSites');
            
            if (ignoredSites.includes(currentSite)) {
                console.log('Site is disabled, not adding word');
                return;
            }
            
            const selectedText = info.selectionText.trim();
            const { wordList = [] } = await chrome.storage.local.get('wordList');
            
            // Check if word already exists
            if (!wordList.some(item => item.word.toLowerCase() === selectedText.toLowerCase())) {
                const newWord = {
                    word: selectedText,
                    user_id: 1,
                    star: 0,
                    create_time: new Date().toISOString(),
                    update_time: new Date().toISOString(),
                    del_flag: false
                };
                
                const updatedList = [...wordList, newWord];
                
                // Save updated list
                await chrome.storage.local.set({ wordList: updatedList });
                
                // Notify content script immediately
                await chrome.tabs.sendMessage(tab.id, {
                    action: 'updateWordList',
                    wordList: updatedList
                });
                
                // Trigger sync after successful update
                chrome.runtime.sendMessage({ action: 'triggerSync' });
            }
        } catch (error) {
            console.error('Error adding word:', error);
        }
    }
});
