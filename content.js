// Global flag to prevent popup from showing while handling clicks
let isHandlingClick = false;

// Function to highlight words in the page
function highlightWords(wordList) {
    console.log('Highlighting words:', wordList);
    // Create a regular expression from the word list
    const words = wordList
        .filter(item => !item.del_flag)
        .map(item => item.word);
    const regex = new RegExp(`\\b(${words.join('|')})\\b`, 'gi');

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
            match => {
                const wordObj = wordList.find(item => 
                    item.word.toLowerCase() === match.toLowerCase()
                );
                return `<span 
                    class="word-highlighter-highlight" 
                    id="${match.toLowerCase()}"
                    data-star="${wordObj.star}"
                    data-user-id="${wordObj.user_id}"
                >${match}</span>`;
            }
        );
        node.parentNode.replaceChild(span, node);
    });

    // Add hover event listeners to highlighted words
    document.querySelectorAll('.word-highlighter-highlight').forEach(element => {
        element.addEventListener('mouseenter', (e) => {
            const wordId = e.target.id;  // Get the word directly from the element's ID
            showRemoveWordPopup(wordId, e.target.getBoundingClientRect());
        });
    });
}

// Add this function to fetch word definition
async function fetchWordDefinition(word) {
    try {
        const config = await chrome.storage.sync.get([
            'openaiKey',
            'openaiBaseUrl',
            'openaiPrompt'
        ]);

        if (!config.openaiKey || !config.openaiBaseUrl || !config.openaiPrompt) {
            throw new Error('OpenAI configuration not found');
        }

        const prompt = config.openaiPrompt.replace('{word}', word);
        
        const response = await fetch(config.openaiBaseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.openaiKey}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini-2024-07-18",
                messages: [{
                    role: "user",
                    content: prompt
                }]
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error('Error fetching definition:', error);
        return `<p class="error">Error fetching definition: ${error.message}</p>`;
    }
}

// Function to show popup for removing words
function showRemoveWordPopup(wordId, rect) {
    // Remove any existing popup
    const existingPopup = document.querySelector('.word-highlighter-remove-popup');
    if (existingPopup) {
        existingPopup.remove();
    }

    // Create popup element with loading state
    const popup = document.createElement('div');
    popup.className = 'word-highlighter-popup word-highlighter-remove-popup';
    popup.innerHTML = `
        <div class="popup-content">
            <p>Remove "${wordId}" from highlight list?</p>
            <div class="definition-container">
                <p>Loading definition...</p>
            </div>
            <button class="popup-btn" id="removeWordYes">Yes</button>
            <button class="popup-btn" id="removeWordNo">No</button>
        </div>
    `;

    // Position popup near the word
    popup.style.left = `${rect.left}px`;
    popup.style.top = `${rect.bottom + 5}px`;

    // Add to document and fetch definition
    document.body.appendChild(popup);
    
    // Fetch and display definition
    const definitionContainer = popup.querySelector('.definition-container');
    fetchWordDefinition(wordId).then(definition => {
        definitionContainer.innerHTML = definition;
    });

    // Add event listeners
    document.body.appendChild(popup);
    
    const yesButton = popup.querySelector('#removeWordYes');
    const noButton = popup.querySelector('#removeWordNo');

    let isOverPopup = false;
    let isOverWord = true;  // Start as true since we're showing from word hover

    const hidePopup = () => {
        popup.remove();
        // Remove the document click listener when popup is hidden
        document.removeEventListener('click', handleOutsideClick);
    };

    // Handle clicks outside the popup
    const handleOutsideClick = (e) => {
        const clickedElement = e.target;
        // Check if click is outside both the popup and the highlighted word
        if (!popup.contains(clickedElement) && clickedElement.id !== wordId) {
            hidePopup();
        }
    };

    // Add document click listener
    document.addEventListener('click', handleOutsideClick);

    // Track mouse entering/leaving the popup
    popup.addEventListener('mouseenter', () => {
        isOverPopup = true;
    });

    popup.addEventListener('mouseleave', () => {
        isOverPopup = false;
    });

    // Track mouse leaving the word
    const wordElement = document.getElementById(wordId);
    if (wordElement) {
        wordElement.addEventListener('mouseleave', () => {
            isOverWord = false;
        });
    }

    yesButton.addEventListener('click', () => {
        chrome.storage.sync.get(['wordList'], (result) => {
            const wordList = result.wordList || [];
            const updatedList = wordList.map(item => {
                if (item.word.toLowerCase() === wordId) {
                    return {
                        ...item,
                        del_flag: true,
                        update_time: new Date().toISOString()
                    };
                }
                return item;
            });
            
            chrome.storage.sync.set({ wordList: updatedList }, () => {
                if (chrome.runtime.lastError) {
                    console.error('Error saving updated word list:', chrome.runtime.lastError);
                    return;
                }
                console.log('Word removed from list:', wordId);

                // Find all elements with this word's highlight
                const highlightedElements = document.querySelectorAll(`#${wordId}`);
                highlightedElements.forEach(element => {
                    // Get the parent span that wraps our highlighted word
                    const parentSpan = element.parentElement;
                    if (parentSpan && parentSpan.childNodes.length === 1) {
                        // If this is the only highlighted word in the span, replace the span with just the text
                        const textNode = document.createTextNode(element.textContent);
                        parentSpan.parentNode.replaceChild(textNode, parentSpan);
                    } else {
                        // If there are other elements, just replace this highlight with its text
                        const textNode = document.createTextNode(element.textContent);
                        element.parentNode.replaceChild(textNode, element);
                    }
                });

                // Refresh the highlighting for remaining words
                highlightWords(updatedList);
                hidePopup();
            });
        });
    });

    noButton.addEventListener('click', () => {
        hidePopup();
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
        
        if (!chrome.storage || !chrome.storage.sync) {
            console.error('Chrome storage API is not available');
            return;
        }

        chrome.storage.sync.get(['wordList'], (result) => {
            console.log('Retrieved current word list:', result);
            const wordList = result.wordList || [];
            console.log('Parsed word list:', wordList);

            // Check if word exists (including deleted ones)
            const existingWord = wordList.find(item => 
                item.word.toLowerCase() === selectedText.toLowerCase()
            );

            if (!existingWord) {
                const newWord = {
                    word: selectedText,
                    user_id: 1,
                    star: 0,
                    create_time: new Date().toISOString(),
                    update_time: new Date().toISOString(),
                    del_flag: false
                };
                wordList.push(newWord);
            } else if (existingWord.del_flag) {
                // Reactivate deleted word
                existingWord.del_flag = false;
                existingWord.star = 0;
                existingWord.update_time = new Date().toISOString();
            } else {
                console.log('Word already exists and is active:', selectedText);
                return;
            }

            chrome.storage.sync.set({ wordList }, () => {
                if (chrome.runtime.lastError) {
                    console.error('Error saving word list:', chrome.runtime.lastError);
                    return;
                }
                console.log('Successfully saved word list:', wordList);
                highlightWords(wordList);
            });
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
        // Remove all existing highlights first
        document.querySelectorAll('.word-highlighter-highlight').forEach(element => {
            const textNode = document.createTextNode(element.textContent);
            element.parentNode.replaceChild(textNode, element);
        });

        // Apply new highlights
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
