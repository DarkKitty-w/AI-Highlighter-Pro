console.log('AI Highlighter content script loaded');

class AIHighlighter {
  constructor() {
    console.log('AIHighlighter initialized');
    // --- MODIFICATION ---
    // Les couleurs ne sont plus prédéfinies.
    // Nous les stockerons ici au fur et à mesure.
    this.highlightColors = new Map();
    // --- FIN MODIFICATION ---
    
    this.highlights = new Map();
    this.styledElements = new Map();
    this.MAX_CHARS_PER_CALL = 15000;
  }

  // --- NOUVELLE FONCTION ---
  // Génère une couleur pastel aléatoire et lisible
  generateRandomColor() {
    const hue = Math.floor(Math.random() * 360); // 0-359
    const saturation = Math.floor(Math.random() * 20) + 70; // 70-90% (pastel)
    const lightness = Math.floor(Math.random() * 10) + 80; // 80-90% (lumineux)
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }
  // --- FIN NOUVELLE FONCTION ---

  async analyzeAndHighlight(query, apiKey) {
    try {
      this.sendProgress('Step 1/4: Mapping page elements (including formulas)...');
      const pageText = this.extractPageTextAndTagElements(); 
      
      if (!pageText || pageText.length < 50) {
        throw new Error('No sufficient text content found on this page.');
      }

      console.log(`Mapping complete. Text length: ${pageText.length}`);
      this.sendProgress('Trying local AI (Gemini Nano)...');
      let result = await this.tryLocalAI(query, pageText);
      let aiUsed = 'local';
      
      if (!result || !result.categories || result.categories.length === 0) {
        console.log('Local AI failed or not available, trying cloud API...');
        this.sendProgress('Local AI unavailable, trying cloud API...');
        
        if (pageText.length > this.MAX_CHARS_PER_CALL) {
          this.sendProgress(`Step 2/4: Splitting ${pageText.length} chars into overlapping chunks...`);
          const chunks = this.splitTextIntoChunks(pageText, this.MAX_CHARS_PER_CALL);
          this.sendProgress(`Step 3/4: Analyzing ${chunks.length} chunks in parallel...`);
          console.log(`Analyzing ${chunks.length} chunks...`);

          const promises = chunks.map((chunk, i) => 
            this.useGeminiAPI(query, chunk, apiKey)
              .catch(e => {
                 console.error(`Error in chunk ${i+1}:`, e);
                 return { categories: [] }; 
              })
          );
          
          const results = await Promise.all(promises);
          const allCategories = results.flatMap(res => res.categories);
          result = { categories: allCategories };
          
        } else {
          this.sendProgress('Step 2/4: Analyzing text with cloud API...');
          result = await this.useGeminiAPI(query, pageText, apiKey);
        }
        
        aiUsed = 'cloud';
      }

      console.log('AI analysis complete. Result:', result);
      if (result && result.categories && result.categories.length > 0) {
        this.sendProgress(`Step 4/4: Applying ${result.categories.length} highlights...`);
        this.applyHighlights(result.categories);

        const colorsPayload = Object.fromEntries(this.highlightColors);
        console.log('Sending legend update to sidepanel:', colorsPayload);
        chrome.runtime.sendMessage({ 
          type: 'UPDATE_LEGEND', 
          payload: colorsPayload
        }).catch(e => console.log("Sidepanel not open, can't update legend."));

        return { 
          success: true, 
          highlightCount: this.highlights.size + this.styledElements.size,
          aiUsed: aiUsed,
          textLength: pageText.length
        };
      } else {
        console.log('AI analysis completed but no relevant content was found.');
        throw new Error('AI analysis completed but no relevant content was found.');
      }
      
    } catch (error) {
      console.error('Main analyzeAndHighlight error:', error);
      this.clearHighlights();
      return { 
        success: false, 
        error: error.message,
        details: { type: error.name, stack: error.stack }
      };
    }
  }

  sendProgress(message) {
    console.log('Sending progress:', message);
    chrome.runtime.sendMessage({
      type: 'ANALYSIS_PROGRESS', 
      message: message
    }).catch(() => {
      console.warn('Could not send progress, sidepanel may be closed.');
    });
  }

  extractPageTextAndTagElements() {
    this.clearHighlights(); 
    let aiText = "";
    let chunkIndex = 0;

    const selectors = 'p, li, dd, h1, h2, h3, h4, th, td, blockquote, pre, .katex, .katex-display, .MathJax_Display';
    const elements = document.body.querySelectorAll(selectors);
    console.log(`Found ${elements.length} potential elements to tag.`);

    elements.forEach(el => {
      if (el.closest('nav, footer, script, style')) {
        return;
      }
      if (el.closest('[data-ai-id]')) {
        return;
      }
      let text = el.innerText;
      if (!text || text.trim().length < 2) {
         text = el.getAttribute('aria-label');
      }
      if (!text || text.trim().length < 2) {
         return;
      }
      
      text = text.trim();
      const id = `chunk-${chunkIndex++}`;
      
      el.setAttribute('data-ai-id', id);
      aiText += `[ID:${id}]${text}[FIN ID]\n\n`;
    });
    
    console.log(`Tagged ${chunkIndex} elements.`);
    return aiText;
  }

  splitTextIntoChunks(text, chunkSize) {
    const chunks = [];
    const overlapSize = Math.floor(chunkSize * 0.2); 
    let startIndex = 0;

    while (startIndex < text.length) {
      const endIndex = Math.min(startIndex + chunkSize, text.length);
      
      let finalEndIndex = endIndex;
      if (endIndex < text.length) {
        const cutIndex = text.lastIndexOf('[FIN ID]', endIndex);
        if (cutIndex > startIndex) {
          finalEndIndex = cutIndex + 8;
        }
      }

      const chunk = text.substring(startIndex, finalEndIndex);
      chunks.push(chunk);

      if (finalEndIndex === text.length) {
        break;
      }

      startIndex = finalEndIndex - overlapSize;
      if (startIndex < 0) startIndex = 0;
    }
    return chunks;
  }

  async tryLocalAI(query, text) {
    try {
      const nanoText = text.substring(0, this.MAX_CHARS_PER_CALL);
      if (window.ai && window.ai.prompt) {
        console.log('Trying local AI (Gemini Nano)...');
        const prompt = this.buildPrompt(query, nanoText);
        const response = await window.ai.prompt(prompt);
        return this.parseAIResponse(response);
      } else {
        throw new Error('Local AI (Gemini Nano) is not available in this browser.');
      }
    } catch (error) {
      console.log('Local AI failed:', error.message);
      return null;
    }
  }

  async useGeminiAPI(query, text, apiKey) {
    if (!apiKey) throw new Error('API key required.');
    if (!navigator.onLine) throw new Error('Network connection required.');

    const prompt = this.buildPrompt(query, text);
    
    const generationConfig = {
      temperature: 0.1,
      topK: 32,
      topP: 0.95,
      maxOutputTokens: 8192,
    };
    
    const requestBody = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: generationConfig,
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
      ]
    });

    try {
      console.log('Sending request to Gemini API...');
      const model = "gemini-2.5-flash";
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody
        }
      );

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
        if (data.promptFeedback?.blockReason) {
          throw new Error(`API blocked request: ${data.promptFeedback.blockReason}`);
        }
        throw new Error('Invalid response format from Gemini API (No candidate text)');
      }

      const responseText = data.candidates[0].content.parts[0].text;
      return this.parseAIResponse(responseText);
      
    } catch (error) {
      console.error('Gemini API call failed:', error);
      throw error;
    }
  }

  buildPrompt(query, text) {
    return `You are a text analysis engine.
Your task is to analyze the <TEXT_TO_ANALYZE> based on the user's <QUERY>.
The text is composed of passages, each marked with an ID like [ID:chunk-123]...[FIN ID].
Your response MUST be ONLY a valid JSON array.
Do NOT include any pre-amble or explanation.
<QUERY>
${query}
</QUERY>
<TEXT_TO_ANALYZE>
${text}
</TEXT_TO_ANALYZE>
Return ONLY a JSON array. Each object in the array must have:
1. "text": an exact text snippet (5-50 words) from the passage.
2. "category": a concise (1-3 words) category label based on the <QUERY>. (e.g., "definition", "risk", "goal").
3. "reason": a brief explanation.
4. "passage_id": The ID (e.g., "chunk-123") of the passage where you found the text.
Example response:
[
  {
    "text": "machine learning algorithm is a type of AI",
    "category": "definition",
    "reason": "defines a technical concept",
    "passage_id": "chunk-42"
  }
]`;
  }

  parseAIResponse(response) {
    try {
      const cleanedResponse = response.replace(/```json\n?|\n?```/g, '').trim();
      const jsonMatch = cleanedResponse.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          const validItems = parsed.filter(item => 
            item.text && 
            item.category && 
            item.passage_id 
          );
          if (validItems.length > 0) {
            console.log(`Parsed ${validItems.length} items from AI response`);
            return { categories: validItems };
          }
        }
      }
      console.warn('Could not find valid JSON in AI response', response);
      return { categories: [] };
    } catch (error) {
      console.error('Failed to parse AI response:', error, 'Response:', response);
      return { categories: [] };
    }
  }

  applyHighlights(categories) {
    const highlightedKeys = new Set(); 
    const passagesToHighlight = new Map();

    categories.forEach((item, index) => {
      const uniqueKey = `${item.passage_id}:${item.text.toLowerCase().trim()}`;
      if (highlightedKeys.has(uniqueKey)) {
        return; 
      }
      highlightedKeys.add(uniqueKey);

      const categoryKey = item.category.toLowerCase();
      if (!this.highlightColors.has(categoryKey)) {
        const newColor = this.generateRandomColor();
        this.highlightColors.set(categoryKey, newColor);
        console.log(`Generated new color for category '${categoryKey}': ${newColor}`);
      }
      item.color = this.highlightColors.get(categoryKey);

      if (!passagesToHighlight.has(item.passage_id)) {
        passagesToHighlight.set(item.passage_id, []);
      }
      passagesToHighlight.get(item.passage_id).push(item);
    });
    
    console.log(`Applying highlights to ${passagesToHighlight.size} elements...`);
    passagesToHighlight.forEach((items, passage_id) => {
      this.highlightTextInElement(passage_id, items);
    });
  }


  highlightTextInElement(passage_id, items) {
    const element = document.querySelector(`[data-ai-id="${passage_id}"]`);
    if (!element) {
      console.warn(`Element with ID ${passage_id} not found.`);
      return;
    }

    const uniqueId = `${passage_id}-style`;
    
    const isFormulaBlock = element.classList.contains('katex') || 
                           element.classList.contains('katex-display') || 
                           element.classList.contains('MathJax_Display');

    if (isFormulaBlock) {
      const item = items[0]; 
      console.log(`Highlighting formula block ${passage_id}`);
      element.style.backgroundColor = item.color;
      element.style.padding = '2px 4px';
      element.style.borderRadius = '3px';
      element.style.cursor = 'help';
      element.setAttribute('title', `${item.category}: ${item.reason || item.text}`);
      
      this.styledElements.set(uniqueId, {
        element: element,
        originalStyle: element.style.cssText
      });
      return;
    }

    try {
      items.sort((a, b) => b.text.length - a.text.length);
      let currentHtml = element.innerHTML;

      items.forEach((item, index) => {
        const cleanedText = item.text.trim().replace(/\.$/, '');
        if (cleanedText.length < 2) return;

        const baseEscapedText = this.escapeRegExp(cleanedText);
        const regexText = baseEscapedText.split(/\\n|\\s/g).filter(Boolean).join('(<[^>]+>|\\s|\\n|&nbsp;)*?');
        const regex = new RegExp(regexText, 'gi');

        const color = item.color;
        const itemUniqueId = `${passage_id}-${index}`;
        
        let matchFound = false;
        currentHtml = currentHtml.replace(regex, (match) => {
          if (match.includes('class="ai-highlight"')) {
            return match; 
          }
          
          matchFound = true;
          const span = document.createElement('span');
          span.className = 'ai-highlight';
          span.style.backgroundColor = color;
          span.style.cursor = 'help';
          span.setAttribute('data-category', item.category);
          span.setAttribute('data-highlight-id', itemUniqueId);
          span.setAttribute('title', `${item.category}: ${item.reason || ''}`);
          span.innerHTML = match; 

          this.highlights.set(itemUniqueId, span); 
          return span.outerHTML;
        });
        
        if (!matchFound) {
           console.warn(`Text not found *within* its passage: ${cleanedText} in [${passage_id}]`);
        }
      });

      element.innerHTML = currentHtml;

      element.querySelectorAll('.ai-highlight').forEach(span => {
        const id = span.getAttribute('data-highlight-id');
        this.highlights.set(id, span);
      });

    } catch (error) {
      console.warn('Failed to highlight text:', items[0].text, error);
    }
  }

  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  clearHighlights() {
    this.highlights.forEach(highlight => {
      const parent = highlight.parentNode;
      if (parent) {
        while (highlight.firstChild) {
          parent.insertBefore(highlight.firstChild, highlight);
        }
        parent.removeChild(highlight);
        parent.normalize(); 
      }
    });
    this.highlights.clear();

    this.styledElements.forEach((data) => {
      data.element.style.cssText = data.originalStyle;
      data.element.removeAttribute('title');
    });
    this.styledElements.clear();

    const taggedElements = document.querySelectorAll('[data-ai-id]');
    taggedElements.forEach(el => {
      el.removeAttribute('data-ai-id');
    });

    this.highlightColors.clear();
    chrome.runtime.sendMessage({ type: 'CLEAR_LEGEND' }).catch(e => console.log("Sidepanel not open."));
    
    console.log('Highlights cleared successfully');
  }
}

// Initialiser le highlighter
console.log('Creating AIHighlighter instance...');
const highlighter = new AIHighlighter();
console.log('AIHighlighter instance created');

// Écouteur de messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request.action);
  
  if (request.action === 'analyzeAndHighlight') {
    console.log('Starting analysis with query:', request.query);
    highlighter.analyzeAndHighlight(request.query, request.apiKey)
      .then(result => {
        console.log('Analysis completed with result:', result);
        sendResponse(result);
      })
      .catch(error => {
        console.error('Analysis failed:', error);
        highlighter.clearHighlights(); 
        sendResponse({ 
          success: false, 
          error: error.message,
          details: { stack: error.stack }
        });
      });
    return true; 
  }
  
  if (request.action === 'clearHighlights') {
    console.log('Clearing highlights');
    highlighter.clearHighlights();
    sendResponse({ success: true });
  }
  
  // Répondre à un message de test pour vérifier que le content script fonctionne
  if (request.action === 'ping') {
    console.log('Received ping, responding with pong');
    sendResponse({ success: true, message: 'pong' });
  }
});

console.log('AI Highlighter content script fully loaded and listening');
