// Global variable to track if extension is enabled for current site
let isExtensionEnabled = true;

// Global flag to prevent popup from showing while handling clicks
let isHandlingClick = false;

// Add this after the global variables
let contentObserver = null;

// Add new global variable to track current word list
let currentWordList = [];

// Initialize extension state
async function initializeExtensionState() {
    try {
        isExtensionEnabled = await checkSiteStatus();
        if (isExtensionEnabled) {
            const { wordList = [] } = await chrome.storage.local.get('wordList');
            currentWordList = wordList;
            
            // Ensure we highlight immediately when the page loads
            await highlightInitialContent();
            
            // Then set up the observer for dynamic content
            initContentObserver();
        }
    } catch (error) {
        console.error('Error initializing extension state:', error);
    }
}

// Add new function to handle initial content highlighting
async function highlightInitialContent() {
    // Wait for the page to be fully loaded
    if (document.readyState !== 'complete') {
        await new Promise(resolve => {
            window.addEventListener('load', resolve, { once: true });
        });
    }

    // Highlight the initial content
    await highlightWords(currentWordList);
}

// Update the document ready handler
function onDocumentReady(callback) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', callback);
        window.addEventListener('load', callback); // Also trigger on full load
    } else {
        callback();
    }
}

// Initialize as soon as possible
onDocumentReady(() => {
    initializeExtensionState();
});

// Update initContentObserver for better dynamic content handling
function initContentObserver() {
    if (!isExtensionEnabled) return;
    
    if (contentObserver) {
        contentObserver.disconnect();
    }

    let debounceTimer = null;
    
    contentObserver = new MutationObserver((mutations) => {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(async () => {
            try {
                const significantChanges = mutations.some(mutation => {
                    // Check if the mutation is significant enough to warrant re-highlighting
                    return mutation.addedNodes.length > 0 && 
                           Array.from(mutation.addedNodes).some(node => 
                               node.nodeType === 1 && // Element node
                               !node.classList?.contains('word-highlighter-highlight') &&
                               !node.closest('.word-highlighter-highlight')
                           );
                });

                if (significantChanges) {
                    await highlightWords(currentWordList);
                }
            } catch (error) {
                console.error('Error in mutation observer:', error);
            }
        }, 100); // Short debounce time for better responsiveness
    });

    // Observe the entire document
    contentObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: false
    });
}

// Update highlightWords to be more thorough
function highlightWords(wordList, targetElement = document.body) {
    if (!isExtensionEnabled || !wordList?.length) return;
    
    // Update current word list
    currentWordList = wordList;

    // Remove existing highlights if we're processing the whole document
    if (!targetElement || targetElement === document.body) {
        removeAllHighlights();
    }

    // Skip if the target element is not in the document
    if (!document.contains(targetElement)) return;

    // Skip if the element is already being processed
    if (targetElement.getAttribute('data-processing')) return;
    targetElement.setAttribute('data-processing', 'true');

    try {
        // Create regex pattern once for efficiency
        const words = wordList
            .filter(item => item && typeof item === 'object' && !item.del_flag)
            .map(item => item.word)
            .filter(word => word && typeof word === 'string');
        
        if (!words.length) return;
        
        const escapedWords = words.map(word => 
            word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        );
        const regex = new RegExp(`\\b(${escapedWords.join('|')})\\b`, 'gi');

        // Process all text nodes in the target element
        const walker = document.createTreeWalker(
            targetElement,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    if (shouldSkipNode(node)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        const nodesToHighlight = [];
        let node;
        while (node = walker.nextNode()) {
            regex.lastIndex = 0;
            if (regex.test(node.textContent)) {
                nodesToHighlight.push(node);
            }
        }

        // Process all nodes that need highlighting
        nodesToHighlight.forEach(node => {
            if (!document.contains(node)) return;
            
            const span = document.createElement('span');
            regex.lastIndex = 0;
            span.innerHTML = node.textContent.replace(regex, match => {
                const wordObj = wordList.find(item => 
                    item.word.toLowerCase() === match.toLowerCase()
                );
                if (!wordObj) return match;
                
                return `<span 
                    class="word-highlighter-highlight" 
                    id="${match.toLowerCase()}"
                    data-star="${wordObj.star || 0}"
                    data-user-id="${wordObj.user_id || 0}"
                >${match}</span>`;
            });
            
            if (node.parentNode) {
                node.parentNode.replaceChild(span, node);
            }
        });

        // Add hover event listeners to new highlights
        addHighlightListeners();
    } catch (error) {
        console.error('Error in highlightWords:', error);
    } finally {
        targetElement.removeAttribute('data-processing');
    }
}

// Add helper function to determine if a node should be skipped
function shouldSkipNode(node) {
    const parent = node.parentElement;
    if (!parent) return true;

    // Skip if parent is a script, style, or already highlighted
    if (parent.tagName === 'SCRIPT' ||
        parent.tagName === 'STYLE' ||
        parent.tagName === 'TEXTAREA' ||
        parent.tagName === 'INPUT' ||
        parent.classList.contains('word-highlighter-highlight') ||
        parent.closest('.word-highlighter-highlight')) {
        return true;
    }

    // Skip if node is empty or only whitespace
    if (!node.textContent.trim()) {
        return true;
    }

    // Skip if parent is a sensitive element
    if (isGoogleSensitiveElement(parent)) {
        return true;
    }

    return false;
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

// Function to fetch word definition from Youdao API
async function fetchYoudaoDefinition(word) {
    try {
        const response = await fetch(`https://xianyou.uk/youdaoapi/result?word=${encodeURIComponent(word)}&lang=en`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const html = await response.text();
        
        // Create a temporary DOM element to parse the HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // Find the specific element we want
        const simpleDict = doc.querySelector('.simple.dict-module .trans-container');
        
        if (!simpleDict) {
            return '<p class="error">No Youdao definition found</p>';
        }
        
        // Clean up data-v attributes
        const cleanElement = (element) => {
            const attributes = element.attributes;
            for (let i = attributes.length - 1; i >= 0; i--) {
                const attr = attributes[i];
                if (attr.name.startsWith('data-v-')) {
                    element.removeAttribute(attr.name);
                }
            }
            element.childNodes.forEach(child => {
                if (child.nodeType === 1) { // Element node
                    cleanElement(child);
                }
            });
        };
        
        cleanElement(simpleDict);
        return simpleDict.outerHTML;
    } catch (error) {
        console.error('Error fetching Youdao definition:', error);
        return `<p class="error">Error fetching Youdao definition: ${error.message}</p>`;
    }
}

// Update the calculatePopupPosition function
function calculatePopupPosition(rect, popupElement) {
    // Get viewport dimensions
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Get popup dimensions
    const popupRect = popupElement.getBoundingClientRect();
    const popupWidth = popupRect.width;
    const popupHeight = popupRect.height;
    
    // Calculate available space above and below the word
    const spaceAbove = rect.top;
    const spaceBelow = viewportHeight - rect.bottom;
    
    // Determine initial position
    let left = rect.left;
    let top;
    
    // Handle horizontal positioning
    if (left + popupWidth > viewportWidth - 10) {
        left = Math.max(10, viewportWidth - popupWidth - 10);
    }
    if (left < 10) {
        left = 10;
    }
    
    // Determine vertical positioning
    if (spaceBelow >= popupHeight + 10 || spaceBelow > spaceAbove) {
        // Place below if there's enough space or more space below
        top = Math.min(rect.bottom + 5, viewportHeight - popupHeight - 10);
    } else {
        // Place above if there's more space there
        top = Math.max(10, rect.top - popupHeight - 5);
    }
    
    return { left, top };
}

// Update the handlePopupResize function
function handlePopupResize(popup, rect, initialPosition) {
    let isPositionLocked = false;
    let resizeTimeout = null;
    let lastHeight = null;
    let stablePositionTimeout = null;
    
    // Function to calculate and set position
    const updatePosition = (entry) => {
        const currentHeight = entry.contentRect.height;
        
        // Skip if position is locked and height hasn't changed significantly
        if (isPositionLocked && lastHeight && Math.abs(currentHeight - lastHeight) < 20) {
            return;
        }
        
        // Calculate new position while respecting initial position preference
        const { left, top } = calculatePopupPosition(rect, popup);
        
        // Update position smoothly
        popup.style.transition = 'left 0.2s, top 0.2s';
        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;
        
        lastHeight = currentHeight;
        
        // Clear existing stable position timeout
        if (stablePositionTimeout) {
            clearTimeout(stablePositionTimeout);
        }
        
        // Set new timeout to lock position
        stablePositionTimeout = setTimeout(() => {
            isPositionLocked = true;
        }, 1000);
    };
    
    const resizeObserver = new ResizeObserver((entries) => {
        // Clear any existing timeout
        if (resizeTimeout) {
            clearTimeout(resizeTimeout);
        }
        
        // Debounce the resize handling
        resizeTimeout = setTimeout(() => {
            const entry = entries[entries.length - 1];
            updatePosition(entry);
        }, 100);
    });
    
    // Start observing
    resizeObserver.observe(popup);
    
    // Add cleanup function
    popup.cleanup = () => {
        if (resizeTimeout) {
            clearTimeout(resizeTimeout);
        }
        if (stablePositionTimeout) {
            clearTimeout(stablePositionTimeout);
        }
        resizeObserver.disconnect();
    };
    
    return resizeObserver;
}

// Update showRemoveWordPopup function
function showRemoveWordPopup(wordId, rect) {
    // Remove any existing popups first
    const existingPopups = document.querySelectorAll('.word-highlighter-remove-popup');
    existingPopups.forEach(popup => popup.remove());

    // Add a data attribute to track active popups
    const activePopupId = `popup-${wordId}-${Date.now()}`;
    
    // Check if we already have an active popup for this word
    if (document.querySelector(`[data-popup-id^="popup-${wordId}"]`)) {
        return; // Exit if a popup for this word already exists
    }

    // Get current word data
    chrome.storage.local.get(['wordList'], (result) => {
        const wordList = result.wordList || [];
        const wordData = wordList.find(item => 
            item.word.toLowerCase() === wordId.toLowerCase()
        );
        
        if (!wordData) return;

        // Create popup element
        const popup = document.createElement('div');
        popup.className = 'word-highlighter-popup word-highlighter-remove-popup';
        popup.dataset.popupId = activePopupId;
        
        // Add popup to document first with invisible positioning
        popup.style.visibility = 'hidden';
        popup.style.opacity = '0';
        document.body.appendChild(popup);

        // Set initial content with placeholders for definitions
        popup.innerHTML = `
            <div class="popup-content">
                <div class="heart-container">
                    ${createHeartSymbols(wordData.star)}
                </div>
                <p>Remove "${wordId}" from highlight list?</p>
                <div class="definition-container">
                    <div class="openai-definition">
                        <h4>OpenAI Definition</h4>
                        <div class="definition-placeholder" style="height: 100px"></div>
                    </div>
                    <div class="youdao-definition">
                        <h4>Youdao Definition</h4>
                        <div class="definition-placeholder" style="height: 100px"></div>
                    </div>
                </div>
                <button class="popup-btn" id="removeWordYes">Yes</button>
                <button class="popup-btn" id="removeWordNo">No</button>
            </div>
        `;

        // Calculate initial position
        const { left, top, preferredPosition } = calculatePopupPosition(rect, popup);
        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;

        // Set up resize observer with initial position preference
        const resizeObserver = handlePopupResize(popup, rect, preferredPosition);

        // Make popup visible with transition
        popup.style.visibility = 'visible';
        popup.style.opacity = '1';

        // Add heart click handlers
        setupHeartHandlers(popup, wordData, wordList);

        // Fetch OpenAI definition
        const openaiContainer = popup.querySelector('.openai-definition');
        fetchWordDefinition(wordId)
            .then(openaiDef => {
                openaiContainer.innerHTML = `<h6>OpenAI Definition</h6>${openaiDef}`;
            })
            .catch(error => {
                openaiContainer.innerHTML = `<h6>OpenAI Definition</h6><p class="error">Error: ${error.message}</p>`;
            });

        // Fetch Youdao definition independently
        const youdaoContainer = popup.querySelector('.youdao-definition');
        fetchYoudaoDefinition(wordId)
            .then(youdaoDef => {
                youdaoContainer.innerHTML = `<h6>Youdao Definition</h6>${youdaoDef}`;
            })
            .catch(error => {
                youdaoContainer.innerHTML = `<h6>Youdao Definition</h6><p class="error">Error: ${error.message}</p>`;
            });

        const yesButton = popup.querySelector('#removeWordYes');
        const noButton = popup.querySelector('#removeWordNo');

        // Update the hidePopup function to clean up the observer
        const hidePopup = () => {
            if (document.querySelector(`[data-popup-id="${activePopupId}"]`)) {
                if (popup.cleanup) {
                    popup.cleanup();
                }
                resizeObserver.disconnect();
                popup.remove();
            }
            document.removeEventListener('click', handleOutsideClick);
        };

        // Handle clicks outside the popup
        const handleOutsideClick = (e) => {
            const clickedElement = e.target;
            // Check if click is outside both the popup and the highlighted word
            if (!popup.contains(clickedElement) && 
                !clickedElement.classList.contains('word-highlighter-highlight')) {
                hidePopup();
            }
        };

        // Add document click listener
        document.addEventListener('click', handleOutsideClick);

        // Update button click handlers
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

        noButton.addEventListener('click', hidePopup);

        // Clean up popup when the word element is removed
        const observer = new MutationObserver((mutations) => {
            if (!document.getElementById(wordId)) {
                hidePopup();
                observer.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
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
        console.log('[Sync Debug] Triggering sync after star update for word:', wordData.word);
        // Trigger sync after updating star count
        chrome.runtime.sendMessage({ action: 'triggerSync' });
    } catch (error) {
        console.error('Error updating star count:', error);
    }
}

// Update showAddWordPopup function
function showAddWordPopup(selectedText, x, y) {
    // Remove any existing popup
    const existingPopup = document.querySelector('.word-highlighter-popup');
    if (existingPopup) {
        existingPopup.remove();
    }

    // Create popup element
    const popup = document.createElement('div');
    popup.className = 'word-highlighter-popup';
    
    // Add popup to document first with invisible positioning
    popup.style.visibility = 'hidden';
    popup.style.opacity = '0';
    document.body.appendChild(popup);

    // Set initial content with placeholders
    popup.innerHTML = `
        <div class="popup-content">
            <p>Add "${selectedText}" to highlight list?</p>
            <div class="definition-container">
                <div class="openai-definition">
                    <h4>OpenAI Definition</h4>
                    <div class="definition-placeholder" style="height: 100px"></div>
                </div>
                <div class="youdao-definition">
                    <h4>Youdao Definition</h4>
                    <div class="definition-placeholder" style="height: 100px"></div>
                </div>
            </div>
            <button class="popup-btn" id="addWordYes">Yes</button>
            <button class="popup-btn" id="addWordNo">No</button>
        </div>
    `;

    // Calculate initial position
    const rect = {
        left: x,
        right: x,
        top: y,
        bottom: y,
        width: 0,
        height: 0
    };
    
    // Calculate initial position
    const { left, top, preferredPosition } = calculatePopupPosition(rect, popup);
    
    // Set up resize observer with initial position preference
    const resizeObserver = handlePopupResize(popup, rect, preferredPosition);

    // Update popup position and make visible
    popup.style.position = 'fixed';
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.style.visibility = 'visible';
    popup.style.opacity = '1';

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

    // Update cleanup
    const cleanup = () => {
        if (popup.cleanup) {
            popup.cleanup();
        }
        resizeObserver.disconnect();
        popup.remove();
    };

    // Update event listeners to use cleanup
    yesButton.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleAddWord();
        cleanup();
    });

    noButton.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
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

    // Fetch OpenAI definition
    const openaiContainer = popup.querySelector('.openai-definition');
    fetchWordDefinition(selectedText)
        .then(openaiDef => {
            openaiContainer.innerHTML = `<h6>OpenAI Definition</h6>${openaiDef}`;
        })
        .catch(error => {
            openaiContainer.innerHTML = `<h6>OpenAI Definition</h6><p class="error">Error: ${error.message}</p>`;
        });

    // Fetch Youdao definition independently
    const youdaoContainer = popup.querySelector('.youdao-definition');
    fetchYoudaoDefinition(selectedText)
        .then(youdaoDef => {
            youdaoContainer.innerHTML = `<h6>Youdao Definition</h6>${youdaoDef}`;
        })
        .catch(error => {
            youdaoContainer.innerHTML = `<h6>Youdao Definition</h6><p class="error">Error: ${error.message}</p>`;
        });
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
    const highlights = document.querySelectorAll('.word-highlighter-highlight');
    highlights.forEach(element => {
        const textNode = document.createTextNode(element.textContent);
        const parentSpan = element.parentElement;
        
        if (parentSpan && parentSpan.childNodes.length === 1) {
            // If this is the only child, replace the entire parent span
            parentSpan.parentNode.replaceChild(textNode, parentSpan);
        } else {
            // Otherwise just replace the highlight element
            element.parentNode.replaceChild(textNode, element);
        }
    });
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Content script received message:', request);
    
    if (request.action === 'highlight' || request.action === 'enable') {
        isExtensionEnabled = true;
        currentWordList = request.wordList || [];
        
        // Remove existing highlights and reapply
        removeAllHighlights();
        highlightWords(currentWordList);
        
        // Reinitialize the observer
        initContentObserver();
        sendResponse({status: 'success'});
    } else if (request.action === 'updateWordList') {
        currentWordList = request.wordList || [];
        removeAllHighlights();
        highlightWords(currentWordList);
        sendResponse({status: 'success'});
    } else if (request.action === 'disable') {
        isExtensionEnabled = false;
        // Disconnect the observer
        if (contentObserver) {
            contentObserver.disconnect();
        }
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
    if (!isExtensionEnabled) return;

    let activePopupTimer = null;
    const highlights = document.querySelectorAll('.word-highlighter-highlight');

    highlights.forEach(element => {
        // Remove any existing listeners first
        element.removeEventListener('mouseenter', element.highlightEnterHandler);
        element.removeEventListener('mouseleave', element.highlightLeaveHandler);

        // Create new handlers
        element.highlightEnterHandler = (e) => {
            // Clear any existing timer
            if (activePopupTimer) {
                clearTimeout(activePopupTimer);
            }

            chrome.storage.sync.get(['hoverDelay'], (result) => {
                const delay = result.hoverDelay || 500;
                activePopupTimer = setTimeout(() => {
                    const wordId = e.target.id;
                    showRemoveWordPopup(wordId, e.target.getBoundingClientRect());
                }, delay);
            });
        };

        element.highlightLeaveHandler = () => {
            if (activePopupTimer) {
                clearTimeout(activePopupTimer);
                activePopupTimer = null;
            }
        };

        // Add the new listeners
        element.addEventListener('mouseenter', element.highlightEnterHandler);
        element.addEventListener('mouseleave', element.highlightLeaveHandler);
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
            padding: 0;
            cursor: pointer;
            transition: background-color 0.2s;
            display: inline;
            box-decoration-break: clone;
            position: relative;
            white-space: pre-wrap;
            margin: 0;
            background-clip: padding-box;
            mix-blend-mode: normal !important;
        }

        /* Special handling for PDF.js viewer */
        .pdfViewer .word-highlighter-highlight {
            background-color: ${styles.highlightColor || '#ffff00'} !important;
            color: ${styles.fontColor || '#000000'} !important;
            opacity: 1 !important;
            mix-blend-mode: normal !important;
            padding: 0;
            margin: 0;
            display: inline;
            white-space: pre-wrap;
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

// Add this function to fetch word definition from OpenAI
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
                model: "gpt-4.1-nano",
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
        console.error('Error fetching OpenAI definition:', error);
        return `<p class="error">Error fetching OpenAI definition: ${error.message}</p>`;
    }
}

// Add these class names for Google's suggestion elements
const GOOGLE_SUGGESTION_SELECTORS = {
    container: '.UUbT9, .aajZCb', // Main suggestion container
    item: '.wM6W7d, .s75CSd, .sbl1', // Individual suggestion text
    wrapper: 'ul.G43f7e' // Suggestion list wrapper
};

// Update initContentObserver to better handle suggestions
function initContentObserver() {
    if (!isExtensionEnabled) return;
    
    if (contentObserver) {
        contentObserver.disconnect();
    }

    let debounceTimer = null;
    let processingMutation = false;

    // Create a separate observer specifically for suggestions
    const suggestionObserver = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                const suggestionTexts = mutation.target.querySelectorAll(GOOGLE_SUGGESTION_SELECTORS.item);
                if (suggestionTexts.length > 0) {
                    chrome.storage.local.get(['wordList'], (result) => {
                        const wordList = result.wordList || [];
                        suggestionTexts.forEach(text => {
                            if (!text.hasAttribute('data-highlighted')) {
                                highlightWords(wordList, text);
                                text.setAttribute('data-highlighted', 'true');
                            }
                        });
                    });
                }
            }
        });
    });

    // Main content observer
    contentObserver = new MutationObserver((mutations) => {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        if (processingMutation) return;

        debounceTimer = setTimeout(async () => {
            try {
                processingMutation = true;
                const { wordList = [] } = await chrome.storage.local.get(['wordList']);

                if (isGoogleSearch()) {
                    // Handle search results
                    const searchResults = document.querySelectorAll('.g, .jtfYYd, .MjjYud, .hlcw0c');
                    searchResults.forEach(container => {
                        if (!container.hasAttribute('data-highlighted')) {
                            try {
                                highlightWords(wordList, container);
                                container.setAttribute('data-highlighted', 'true');
                            } catch (error) {
                                console.error('Error highlighting container:', error);
                            }
                        }
                    });

                    // Handle suggestion container setup
                    const suggestionWrapper = document.querySelector(GOOGLE_SUGGESTION_SELECTORS.wrapper);
                    if (suggestionWrapper && !suggestionWrapper.hasAttribute('data-observer-attached')) {
                        suggestionObserver.observe(suggestionWrapper, {
                            childList: true,
                            subtree: true,
                            characterData: false
                        });
                        suggestionWrapper.setAttribute('data-observer-attached', 'true');
                    }
                } else {
                    // Handle non-Google pages
                    mutations.forEach(mutation => {
                        mutation.addedNodes.forEach(node => {
                            if (node.nodeType === 1 && 
                                !node.classList?.contains('word-highlighter-highlight') &&
                                !node.closest('.word-highlighter-highlight')) {
                                highlightWords(wordList, node);
                            }
                        });
                    });
                }
            } catch (error) {
                console.error('Error in mutation observer:', error);
            } finally {
                processingMutation = false;
            }
        }, 100);
    });

    // Set up observers for Google search page
    if (isGoogleSearch()) {
        // Observe main content
        const mainContainer = document.getElementById('main') || document.body;
        contentObserver.observe(mainContainer, {
            childList: true,
            subtree: true,
            characterData: false
        });

        // Set up suggestion observer when the search box is focused
        const searchInput = document.querySelector('input.gLFyf');
        if (searchInput) {
            searchInput.addEventListener('focus', () => {
                const suggestionWrapper = document.querySelector(GOOGLE_SUGGESTION_SELECTORS.wrapper);
                if (suggestionWrapper && !suggestionWrapper.hasAttribute('data-observer-attached')) {
                    suggestionObserver.observe(suggestionWrapper, {
                        childList: true,
                        subtree: true,
                        characterData: false
                    });
                    suggestionWrapper.setAttribute('data-observer-attached', 'true');
                }
            });
        }

        // Watch for suggestion container creation
        const bodyObserver = new MutationObserver((mutations) => {
            const suggestionWrapper = document.querySelector(GOOGLE_SUGGESTION_SELECTORS.wrapper);
            if (suggestionWrapper && !suggestionWrapper.hasAttribute('data-observer-attached')) {
                suggestionObserver.observe(suggestionWrapper, {
                    childList: true,
                    subtree: true,
                    characterData: false
                });
                suggestionWrapper.setAttribute('data-observer-attached', 'true');
                bodyObserver.disconnect();
            }
        });

        bodyObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    } else {
        contentObserver.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: false
        });
    }
}

// Add this helper function to check if we're on a Google search page
function isGoogleSearch() {
    return window.location.hostname.includes('google') && 
           (window.location.pathname.includes('/search') || window.location.search.includes('?q='));
}

// Update the isGoogleSensitiveElement function to be more specific
function isGoogleSensitiveElement(element) {
    if (!element || !isGoogleSearch()) return false;
    
    // Only protect specific input elements
    const sensitiveSelectors = [
        'input[type="text"]', // Text inputs
        'textarea', // Textareas
        '[contenteditable="true"]', // Editable content
        '.gLFyf', // Main search input
        '.gsfi', // Search input field
        'input.gLFyf' // Specific search input
    ];
    
    return sensitiveSelectors.some(selector => 
        element.matches?.(selector) || element.closest?.(selector)
    );
}

// Add this helper function to check if a container is a Google search result
function isSearchResultContainer(element) {
    if (!element) return false;
    const resultSelectors = [
        '.g', '.jtfYYd', '.MjjYud', '.hlcw0c', // Search results
        '.UUbT9', // Main suggestions container
        '.sbl1', '.sbct', // Individual suggestion items
        '.aypzV', // Suggestion text wrapper
        '.wM6W7d', // Suggestion item content
        '.erkvQe' // Related searches
    ];
    return resultSelectors.some(selector => element.matches?.(selector));
}

