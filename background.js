// Listen for sync triggers from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'triggerSync') {
        // Do nothing here, let popup.js handle sync
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
                        // Instead, send message to trigger sync
                        chrome.runtime.sendMessage({ action: 'triggerSync' });
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
