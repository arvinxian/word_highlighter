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
    const selectedText = info.selectionText.trim();
    console.log('Context menu clicked for text:', selectedText);
    
    // Get existing word list
    chrome.storage.sync.get(['wordList'], (result) => {
      const wordList = result.wordList || [];
      console.log('Current word list:', wordList);
      
      // Add new word if it's not already in the list
      if (!wordList.includes(selectedText)) {
        wordList.push(selectedText);
        console.log('Adding new word to list:', selectedText);
        
        // Save updated list
        chrome.storage.sync.set({ wordList }, () => {
          console.log('Updated word list saved:', wordList);
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
  }
});
