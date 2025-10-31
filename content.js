console.log('AI Highlighter content script loaded');

class AIHighlighter {
  constructor() {
    console.log('AIHighlighter initialized');
    this.highlightColors = new Map();
    this.highlights = new Map();
    this.styledElements = new Map();
    this.MAX_CHARS_PER_CALL = 15000;
    this.localAIAvailable = null; // Cache pour la détection Gemini Nano
  }

  generateRandomColor() {
    const hue = Math.floor(Math.random() * 360);
    const saturation = Math.floor(Math.random() * 20) + 70;
    const lightness = Math.floor(Math.random() * 10) + 80;
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

  async analyzeAndHighlight(query, apiKey) {
    try {
      this.sendProgress('Step 1/4: Mapping page elements (including formulas)...');
      const pageText = this.extractPageTextAndTagElements(); 
      
      if (!pageText || pageText.length < 50) {
        throw new Error('No sufficient text content found on this page.');
      }

      console.log(`Extracted ${pageText.length} characters of text`);

      // Vérifier Gemini Nano une seule fois par session
      if (this.localAIAvailable === null) {
        this.localAIAvailable = await this.checkGeminiNanoAvailability();
        console.log(`Gemini Nano available: ${this.localAIAvailable}`);
      }

      this.sendProgress('Trying local AI (Gemini Nano)...');
      let result = await this.tryLocalAI(query, pageText);
      let aiUsed = 'local';
      
      if (!result || !result.categories || result.categories.length === 0) {
        this.sendProgress('Local AI unavailable, trying cloud API...');
        
        if (pageText.length > this.MAX_CHARS_PER_CALL) {
          this.sendProgress(`Step 2/4: Splitting ${pageText.length} chars into overlapping chunks...`);
          const chunks = this.splitTextIntoChunks(pageText, this.MAX_CHARS_PER_CALL);
          this.sendProgress(`Step 3/4: Analyzing ${chunks.length} chunks in parallel...`);

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

      if (result && result.categories && result.categories.length > 0) {
        this.sendProgress(`Step 4/4: Applying ${result.categories.length} highlights...`);
        this.applyHighlights(result.categories);

        const colorsPayload = Object.fromEntries(this.highlightColors);
        chrome.runtime.sendMessage({ 
          type: 'UPDATE_LEGEND', 
          payload: colorsPayload
        }).catch(e => console.log("Sidepanel not open, can't update legend."));

        console.log(`Analysis completed successfully with ${this.highlights.size + this.styledElements.size} highlights`);
        
        return { 
          success: true, 
          highlightCount: this.highlights.size + this.styledElements.size,
          aiUsed: aiUsed,
          textLength: pageText.length
        };
      } else {
        throw new Error('AI analysis completed but no relevant content was found.');
      }
      
    } catch (error) {
      console.error('Analysis error:', error);
      this.clearHighlights();
      return { 
        success: false, 
        error: error.message,
        details: { type: error.name, stack: error.stack }
      };
    }
  }

  // NOUVELLE FONCTION : Vérifie la disponibilité de Gemini Nano
  async checkGeminiNanoAvailability() {
    try {
      console.log('Checking for Gemini Nano availability...');
      
      // Vérifier si l'API window.ai existe
      if (typeof window.ai === 'undefined') {
        console.log('❌ window.ai not available');
        return false;
      }

      // Méthode 1: Vérifier la propriété 'available' (API standard)
      if (window.ai.available) {
        try {
          const availability = await window.ai.available;
          console.log(`Gemini Nano availability: ${availability}`);
          if (availability === 'readily' || availability === 'after-download') {
            console.log('✅ Gemini Nano available via window.ai.available');
            return true;
          }
        } catch (e) {
          console.log('window.ai.available check failed:', e);
        }
      }

      // Méthode 2: Vérifier les méthodes directes
      const hasPrompt = typeof window.ai.prompt === 'function';
      const hasCreateTextSession = typeof window.ai.createTextSession === 'function';
      
      console.log(`Gemini Nano methods - prompt: ${hasPrompt}, createTextSession: ${hasCreateTextSession}`);
      
      if (hasPrompt || hasCreateTextSession) {
        console.log('✅ Gemini Nano API methods detected');
        return true;
      }

      // Méthode 3: Vérifier canCreateTextSession
      if (typeof window.ai.canCreateTextSession === 'function') {
        try {
          const canCreate = await window.ai.canCreateTextSession();
          console.log(`Gemini Nano canCreateTextSession: ${canCreate}`);
          return canCreate;
        } catch (e) {
          console.log('window.ai.canCreateTextSession check failed:', e);
        }
      }

      console.log('❌ No usable Gemini Nano API found');
      return false;
      
    } catch (error) {
      console.log('Error checking Gemini Nano availability:', error);
      return false;
    }
  }

  async tryLocalAI(query, text) {
    // Si Gemini Nano n'est pas disponible, retourner null immédiatement
    if (!this.localAIAvailable) {
      return null;
    }

    try {
      console.log('🔄 Using local AI (Gemini Nano)');
      
      // Limite conservatrice pour Gemini Nano
      const nanoText = text.substring(0, Math.min(this.MAX_CHARS_PER_CALL, 30000));
      console.log(`Sending ${nanoText.length} chars to Gemini Nano`);
      
      const prompt = this.buildPrompt(query, nanoText);
      let response;

      // Essayer différentes méthodes d'appel de Gemini Nano
      
      // Méthode 1: window.ai.prompt (API simple)
      if (typeof window.ai.prompt === 'function') {
        console.log('Using window.ai.prompt');
        response = await window.ai.prompt(prompt);
      }
      // Méthode 2: window.ai.createTextSession (API session)
      else if (typeof window.ai.createTextSession === 'function') {
        console.log('Using window.ai.createTextSession');
        const session = await window.ai.createTextSession();
        response = await session.prompt(prompt);
      }
      // Méthode 3: window.ai.canCreateTextSession (API moderne)
      else if (typeof window.ai.canCreateTextSession === 'function') {
        console.log('Using window.ai.canCreateTextSession');
        const canCreate = await window.ai.canCreateTextSession();
        if (canCreate) {
          const session = await window.ai.createTextSession();
          response = await session.prompt(prompt);
        } else {
          throw new Error('Cannot create text session');
        }
      }
      else {
        throw new Error('No compatible Gemini Nano API method found');
      }

      console.log('✅ Gemini Nano response received');
      return this.parseAIResponse(response);
      
    } catch (error) {
      console.log('❌ Local AI (Gemini Nano) failed:', error.message);
      // En cas d'échec, marquer comme non disponible pour cette session
      this.localAIAvailable = false;
      return null;
    }
  }

  sendProgress(message) {
    console.log('Progress:', message);
    chrome.runtime.sendMessage({
      type: 'ANALYSIS_PROGRESS', 
      message: message
    }).catch(() => {});
  }

  extractPageTextAndTagElements() {
    this.clearHighlights(); 
    let aiText = "";
    let chunkIndex = 0;

    const selectors = 'p, li, dd, h1, h2, h3, h4, th, td, blockquote, pre, .katex, .katex-display, .MathJax_Display';
    const elements = document.body.querySelectorAll(selectors);

    console.log(`Found ${elements.length} potential text elements`);

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

    console.log(`Tagged ${chunkIndex} elements with data-ai-id`);
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
    
    console.log(`Split text into ${chunks.length} chunks`);
    return chunks;
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
      const model = "gemini-2.5-flash";
      console.log('🌐 Sending request to Gemini API...');
      
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API response error:', errorText);
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
      console.log('✅ Received response from Gemini API');
      return this.parseAIResponse(responseText);
      
    } catch (error) {
      console.error('Gemini API error:', error);
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
      console.log('Parsing AI response...');
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
          console.log(`Parsed ${validItems.length} valid categories from AI response`);
          if (validItems.length > 0) {
            return { categories: validItems };
          }
        }
      }
      console.log('No valid categories found in AI response');
      return { categories: [] };
    } catch (error) {
      console.error('Failed to parse AI response:', error, 'Response:', response);
      return { categories: [] };
    }
  }

  applyHighlights(categories) {
    console.log(`Applying highlights for ${categories.length} categories`);
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
        console.log(`Generated color ${newColor} for category: ${categoryKey}`);
        this.highlightColors.set(categoryKey, newColor);
      }
      item.color = this.highlightColors.get(categoryKey);

      if (!passagesToHighlight.has(item.passage_id)) {
        passagesToHighlight.set(item.passage_id, []);
      }
      passagesToHighlight.get(item.passage_id).push(item);
    });

    console.log(`Highlighting ${passagesToHighlight.size} unique passages`);
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
      element.style.backgroundColor = item.color;
      element.style.padding = '2px 4px';
      element.style.borderRadius = '3px';
      element.style.cursor = 'help';
      element.setAttribute('title', `${item.category}: ${item.reason || item.text}`);
      
      this.styledElements.set(uniqueId, {
        element: element,
        originalStyle: element.style.cssText
      });
      console.log(`Styled formula element: ${passage_id}`);
      return;
    }

    try {
      // NOUVELLE APPROCHE : Recherche par mots-clés pour les textes longs
      items.sort((a, b) => b.text.length - a.text.length);
      
      const elementText = element.textContent || element.innerText;
      let currentHtml = element.innerHTML;
      let foundAny = false;

      items.forEach((item, index) => {
        const cleanedText = item.text.trim();
        if (cleanedText.length < 2) return;

        // STRATÉGIE AMÉLIORÉE : Recherche par étapes
        let found = false;
        
        // Étape 1: Recherche exacte du texte complet
        if (elementText.includes(cleanedText)) {
          found = this.highlightExactMatch(currentHtml, cleanedText, item, passage_id, index);
          if (found) {
            currentHtml = found.newHtml;
            foundAny = true;
            console.log(`✓ Exact match: "${cleanedText.substring(0, 50)}..."`);
          }
        }
        
        // Étape 2: Si texte trop long, chercher par phrases
        if (!found && cleanedText.length > 100) {
          const sentences = this.splitIntoSentences(cleanedText);
          for (const sentence of sentences) {
            if (sentence.length > 20 && elementText.includes(sentence)) {
              found = this.highlightExactMatch(currentHtml, sentence, item, passage_id, index);
              if (found) {
                currentHtml = found.newHtml;
                foundAny = true;
                console.log(`✓ Sentence match: "${sentence.substring(0, 50)}..."`);
                break;
              }
            }
          }
        }
        
        // Étape 3: Recherche par mots-clés significatifs
        if (!found) {
          const keywords = this.extractKeywords(cleanedText);
          for (const keyword of keywords) {
            if (keyword.length > 10 && elementText.includes(keyword)) {
              found = this.highlightExactMatch(currentHtml, keyword, item, passage_id, index);
              if (found) {
                currentHtml = found.newHtml;
                foundAny = true;
                console.log(`✓ Keyword match: "${keyword}"`);
                break;
              }
            }
          }
        }

        // Étape 4: Recherche avec caractères normalisés
        if (!found) {
          const normalizedPatterns = this.generateNormalizedPatterns(cleanedText);
          for (const pattern of normalizedPatterns) {
            if (elementText.includes(pattern)) {
              found = this.highlightExactMatch(currentHtml, pattern, item, passage_id, index);
              if (found) {
                currentHtml = found.newHtml;
                foundAny = true;
                console.log(`✓ Normalized match: "${pattern.substring(0, 50)}..."`);
                break;
              }
            }
          }
        }

        if (!found) {
          console.warn(`Text not found *within* its passage: ${cleanedText} in [${passage_id}]`);
        }
      });

      // Appliquer les changements seulement si on a trouvé des correspondances
      if (foundAny) {
        element.innerHTML = currentHtml;

        // Mettre à jour la map des highlights
        element.querySelectorAll('.ai-highlight').forEach(span => {
          const id = span.getAttribute('data-highlight-id');
          if (id) {
            this.highlights.set(id, span);
          }
        });

        console.log(`✓ Highlighted items in element: ${passage_id}`);
      } else {
        console.warn(`✗ No text matches found in element: ${passage_id}`);
      }

    } catch (error) {
      console.error('Failed to highlight text in element:', passage_id, error);
    }
  }

  // NOUVELLE FONCTION : Met en évidence une correspondance exacte
  highlightExactMatch(html, textToHighlight, item, passage_id, index) {
    try {
      const color = item.color;
      const itemUniqueId = `${passage_id}-${index}`;
      
      const span = document.createElement('span');
      span.className = 'ai-highlight';
      span.style.backgroundColor = color;
      span.style.cursor = 'help';
      span.setAttribute('data-category', item.category);
      span.setAttribute('data-highlight-id', itemUniqueId);
      span.setAttribute('title', `${item.category}: ${item.reason || ''}`);
      span.textContent = textToHighlight;

      const newHtml = html.replace(textToHighlight, span.outerHTML);
      this.highlights.set(itemUniqueId, span);
      
      return { success: true, newHtml };
    } catch (error) {
      console.warn(`Failed to highlight exact match: ${textToHighlight}`, error);
      return { success: false, newHtml: html };
    }
  }

  // NOUVELLE FONCTION : Divise le texte en phrases
  splitIntoSentences(text) {
    // Divise par les points, points d'exclamation, points d'interrogation, etc.
    return text.split(/[.!?]+/).filter(sentence => 
      sentence.trim().length > 10 // Seulement les phrases significatives
    ).map(sentence => sentence.trim());
  }

  // NOUVELLE FONCTION : Extrait les mots-clés significatifs
  extractKeywords(text) {
    const words = text.split(/\s+/);
    return words.filter(word => 
      word.length > 5 && // Mots assez longs
      !this.isCommonWord(word) // Pas des mots trop communs
    );
  }

  // NOUVELLE FONCTION : Vérifie si un mot est trop commun
  isCommonWord(word) {
    const commonWords = ['dans', 'pour', 'avec', 'sans', 'sous', 'sur', 'entre', 'parmi', 'pendant', 'depuis'];
    return commonWords.includes(word.toLowerCase());
  }

  // NOUVELLE FONCTION : Génère des patterns avec caractères normalisés
  generateNormalizedPatterns(text) {
    const patterns = [];
    
    // Pattern original
    patterns.push(text);
    
    // Pattern sans ponctuation finale
    const withoutFinalPunctuation = text.replace(/[.,;:!?]$/, '');
    if (withoutFinalPunctuation !== text) {
      patterns.push(withoutFinalPunctuation);
    }
    
    // Pattern avec espaces normalisés
    const normalizedSpaces = text.replace(/\s+/g, ' ');
    if (normalizedSpaces !== text) {
      patterns.push(normalizedSpaces);
    }
    
    // Pattern avec guillemets français normalisés
    const normalizedFrenchQuotes = text
      .replace(/«\s*/g, '"')
      .replace(/\s*»/g, '"');
    if (normalizedFrenchQuotes !== text) {
      patterns.push(normalizedFrenchQuotes);
    }
    
    // Pattern avec tirets cadratins normalisés
    const normalizedDashes = text.replace(/—/g, '-');
    if (normalizedDashes !== text) {
      patterns.push(normalizedDashes);
    }
    
    // Pattern avec fractions normalisées
    const normalizedFractions = text.replace(/⁄/g, '/');
    if (normalizedFractions !== text) {
      patterns.push(normalizedFractions);
    }
    
    // Pattern avec apostrophes normalisées
    const normalizedApostrophes = text
      .replace(/[''´`]/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'");
    if (normalizedApostrophes !== text) {
      patterns.push(normalizedApostrophes);
    }
    
    // Pattern avec guillemets normalisés
    const normalizedQuotes = text
      .replace(/["""]/g, '"')
      .replace(/&quot;/g, '"')
      .replace(/&ldquo;/g, '"')
      .replace(/&rdquo;/g, '"');
    if (normalizedQuotes !== text) {
      patterns.push(normalizedQuotes);
    }
    
    return patterns.filter(pattern => pattern.length >= 5); // Patterns significatifs seulement
  }

  clearHighlights() {
    console.log('Clearing all highlights');
    
    this.highlights.forEach((highlight, id) => {
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

    this.styledElements.forEach((data, id) => {
      data.element.style.cssText = data.originalStyle;
      data.element.removeAttribute('title');
    });
    this.styledElements.clear();

    const taggedElements = document.querySelectorAll('[data-ai-id]');
    taggedElements.forEach(el => {
      el.removeAttribute('data-ai-id');
    });

    // Vider la carte des couleurs et notifier le sidepanel
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

console.log('Content script setup complete');
