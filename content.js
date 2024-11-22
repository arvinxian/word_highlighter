// Global flag to prevent popup from showing while handling clicks
let isHandlingClick = false;

// Function to highlight words in the page
function highlightWords(wordList) {
    console.log('Highlighting words:', wordList);
    // Create a regular expression from the word list
    const regex = new RegExp(`\\b(${wordList.join('|')})\\b`, 'gi');

    // Walk through all text nodes in the document
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );

    const nodesToHighlight = [];
    let node;
    while (node = walker.nextNode()) {
        // Skip if parent is script, style, or already highlighted
        if (
            node.parentElement.tagName === 'SCRIPT' ||
            node.parentElement.tagName === 'STYLE' ||
            node.parentElement.classList.contains('word-highlighter-highlight')
        ) {
            continue;
        }

        if (regex.test(node.textContent)) {
            nodesToHighlight.push(node);
        }
    }

    console.log('Found nodes to highlight:', nodesToHighlight.length);
    // Process the nodes that need highlighting
    nodesToHighlight.forEach(node => {
        const span = document.createElement('span');
        span.innerHTML = node.textContent.replace(
            regex,
            match => `<span class="word-highlighter-highlight">${match}</span>`
        );
        node.parentNode.replaceChild(span, node);
    });
}

// Create and show popup
function showAddWordPopup(selectedText, x, y) {
    // Remove any existing popup
    const existingPopup = document.querySelector('.word-highlighter-popup');
    if (existingPopup) {
        existingPopup.remove();
    }

    // Create popup element
    const popup = document.createElement('div');
    popup.className = 'word-highlighter-popup';
    popup.innerHTML = `
        <div class="popup-content">
            <p>Add "${selectedText}" to highlight list?</p>
            <button class="popup-btn" id="addWordYes">Yes</button>
            <button class="popup-btn" id="addWordNo">No</button>
        </div>
    `;

    // Position popup
    popup.style.position = 'fixed';
    popup.style.left = `${x}px`;
    popup.style.top = `${y}px`;

    // Function to handle word addition
    const handleAddWord = () => {
        console.log('User clicked Yes to add word:', selectedText);
        
        // Check if chrome.storage is available
        if (!chrome.storage || !chrome.storage.sync) {
            console.error('Chrome storage API is not available');
            return;
        }

        chrome.storage.sync.get(['wordList'], (result) => {
            console.log('Retrieved current word list:', result);
            const wordList = result.wordList || [];
            console.log('Parsed word list:', wordList);

            if (!wordList.includes(selectedText)) {
                wordList.push(selectedText);
                console.log('Added new word, saving list:', wordList);

                chrome.storage.sync.set({ wordList: wordList }, () => {
                    if (chrome.runtime.lastError) {
                        console.error('Error saving word list:', chrome.runtime.lastError);
                        return;
                    }
                    console.log('Successfully saved word list:', wordList);
                    highlightWords(wordList);
                });
            } else {
                console.log('Word already exists in list:', selectedText);
            }
        });
    };

    // Add event listeners
    document.body.appendChild(popup);
    
    const yesButton = document.getElementById('addWordYes');
    const noButton = document.getElementById('addWordNo');

    // Using mousedown instead of click to handle the event before mouseup
    yesButton.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleAddWord();
        popup.remove();
    });

    noButton.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        popup.remove();
    });

    // Prevent mouseup from triggering on the popup
    popup.addEventListener('mouseup', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    // Close popup when clicking outside
    const handleOutsideClick = (e) => {
        if (!popup.contains(e.target)) {
            popup.remove();
            document.removeEventListener('mousedown', handleOutsideClick);
        }
    };
    
    document.addEventListener('mousedown', handleOutsideClick);
}

// Variable to track if we should show the popup
let lastMouseDownTarget = null;

// Track mousedown target
document.addEventListener('mousedown', (e) => {
    lastMouseDownTarget = e.target;
});

// Listen for text selection
document.addEventListener('mouseup', (e) => {
    // Don't show popup if the mouseup was on the popup itself
    if (e.target.closest('.word-highlighter-popup')) {
        return;
    }

    // Don't show popup if mousedown and mouseup were on different elements (dragging)
    if (lastMouseDownTarget !== e.target) {
        return;
    }

    const selectedText = window.getSelection().toString().trim();
    if (selectedText && selectedText.length > 0) {
        console.log('Text selected:', selectedText);
        // Show popup near the mouse position
        showAddWordPopup(selectedText, e.clientX, e.clientY);
    }
});

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Received message:', request);
    if (request.action === 'highlight') {
        highlightWords(request.wordList);
        sendResponse({status: 'success'});
    }
});

// Get initial word list from storage and highlight
chrome.storage.sync.get(['wordList'], (result) => {
    console.log('Initial word list:', result.wordList);
    if (result.wordList) {
        highlightWords(result.wordList);
    }
});
