document.addEventListener('DOMContentLoaded', () => {
    const syncUrlInput = document.getElementById('syncUrl');
    const saveSyncUrlButton = document.getElementById('saveSyncUrl');
    const urlStatus = document.getElementById('urlStatus');
    
    const openaiKeyInput = document.getElementById('openaiKey');
    const openaiBaseUrlInput = document.getElementById('openaiBaseUrl');
    const openaiPromptInput = document.getElementById('openaiPrompt');
    const saveOpenAIButton = document.getElementById('saveOpenAI');
    const openaiStatus = document.getElementById('openaiStatus');

    // Default values
    const DEFAULT_SYNC_URL = 'http://localhost:8080/api/v1/stars/sync';
    const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1/chat/completions';
    const DEFAULT_OPENAI_PROMPT = 'Please give me the English definitions of the word {word} in Oxford dictionary format, besides I want a list of other forms of this word which share the Original form. Return with the content formatted in pure HTML(which I use to embed to my web HTML elements). only return the HTML content without other redundant content. don\'t need \'```\' and \'html\' symbol.';

    // Load current configuration
    async function loadConfig() {
        try {
            const result = await chrome.storage.sync.get([
                'wordSyncURL',
                'openaiKey',
                'openaiBaseUrl',
                'openaiPrompt'
            ]);

            syncUrlInput.value = result.wordSyncURL || DEFAULT_SYNC_URL;
            openaiKeyInput.value = result.openaiKey || '';
            openaiBaseUrlInput.value = result.openaiBaseUrl || DEFAULT_OPENAI_BASE_URL;
            openaiPromptInput.value = result.openaiPrompt || DEFAULT_OPENAI_PROMPT;
        } catch (error) {
            console.error('Error loading configuration:', error);
        }
    }

    // Initialize configuration
    loadConfig();

    // Handle sync URL save
    saveSyncUrlButton.addEventListener('click', async () => {
        const url = syncUrlInput.value.trim();
        
        if (!url) {
            urlStatus.textContent = 'URL cannot be empty';
            urlStatus.style.color = '#f44336';
            return;
        }

        try {
            // Validate URL format
            new URL(url);
            
            await chrome.storage.sync.set({ wordSyncURL: url });
            urlStatus.textContent = 'URL saved successfully';
            urlStatus.style.color = '#4CAF50';
        } catch (error) {
            urlStatus.textContent = 'Invalid URL format';
            urlStatus.style.color = '#f44336';
        }

        // Clear status message after 3 seconds
        setTimeout(() => {
            urlStatus.textContent = '';
        }, 3000);
    });

    // Handle OpenAI settings save
    saveOpenAIButton.addEventListener('click', async () => {
        const key = openaiKeyInput.value.trim();
        const baseUrl = openaiBaseUrlInput.value.trim();
        const prompt = openaiPromptInput.value.trim();

        if (!key || !baseUrl || !prompt) {
            openaiStatus.textContent = 'All fields are required';
            openaiStatus.style.color = '#f44336';
            return;
        }

        try {
            // Validate base URL
            new URL(baseUrl);

            await chrome.storage.sync.set({
                openaiKey: key,
                openaiBaseUrl: baseUrl,
                openaiPrompt: prompt
            });

            openaiStatus.textContent = 'OpenAI settings saved successfully';
            openaiStatus.style.color = '#4CAF50';
        } catch (error) {
            openaiStatus.textContent = 'Invalid base URL format';
            openaiStatus.style.color = '#f44336';
        }

        setTimeout(() => {
            openaiStatus.textContent = '';
        }, 3000);
    });
}); 