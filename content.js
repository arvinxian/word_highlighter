// Global variable to track if extension is enabled for current site
let isExtensionEnabled = true;

// Global flag to prevent popup from showing while handling clicks
let isHandlingClick = false;

// Initialize extension state
async function initializeExtensionState() {
    isExtensionEnabled = await checkSiteStatus();
}

// Check if current site is ignored
async function checkSiteStatus() {
    try {
        const { ignoredSites = [] } = await chrome.storage.sync.get('ignoredSites');
        const currentSite = window.location.hostname;
        return !ignoredSites.includes(currentSite);
    } catch (error) {
        console.error('Error checking site status:', error);
        return true; // Default to enabled if error
    }
}

// Function to highlight words in the page
function highlightWords(wordList) {
    if (!isExtensionEnabled) return;

    console.log('Highlighting words:', wordList);
    // Create a regular expression from the word list
    const words = wordList
        .filter(item => item && typeof item === 'object')
        .filter(item => !item.del_flag)
        .map(item => item.word)
        .filter(word => word && typeof word === 'string');
    
    if (words.length === 0) return;
    
    // Create regex pattern with word boundaries and escape special characters
    const escapedWords = words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`\\b(${escapedWords.join('|')})\\b`, 'gi');

    // Walk through all text nodes in the document
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                // Skip if parent is script, style, already highlighted, or inside a highlight
                if (
                    node.parentElement.tagName === 'SCRIPT' ||
                    node.parentElement.tagName === 'STYLE' ||
                    node.parentElement.tagName === 'TEXTAREA' ||
                    node.parentElement.tagName === 'INPUT' ||
                    node.parentElement.classList.contains('word-highlighter-highlight') ||
                    node.parentElement.closest('.word-highlighter-highlight') ||
                    // Skip if node is empty or only whitespace
                    !node.textContent.trim()
                ) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        },
        false
    );

    const nodesToHighlight = [];
    let node;
    while (node = walker.nextNode()) {
        // Reset regex lastIndex before testing
        regex.lastIndex = 0;
        const text = node.textContent;
        if (regex.test(text)) {
            regex.lastIndex = 0;  // Reset again for future use
            nodesToHighlight.push(node);
        }
    }

    console.log('Found nodes to highlight:', nodesToHighlight.length);
    // Process the nodes that need highlighting
    nodesToHighlight.forEach(node => {
        const span = document.createElement('span');
        regex.lastIndex = 0;  // Reset regex state before replace
        span.innerHTML = node.textContent.replace(
            regex,
            match => {
                const wordObj = wordList.find(item => 
                    item.word.toLowerCase() === match.toLowerCase()
                );
                // Safety check: if word object not found or invalid, return original text
                if (!wordObj || typeof wordObj !== 'object') {
                    console.warn('Word object not found for:', match);
                    return match;
                }
                return `<span 
                    class="word-highlighter-highlight" 
                    id="${match.toLowerCase()}"
                    data-star="${wordObj.star || 0}"
                    data-user-id="${wordObj.user_id || 0}"
                >${match}</span>`;
            }
        );
        node.parentNode.replaceChild(span, node);
    });

    // Add hover event listeners to highlighted words
    addHighlightListeners();
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

    // Get current word data
    chrome.storage.local.get(['wordList'], (result) => {
        const wordList = result.wordList || [];
        const wordData = wordList.find(item => 
            item.word.toLowerCase() === wordId.toLowerCase()
        );
        
        if (!wordData) return;

        // Create popup element with loading state
        const popup = document.createElement('div');
        popup.className = 'word-highlighter-popup word-highlighter-remove-popup';
        popup.innerHTML = `
            <div class="popup-content">
                <div class="heart-container">
                    ${createHeartSymbols(wordData.star)}
                </div>
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

        // Add to document
        document.body.appendChild(popup);

        // Add heart click handlers
        setupHeartHandlers(popup, wordData, wordList);

        // Fetch and display definition
        const definitionContainer = popup.querySelector('.definition-container');
        fetchWordDefinition(wordId).then(definition => {
            definitionContainer.innerHTML = definition;
        });

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
            chrome.storage.local.get(['wordList'], (result) => {
                const wordList = result.wordList || [];
                const updatedList = wordList.map(item => {
                    if (item.word.toLowerCase() === wordId) {
                        return {
                            ...item,
                            del_flag: true,
                            star: 0,
                            update_time: new Date().toISOString()
                        };
                    }
                    return item;
                });
                
                chrome.storage.local.set({ wordList: updatedList }, () => {
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

                    // Trigger sync after removing word
                    chrome.runtime.sendMessage({ action: 'triggerSync' });

                    // Refresh the highlighting for remaining words
                    highlightWords(updatedList);
                    hidePopup();
                });
            });
        });

        noButton.addEventListener('click', () => {
            hidePopup();
        });
    });
}

// Create heart symbols HTML
function createHeartSymbols(starCount) {
    let html = '';
    // Add filled hearts
    for (let i = 0; i < starCount; i++) {
        html += `<span class="heart filled" data-index="${i}"></span>`;
    }
    // Add hollow heart
    html += `<span class="heart hollow"></span>`;
    return html;
}

// Setup heart click handlers
function setupHeartHandlers(popup, wordData, wordList) {
    const heartContainer = popup.querySelector('.heart-container');

    // Handle filled heart clicks (decrease star)
    heartContainer.addEventListener('click', async (e) => {
        const heart = e.target.closest('.heart');
        if (!heart) return;

        if (heart.classList.contains('filled')) {
            // Decrease star count
            const newStarCount = wordData.star - 1;
            await updateStarCount(wordData, wordList, newStarCount);
            heartContainer.innerHTML = createHeartSymbols(newStarCount);
        } else if (heart.classList.contains('hollow')) {
            // Increase star count
            const newStarCount = wordData.star + 1;
            await updateStarCount(wordData, wordList, newStarCount);
            heartContainer.innerHTML = createHeartSymbols(newStarCount);
        }
    });
}

// Update star count in storage
async function updateStarCount(wordData, wordList, newCount) {
    try {
        // Update the word data
        wordData.star = newCount;
        wordData.update_time = new Date().toISOString();

        // Update storage
        await chrome.storage.local.set({ wordList });
        // Trigger sync after updating star count
        chrome.runtime.sendMessage({ action: 'triggerSync' });
    } catch (error) {
        console.error('Error updating star count:', error);
    }
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
        
        if (!chrome.storage || !chrome.storage.local) {
            console.error('Chrome storage API is not available');
            return;
        }

        chrome.storage.local.get(['wordList'], (result) => {
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

            chrome.storage.local.set({ wordList }, () => {
                if (chrome.runtime.lastError) {
                    console.error('Error saving word list:', chrome.runtime.lastError);
                    return;
                }
                console.log('Successfully saved word list:', wordList);
                // Trigger sync after adding word
                chrome.runtime.sendMessage({ action: 'triggerSync' });
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
    if (!isExtensionEnabled) return; // Skip if extension is disabled

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

// Check if current site is ignored
async function checkSiteStatus() {
    try {
        const { ignoredSites = [] } = await chrome.storage.sync.get('ignoredSites');
        const currentSite = window.location.hostname;
        return !ignoredSites.includes(currentSite);
    } catch (error) {
        console.error('Error checking site status:', error);
        return true; // Default to enabled if error
    }
}

// Remove all highlights from the page
function removeAllHighlights() {
    document.querySelectorAll('.word-highlighter-highlight').forEach(element => {
        const textNode = document.createTextNode(element.textContent);
        element.parentNode.replaceChild(textNode, element);
    });
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Received message:', request);
    if (request.action === 'highlight' || request.action === 'enable') {
        isExtensionEnabled = true;
        // Remove all existing highlights first
        removeAllHighlights();
        
        // Apply new highlights
        highlightWords(request.wordList);
        sendResponse({status: 'success'});
    } else if (request.action === 'disable') {
        isExtensionEnabled = false;
        removeAllHighlights();
        sendResponse({status: 'success'});
    } else if (request.action === 'updateStyles') {
        updateHighlightStyles(request.styles);
        sendResponse({status: 'success'});
    }
});

// Get initial word list from storage and highlight
chrome.storage.local.get(['wordList'], async (result) => {
    console.log('Initial word list:', result.wordList);
    await initializeExtensionState();
    if (result.wordList && isExtensionEnabled) {
        highlightWords(result.wordList);
    }
});

// Add hover event listeners to highlighted words
function addHighlightListeners() {
    if (!isExtensionEnabled) return; // Skip if extension is disabled

    document.querySelectorAll('.word-highlighter-highlight').forEach(element => {
        let hoverTimer;

        element.addEventListener('mouseenter', (e) => {
            chrome.storage.sync.get(['hoverDelay'], (result) => {
                const delay = result.hoverDelay || 500;
                hoverTimer = setTimeout(() => {
                    const wordId = e.target.id;
                    showRemoveWordPopup(wordId, e.target.getBoundingClientRect());
                }, delay);
            });
        });

        element.addEventListener('mouseleave', () => {
            clearTimeout(hoverTimer);
        });
    });
}

// Add this function to update styles dynamically
function updateHighlightStyles(styles) {
    const styleElement = document.getElementById('word-highlighter-styles');
    if (styleElement) {
        styleElement.remove();
    }

    const css = `
        .word-highlighter-highlight {
            background-color: ${styles.highlightColor || '#ffff00'} !important;
            color: ${styles.fontColor || '#000000'} !important;
            border-radius: 2px;
            padding: 0 2px;
            cursor: pointer;
            transition: background-color 0.2s;
            mix-blend-mode: normal !important;
        }

        /* Special handling for PDF.js viewer */
        .pdfViewer .word-highlighter-highlight {
            background-color: ${styles.highlightColor || '#ffff00'} !important;
            color: ${styles.fontColor || '#000000'} !important;
            opacity: 1 !important;
            mix-blend-mode: normal !important;
        }

        .word-highlighter-highlight:hover {
            background-color: ${styles.highlightColor ? adjustColor(styles.highlightColor, -10) : '#ffeb3b'} !important;
        }
    `;

    const style = document.createElement('style');
    style.id = 'word-highlighter-styles';
    style.textContent = css;
    document.head.appendChild(style);
}
// Helper function to adjust color brightness
function adjustColor(color, percent) {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return '#' + (
        0x1000000 +
        (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
        (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
        (B < 255 ? (B < 1 ? 0 : B) : 255)
    ).toString(16).slice(1);
}

// Initialize styles when content script loads
chrome.storage.sync.get(['highlightColor', 'fontColor'], (result) => {
    updateHighlightStyles({
        highlightColor: result.highlightColor || '#ffff00',
        fontColor: result.fontColor || '#000000'
    });
});

// Add a mutation observer to handle dynamically loaded PDF content
let observerTimeout = null;
const observer = new MutationObserver((mutations) => {
    // Clear any existing timeout
    if (observerTimeout) {
        clearTimeout(observerTimeout);
    }

    // Set a new timeout to debounce the highlighting
    observerTimeout = setTimeout(() => {
        // Check if we're in a PDF viewer
        if (window.location.href.includes('pdf.js/web/viewer.html')) {
            chrome.storage.sync.get(['wordList'], (result) => {
                if (result.wordList && isExtensionEnabled) {
                    highlightWords(result.wordList);
                }
            });
        }
    }, 1000); // Wait for 1 second after changes stop
});

// Start observing if we're in a PDF viewer
if (window.location.href.includes('pdf.js/web/viewer.html')) {
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// Clean up observer when page is unloaded
window.addEventListener('unload', () => {
    observer.disconnect();
});

