document.addEventListener('DOMContentLoaded', () => {
    const wordListTextarea = document.getElementById('wordList');
    const saveButton = document.getElementById('saveButton');

    console.log('Popup loaded, fetching word list...');

    // Load saved words
    chrome.storage.sync.get(['wordList'], (result) => {
        console.log('Retrieved word list in popup:', result);
        if (result.wordList) {
            wordListTextarea.value = result.wordList.join('\n');
            console.log('Populated textarea with words:', result.wordList);
        } else {
            console.log('No existing word list found');
        }
    });

    // Save words and trigger highlighting
    saveButton.addEventListener('click', () => {
        console.log('Save button clicked');
        const words = wordListTextarea.value
            .split('\n')
            .map(word => word.trim())
            .filter(word => word.length > 0);

        console.log('Processed words to save:', words);

        // Save to storage
        chrome.storage.sync.set({ wordList: words }, () => {
            if (chrome.runtime.lastError) {
                console.error('Error saving words:', chrome.runtime.lastError);
                return;
            }
            console.log('Successfully saved words to storage');

            // Send message to content script to highlight words
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) {
                    console.log('Sending highlight message to content script');
                    chrome.tabs.sendMessage(
                        tabs[0].id,
                        { action: 'highlight', wordList: words },
                        (response) => {
                            if (chrome.runtime.lastError) {
                                console.error('Error sending message:', chrome.runtime.lastError);
                            } else {
                                console.log('Highlight message sent successfully:', response);
                            }
                        }
                    );
                } else {
                    console.error('No active tab found');
                }
            });
        });
    });
});
