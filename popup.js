document.addEventListener('DOMContentLoaded', () => {
    const wordListTextarea = document.getElementById('wordList');
    const saveButton = document.getElementById('saveButton');

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
                // ... rest of the save code ...
            });
        });
    });
});
