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
