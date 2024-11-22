// Function to highlight words in the page
function highlightWords(wordList) {
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

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'highlight') {
        highlightWords(request.wordList);
        sendResponse({status: 'success'});
    }
});

// Get initial word list from storage and highlight
chrome.storage.sync.get(['wordList'], (result) => {
    if (result.wordList) {
        highlightWords(result.wordList);
    }
});
