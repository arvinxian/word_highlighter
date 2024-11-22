document.addEventListener('DOMContentLoaded', () => {
    const wordListTextarea = document.getElementById('wordList');
    const saveButton = document.getElementById('saveButton');

    // Load saved words
    chrome.storage.sync.get(['wordList'], (result) => {
        if (result.wordList) {
            wordListTextarea.value = result.wordList.join('\n');
        }
    });

    // Save words and trigger highlighting
    saveButton.addEventListener('click', () => {
        const words = wordListTextarea.value
            .split('\n')
            .map(word => word.trim())
            .filter(word => word.length > 0);

        // Save to storage
        chrome.storage.sync.set({ wordList: words }, () => {
            // Send message to content script to highlight words
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                chrome.tabs.sendMessage(
                    tabs[0].id,
                    { action: 'highlight', wordList: words },
                    (response) => {
                        if (chrome.runtime.lastError) {
                            console.error(chrome.runtime.lastError);
                        }
                    }
                );
            });
        });
    });
});
