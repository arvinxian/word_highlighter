// ============================================================
// Word Highlighter - Content Script
// ============================================================

// --- Global State ---
let isExtensionEnabled = true;
let isHandlingClick = false;
let contentObserver = null;
let currentWordList = [];
let lastMouseDownTarget = null;
let rehighlightTimer = null;
let lastUrl = location.href;

// --- Constants ---
const GOOGLE_SENSITIVE_SELECTORS = [
    'input[type="text"]',
    'textarea',
    '[contenteditable="true"]',
    '.gLFyf',
    '.gsfi',
    'input.gLFyf'
];

// ============================================================
// Initialization
// ============================================================

async function initializeExtensionState() {
    try {
        isExtensionEnabled = await checkSiteStatus();
        if (!isExtensionEnabled) return;

        const { wordList = [] } = await chrome.storage.local.get('wordList');
        currentWordList = wordList;

        // Wait for DOM to be interactive at minimum
        if (document.readyState === 'loading') {
            await new Promise(resolve =>
                document.addEventListener('DOMContentLoaded', resolve, { once: true })
            );
        }

        performHighlighting();
        startObserving();
        watchForNavigation();
    } catch (error) {
        console.error('Error initializing extension state:', error);
    }
}

// Load custom highlight styles
chrome.storage.sync.get(['highlightColor', 'fontColor'], (result) => {
    updateHighlightStyles({
        highlightColor: result.highlightColor || '#ffff00',
        fontColor: result.fontColor || '#000000'
    });
});

// Single initialization entry point
initializeExtensionState();

// ============================================================
// SPA Navigation Detection
// ============================================================

function watchForNavigation() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
        originalPushState.apply(this, args);
        handleUrlChange();
    };

    history.replaceState = function (...args) {
        originalReplaceState.apply(this, args);
        handleUrlChange();
    };

    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);
}

function handleUrlChange() {
    const currentUrl = location.href;
    if (currentUrl === lastUrl) return;
    lastUrl = currentUrl;
    // Longer delay for navigation to let new content load
    scheduleRehighlight(500);
}

// ============================================================
// Highlighting Core
// ============================================================

let incrementalHighlightTimer = null;
let pendingIncrementalNodes = [];

function scheduleRehighlight(delay = 300) {
    if (rehighlightTimer) clearTimeout(rehighlightTimer);
    rehighlightTimer = setTimeout(() => performHighlighting({ skipImmersiveTranslate: true }), delay);
}

function scheduleIncrementalHighlight(nodes, delay = 300) {
    pendingIncrementalNodes.push(...nodes);
    if (incrementalHighlightTimer) clearTimeout(incrementalHighlightTimer);
    incrementalHighlightTimer = setTimeout(() => {
        const nodesToHighlight = pendingIncrementalNodes.filter(n => document.contains(n));
        pendingIncrementalNodes = [];
        if (nodesToHighlight.length > 0 && currentWordList?.length) {
            stopObserving();
            nodesToHighlight.forEach(node => highlightWords(currentWordList, node));
            requestAnimationFrame(() => startObserving());
        }
    }, delay);
}

function performHighlighting({ skipImmersiveTranslate = false } = {}) {
    if (!isExtensionEnabled || !currentWordList?.length) return;

    // Disconnect observer to prevent feedback loops
    stopObserving();

    removeAllHighlights({ skipImmersiveTranslate });
    highlightWords(currentWordList, document.body);

    // Reconnect observer after DOM settles
    requestAnimationFrame(() => startObserving());
}

function highlightWords(wordList, targetElement = document.body) {
    if (!isExtensionEnabled || !wordList?.length) return;
    if (!targetElement || !document.contains(targetElement)) return;

    currentWordList = wordList;

    const words = wordList
        .filter(item => item && typeof item === 'object' && !item.del_flag)
        .map(item => item.word)
        .filter(word => word && typeof word === 'string');

    if (!words.length) return;

    const escapedWords = words.map(word =>
        word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    );
    const regex = new RegExp(`\\b(${escapedWords.join('|')})\\b`, 'gi');

    const walker = document.createTreeWalker(
        targetElement,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function (node) {
                return shouldSkipNode(node)
                    ? NodeFilter.FILTER_REJECT
                    : NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    const nodesToHighlight = [];
    let node;
    while ((node = walker.nextNode())) {
        regex.lastIndex = 0;
        if (regex.test(node.textContent)) {
            nodesToHighlight.push(node);
        }
    }

    nodesToHighlight.forEach(textNode => {
        if (!document.contains(textNode)) return;

        const text = textNode.textContent;
        regex.lastIndex = 0;

        // Build replacement nodes using DOM API (avoids innerHTML XSS)
        const parts = [];
        let lastIndex = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
            }
            parts.push({ type: 'match', value: match[0] });
            lastIndex = regex.lastIndex;
        }
        if (lastIndex < text.length) {
            parts.push({ type: 'text', value: text.slice(lastIndex) });
        }

        if (!parts.some(p => p.type === 'match')) return;

        const fragment = document.createDocumentFragment();

        parts.forEach(part => {
            if (part.type === 'text') {
                fragment.appendChild(document.createTextNode(part.value));
            } else {
                const wordObj = wordList.find(item =>
                    item.word.toLowerCase() === part.value.toLowerCase()
                );
                if (wordObj) {
                    const highlight = document.createElement('span');
                    highlight.className = 'word-highlighter-highlight';
                    highlight.id = part.value.toLowerCase();
                    highlight.dataset.star = wordObj.star || 0;
                    highlight.dataset.userId = wordObj.user_id || 0;
                    highlight.textContent = part.value;
                    fragment.appendChild(highlight);
                } else {
                    fragment.appendChild(document.createTextNode(part.value));
                }
            }
        });

        if (textNode.parentNode) {
            textNode.parentNode.replaceChild(fragment, textNode);
        }
    });

    addHighlightListeners();
}

// ============================================================
// Remove Highlights
// ============================================================

function removeAllHighlights({ skipImmersiveTranslate = false } = {}) {
    // Replace highlight spans with text nodes
    const parentsToNormalize = new Set();
    document.querySelectorAll('.word-highlighter-highlight').forEach(el => {
        if (skipImmersiveTranslate && isImmersiveTranslateElement(el)) return;
        const parent = el.parentNode;
        if (!parent) return;
        parentsToNormalize.add(parent);
        const text = document.createTextNode(el.textContent);
        parent.replaceChild(text, el);
    });

    // Merge adjacent text nodes for clean DOM
    parentsToNormalize.forEach(parent => {
        if (document.contains(parent)) parent.normalize();
    });
}

// ============================================================
// MutationObserver
// ============================================================

function startObserving() {
    if (!isExtensionEnabled) return;
    if (contentObserver) contentObserver.disconnect();

    contentObserver = new MutationObserver((mutations) => {
        const newNodes = [];
        let hasNonTranslateChanges = false;

        for (const mutation of mutations) {
            if (mutation.addedNodes.length === 0) continue;
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.classList?.contains('word-highlighter-highlight') ||
                    node.closest?.('.word-highlighter-highlight') ||
                    node.closest?.('.word-highlighter-popup')) {
                    continue;
                }

                if (isImmersiveTranslateElement(node) ||
                    (mutation.target?.nodeType === 1 && isImmersiveTranslateElement(mutation.target))) {
                    // Immersive Translate content: highlight incrementally (no full rehighlight)
                    newNodes.push(node);
                } else {
                    hasNonTranslateChanges = true;
                }
            }
        }

        // For Immersive Translate nodes, highlight only the new nodes directly
        if (newNodes.length > 0) {
            scheduleIncrementalHighlight(newNodes);
        }

        // For other DOM changes, do a full rehighlight
        if (hasNonTranslateChanges) {
            scheduleRehighlight();
        }
    });

    const target = document.body || document.documentElement;
    if (target) {
        contentObserver.observe(target, {
            childList: true,
            subtree: true
        });
    }
}

function stopObserving() {
    if (contentObserver) {
        contentObserver.disconnect();
        contentObserver = null;
    }
    if (rehighlightTimer) {
        clearTimeout(rehighlightTimer);
        rehighlightTimer = null;
    }
    if (incrementalHighlightTimer) {
        clearTimeout(incrementalHighlightTimer);
        incrementalHighlightTimer = null;
    }
}

// ============================================================
// Helper Functions
// ============================================================

function isImmersiveTranslateElement(element) {
    if (!element) return false;
    return element.closest('[class*="immersive-translate"]') ||
        element.closest('[data-immersive-translate-walked]') ||
        element.closest('[data-immersive-translate-paragraph]');
}

function isElementHiddenOrClipped(element) {
    // Quick check: zero dimensions means not visible
    if (element.offsetHeight === 0 && element.offsetWidth === 0) return true;

    // Check for overflow clipping with text truncation on the element or ancestors
    let el = element;
    while (el && el !== document.body) {
        const style = getComputedStyle(el);
        if (style.overflow === 'hidden' &&
            (style.textOverflow === 'ellipsis' || style.whiteSpace === 'nowrap')) {
            return true;
        }
        el = el.parentElement;
    }
    return false;
}

function shouldSkipNode(node) {
    const parent = node.parentElement;
    if (!parent) return true;

    if (parent.tagName === 'SCRIPT' ||
        parent.tagName === 'STYLE' ||
        parent.tagName === 'TEXTAREA' ||
        parent.tagName === 'INPUT' ||
        parent.classList.contains('word-highlighter-highlight') ||
        parent.closest('.word-highlighter-highlight') ||
        parent.closest('.word-highlighter-popup')) {
        return true;
    }

    if (!node.textContent.trim()) return true;
    if (isGoogleSensitiveElement(parent)) return true;

    // Skip nodes inside hidden or overflow-clipped elements
    if (isElementHiddenOrClipped(parent)) return true;

    return false;
}

async function checkSiteStatus() {
    try {
        const { ignoredSites = [] } = await chrome.storage.sync.get('ignoredSites');
        const currentSite = window.location.hostname;
        return !ignoredSites.includes(currentSite);
    } catch (error) {
        console.error('Error checking site status:', error);
        return true;
    }
}

function isGoogleSearch() {
    return window.location.hostname.includes('google') &&
        (window.location.pathname.includes('/search') || window.location.search.includes('?q='));
}

function isGoogleSensitiveElement(element) {
    if (!element || !isGoogleSearch()) return false;
    return GOOGLE_SENSITIVE_SELECTORS.some(selector =>
        element.matches?.(selector) || element.closest?.(selector)
    );
}

// ============================================================
// Popup: Calculate Position & Resize
// ============================================================

function calculatePopupPosition(rect, popupElement) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const popupRect = popupElement.getBoundingClientRect();
    const popupWidth = popupRect.width;
    const popupHeight = popupRect.height;

    const spaceAbove = rect.top;
    const spaceBelow = viewportHeight - rect.bottom;

    let left = rect.left;
    let top;

    if (left + popupWidth > viewportWidth - 10) {
        left = Math.max(10, viewportWidth - popupWidth - 10);
    }
    if (left < 10) left = 10;

    if (spaceBelow >= popupHeight + 10 || spaceBelow > spaceAbove) {
        top = Math.min(rect.bottom + 5, viewportHeight - popupHeight - 10);
    } else {
        top = Math.max(10, rect.top - popupHeight - 5);
    }

    return { left, top };
}

function handlePopupResize(popup, rect) {
    let isPositionLocked = false;
    let resizeTimeout = null;
    let lastHeight = null;
    let stablePositionTimeout = null;

    const updatePosition = (entry) => {
        const currentHeight = entry.contentRect.height;
        if (isPositionLocked && lastHeight && Math.abs(currentHeight - lastHeight) < 20) return;

        const { left, top } = calculatePopupPosition(rect, popup);
        popup.style.transition = 'left 0.2s, top 0.2s';
        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;
        lastHeight = currentHeight;

        if (stablePositionTimeout) clearTimeout(stablePositionTimeout);
        stablePositionTimeout = setTimeout(() => { isPositionLocked = true; }, 1000);
    };

    const resizeObserver = new ResizeObserver((entries) => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            updatePosition(entries[entries.length - 1]);
        }, 100);
    });

    resizeObserver.observe(popup);

    popup.cleanup = () => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        if (stablePositionTimeout) clearTimeout(stablePositionTimeout);
        resizeObserver.disconnect();
    };

    return resizeObserver;
}

// ============================================================
// Popup: Remove Word / View Definition
// ============================================================

function showRemoveWordPopup(wordId, rect) {
    const existingPopups = document.querySelectorAll('.word-highlighter-remove-popup');
    existingPopups.forEach(popup => popup.remove());

    const activePopupId = `popup-${wordId}-${Date.now()}`;

    if (document.querySelector(`[data-popup-id^="popup-${wordId}"]`)) return;

    chrome.storage.local.get(['wordList'], (result) => {
        const wordList = result.wordList || [];
        const wordData = wordList.find(item =>
            item.word.toLowerCase() === wordId.toLowerCase()
        );
        if (!wordData) return;

        const popup = document.createElement('div');
        popup.className = 'word-highlighter-popup word-highlighter-remove-popup';
        popup.dataset.popupId = activePopupId;

        popup.style.visibility = 'hidden';
        popup.style.opacity = '0';
        document.body.appendChild(popup);

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

        const { left, top } = calculatePopupPosition(rect, popup);
        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;

        const resizeObserver = handlePopupResize(popup, rect);

        popup.style.visibility = 'visible';
        popup.style.opacity = '1';

        setupHeartHandlers(popup, wordData, wordList);

        // Fetch definitions in parallel
        const openaiContainer = popup.querySelector('.openai-definition');
        fetchWordDefinition(wordId)
            .then(def => { openaiContainer.innerHTML = `<h6>OpenAI Definition</h6>${def}`; })
            .catch(err => { openaiContainer.innerHTML = `<h6>OpenAI Definition</h6><p class="error">Error: ${err.message}</p>`; });

        const youdaoContainer = popup.querySelector('.youdao-definition');
        fetchYoudaoDefinition(wordId)
            .then(def => { youdaoContainer.innerHTML = `<h6>Youdao Definition</h6>${def}`; })
            .catch(err => { youdaoContainer.innerHTML = `<h6>Youdao Definition</h6><p class="error">Error: ${err.message}</p>`; });

        const yesButton = popup.querySelector('#removeWordYes');
        const noButton = popup.querySelector('#removeWordNo');

        const hidePopup = () => {
            if (document.querySelector(`[data-popup-id="${activePopupId}"]`)) {
                if (popup.cleanup) popup.cleanup();
                resizeObserver.disconnect();
                popup.remove();
            }
            document.removeEventListener('click', handleOutsideClick);
        };

        const handleOutsideClick = (e) => {
            if (!popup.contains(e.target) &&
                !e.target.classList.contains('word-highlighter-highlight')) {
                hidePopup();
            }
        };
        document.addEventListener('click', handleOutsideClick);

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

                    currentWordList = updatedList;
                    chrome.runtime.sendMessage({ action: 'triggerSync' });
                    performHighlighting();
                    hidePopup();
                });
            });
        });

        noButton.addEventListener('click', hidePopup);

        const popupCleanupObserver = new MutationObserver(() => {
            if (!document.getElementById(wordId)) {
                hidePopup();
                popupCleanupObserver.disconnect();
            }
        });
        popupCleanupObserver.observe(document.body, { childList: true, subtree: true });
    });
}

// ============================================================
// Heart / Star Rating
// ============================================================

function createHeartSymbols(starCount) {
    let html = '';
    for (let i = 0; i < starCount; i++) {
        html += `<span class="heart filled" data-index="${i}"></span>`;
    }
    html += `<span class="heart hollow"></span>`;
    return html;
}

function setupHeartHandlers(popup, wordData, wordList) {
    const heartContainer = popup.querySelector('.heart-container');

    heartContainer.addEventListener('click', async (e) => {
        const heart = e.target.closest('.heart');
        if (!heart) return;

        let newStarCount;
        if (heart.classList.contains('filled')) {
            newStarCount = wordData.star - 1;
        } else if (heart.classList.contains('hollow')) {
            newStarCount = wordData.star + 1;
        } else {
            return;
        }

        await updateStarCount(wordData, wordList, newStarCount);
        heartContainer.innerHTML = createHeartSymbols(newStarCount);
    });
}

async function updateStarCount(wordData, wordList, newCount) {
    try {
        wordData.star = newCount;
        wordData.update_time = new Date().toISOString();
        await chrome.storage.local.set({ wordList });
        chrome.runtime.sendMessage({ action: 'triggerSync' });
    } catch (error) {
        console.error('Error updating star count:', error);
    }
}

// ============================================================
// Popup: Add Word
// ============================================================

function showAddWordPopup(selectedText, x, y) {
    const existingPopup = document.querySelector('.word-highlighter-popup');
    if (existingPopup) existingPopup.remove();

    const popup = document.createElement('div');
    popup.className = 'word-highlighter-popup';

    popup.style.visibility = 'hidden';
    popup.style.opacity = '0';
    document.body.appendChild(popup);

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

    const rect = { left: x, right: x, top: y, bottom: y, width: 0, height: 0 };
    const { left, top } = calculatePopupPosition(rect, popup);
    const resizeObserver = handlePopupResize(popup, rect);

    popup.style.position = 'fixed';
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.style.visibility = 'visible';
    popup.style.opacity = '1';

    const cleanup = () => {
        if (popup.cleanup) popup.cleanup();
        resizeObserver.disconnect();
        popup.remove();
    };

    const handleAddWord = () => {
        chrome.storage.local.get(['wordList'], (result) => {
            const wordList = result.wordList || [];
            const existingWord = wordList.find(item =>
                item.word.toLowerCase() === selectedText.toLowerCase()
            );

            if (!existingWord) {
                wordList.push({
                    word: selectedText,
                    user_id: 1,
                    star: 0,
                    create_time: new Date().toISOString(),
                    update_time: new Date().toISOString(),
                    del_flag: false
                });
            } else if (existingWord.del_flag) {
                existingWord.del_flag = false;
                existingWord.star = 0;
                existingWord.update_time = new Date().toISOString();
            } else {
                return;
            }

            chrome.storage.local.set({ wordList }, () => {
                if (chrome.runtime.lastError) {
                    console.error('Error saving word list:', chrome.runtime.lastError);
                    return;
                }
                currentWordList = wordList;
                chrome.runtime.sendMessage({ action: 'triggerSync' });
                performHighlighting();
            });
        });
    };

    const yesButton = popup.querySelector('#addWordYes');
    const noButton = popup.querySelector('#addWordNo');

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

    popup.addEventListener('mouseup', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    const handleOutsideClick = (e) => {
        if (!popup.contains(e.target)) {
            cleanup();
            document.removeEventListener('mousedown', handleOutsideClick);
        }
    };
    document.addEventListener('mousedown', handleOutsideClick);

    // Fetch definitions in parallel
    const openaiContainer = popup.querySelector('.openai-definition');
    fetchWordDefinition(selectedText)
        .then(def => { openaiContainer.innerHTML = `<h6>OpenAI Definition</h6>${def}`; })
        .catch(err => { openaiContainer.innerHTML = `<h6>OpenAI Definition</h6><p class="error">Error: ${err.message}</p>`; });

    const youdaoContainer = popup.querySelector('.youdao-definition');
    fetchYoudaoDefinition(selectedText)
        .then(def => { youdaoContainer.innerHTML = `<h6>Youdao Definition</h6>${def}`; })
        .catch(err => { youdaoContainer.innerHTML = `<h6>Youdao Definition</h6><p class="error">Error: ${err.message}</p>`; });
}

// ============================================================
// API: Definitions
// ============================================================

async function fetchWordDefinition(word) {
    try {
        const config = await chrome.storage.sync.get([
            'openaiKey', 'openaiBaseUrl', 'openaiModel', 'openaiPrompt'
        ]);

        if (!config.openaiKey || !config.openaiBaseUrl || !config.openaiPrompt) {
            throw new Error('OpenAI configuration not found');
        }

        const model = (config.openaiModel && config.openaiModel.trim()) || 'gpt-5-nano';
        const prompt = config.openaiPrompt.replace('{word}', word);

        const response = await fetch(config.openaiBaseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.openaiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: [{ role: "user", content: prompt }]
            })
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error('Error fetching OpenAI definition:', error);
        return `<p class="error">Error fetching OpenAI definition: ${error.message}</p>`;
    }
}

async function fetchYoudaoDefinition(word) {
    try {
        const response = await fetch(`https://xianyou.uk/youdaoapi/result?word=${encodeURIComponent(word)}&lang=en`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const simpleDict = doc.querySelector('.simple.dict-module .trans-container');

        if (!simpleDict) return '<p class="error">No Youdao definition found</p>';

        const cleanElement = (element) => {
            const attributes = element.attributes;
            for (let i = attributes.length - 1; i >= 0; i--) {
                if (attributes[i].name.startsWith('data-v-')) {
                    element.removeAttribute(attributes[i].name);
                }
            }
            element.childNodes.forEach(child => {
                if (child.nodeType === 1) cleanElement(child);
            });
        };

        cleanElement(simpleDict);
        return simpleDict.outerHTML;
    } catch (error) {
        console.error('Error fetching Youdao definition:', error);
        return `<p class="error">Error fetching Youdao definition: ${error.message}</p>`;
    }
}

// ============================================================
// Event Listeners
// ============================================================

document.addEventListener('mousedown', (e) => {
    lastMouseDownTarget = e.target;
});

document.addEventListener('mouseup', (e) => {
    if (!isExtensionEnabled) return;
    if (e.target.closest('.word-highlighter-popup')) return;
    if (lastMouseDownTarget !== e.target) return;

    const selectedText = window.getSelection().toString().trim();
    if (selectedText && selectedText.length > 0) {
        showAddWordPopup(selectedText, e.clientX, e.clientY);
    }
});

// Message handler from popup / background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'highlight' || request.action === 'enable') {
        isExtensionEnabled = true;
        currentWordList = request.wordList || currentWordList;
        performHighlighting();
        startObserving();
        sendResponse({ status: 'success' });
    } else if (request.action === 'updateWordList') {
        currentWordList = request.wordList || [];
        performHighlighting();
        sendResponse({ status: 'success' });
    } else if (request.action === 'disable') {
        isExtensionEnabled = false;
        stopObserving();
        removeAllHighlights();
        sendResponse({ status: 'success' });
    } else if (request.action === 'updateStyles') {
        updateHighlightStyles(request.styles);
        sendResponse({ status: 'success' });
    }
});

// ============================================================
// Highlight Hover Listeners
// ============================================================

function addHighlightListeners() {
    if (!isExtensionEnabled) return;

    let activePopupTimer = null;
    const highlights = document.querySelectorAll('.word-highlighter-highlight');

    highlights.forEach(element => {
        element.removeEventListener('mouseenter', element.highlightEnterHandler);
        element.removeEventListener('mouseleave', element.highlightLeaveHandler);

        element.highlightEnterHandler = (e) => {
            if (activePopupTimer) clearTimeout(activePopupTimer);

            chrome.storage.sync.get(['hoverDelay'], (result) => {
                const delay = result.hoverDelay || 500;
                activePopupTimer = setTimeout(() => {
                    showRemoveWordPopup(e.target.id, e.target.getBoundingClientRect());
                }, delay);
            });
        };

        element.highlightLeaveHandler = () => {
            if (activePopupTimer) {
                clearTimeout(activePopupTimer);
                activePopupTimer = null;
            }
        };

        element.addEventListener('mouseenter', element.highlightEnterHandler);
        element.addEventListener('mouseleave', element.highlightLeaveHandler);
    });
}

// ============================================================
// Style Management
// ============================================================

function updateHighlightStyles(styles) {
    const existing = document.getElementById('word-highlighter-styles');
    if (existing) existing.remove();

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

function adjustColor(color, percent) {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = ((num >> 8) & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return '#' + (
        0x1000000 +
        (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
        (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
        (B < 255 ? (B < 1 ? 0 : B) : 255)
    ).toString(16).slice(1);
}

// Clean up on page unload
window.addEventListener('unload', () => {
    stopObserving();
});
