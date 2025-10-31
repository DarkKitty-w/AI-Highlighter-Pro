class AIHighlighter {
  constructor() {
    this.highlightColors = {
      goal: '#FFA500',
      definition: '#90EE90', 
      keypoint: '#87CEEB',
      risk: '#FFB6C1',
      date: '#DDA0DD',
      default: '#FFFF00'
    };
    this.highlights = new Map();
    this.MAX_CHARS_PER_CALL = 10000;
    // --- FIX DÉFINITIF: La variable TOTAL_MAX_CHARS a été supprimée ---
  }

  async analyzeAndHighlight(query, apiKey) {
    try {
      this.sendProgress('Extracting text from page...');
      // --- FIX DÉFINITIF: extractPageText() lit maintenant TOUT le texte ---
      const pageText = this.extractPageText();
      
      if (!pageText || pageText.length < 50) {
        throw new Error('No sufficient text content found on this page. The page might be empty or contain mostly non-text elements.');
      }

      this.sendProgress('Trying local AI (Gemini Nano)...');
      let result = await this.tryLocalAI(query, pageText);
      let aiUsed = 'local';
      
      if (!result || !result.categories || result.categories.length === 0) {
        this.sendProgress('Local AI unavailable, trying cloud API...');
        
        // Logique de Découpage (Chunking)
        if (pageText.length > this.MAX_CHARS_PER_CALL) {
          this.sendProgress(`Text is large (${pageText.length} chars). Splitting into overlapping chunks...`);
          const chunks = this.splitTextIntoChunks(pageText, this.MAX_CHARS_PER_CALL);
          // --- VÉRIFIEZ CE CHIFFRE : Il devrait être bien supérieur à 6 ---
          this.sendProgress(`Analyzing ${chunks.length} chunks in parallel...`); 

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
          this.sendProgress('Analyzing text with cloud API...');
          result = await this.useGeminiAPI(query, pageText, apiKey);
        }
        
        aiUsed = 'cloud';
      }

      if (result && result.categories && result.categories.length > 0) {
        this.sendProgress(`Applying ${result.categories.length} highlights...`);
        this.applyHighlights(result.categories);
        return { 
          success: true, 
          highlightCount: this.highlights.size, 
          aiUsed: aiUsed,
          textLength: pageText.length
        };
      } else {
        throw new Error('AI analysis completed but no relevant content was found. This can happen if API filters blocked the content or no matches exist.');
      }
      
    } catch (error) {
      console.error('Analysis error:', error);
      return { 
        success: false, 
        error: error.message,
        details: {
          type: error.name,
          stack: error.stack,
          timestamp: new Date().toISOString()
        }
      };
    }
  }

  sendProgress(message) {
    chrome.runtime.sendMessage({
      type: 'ANALYSIS_PROGRESS', 
      message: message
    }).catch(() => {
      // Ignorer les erreurs
    });
  }

  // Découpage avec Chevauchement (Overlap)
  splitTextIntoChunks(text, chunkSize) {
    const chunks = [];
    const overlapSize = Math.floor(chunkSize * 0.2); // 20% de chevauchement
    let startIndex = 0;

    while (startIndex < text.length) {
      const endIndex = Math.min(startIndex + chunkSize, text.length);
      const chunk = text.substring(startIndex, endIndex);
      chunks.push(chunk);

      if (endIndex === text.length) {
        break;
      }

      startIndex += (chunkSize - overlapSize);
      
      // S'assurer qu'on ne rate pas la fin
      if (startIndex >= text.length - overlapSize && startIndex < text.length) {
         chunks.push(text.substring(startIndex));
         break;
      }
    }
    return chunks;
  }

  async tryLocalAI(query, text) {
    try {
      // Limiter le texte pour Nano, qui est moins puissant
      const nanoText = text.substring(0, this.MAX_CHARS_PER_CALL);
      if (window.ai && window.ai.prompt) {
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
    if (!apiKey) {
      throw new Error('API key required for cloud AI. Please provide your Gemini API key in the extension panel.');
    }
    if (!navigator.onLine) {
      throw new Error('Network connection required for cloud AI. Please check your internet connection.');
    }

    const prompt = this.buildPrompt(query, text);
    
    const generationConfig = {
      temperature: 0.1,
      topK: 32,
      topP: 0.95,
      maxOutputTokens: 8192,
    };
    
    const requestBody = JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
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
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 404) {
          // Logique de Fallback (inchangée)
          const alternativeModels = [
            { name: "gemini-1.5-pro-latest", version: "v1beta" },
            { name: "gemini-1.0-pro", version: "v1" }
          ];
          for (const altModel of alternativeModels) {
            try {
              const altResponse = await fetch(
                `https://generativelanguage.googleapis.com/${altModel.version}/models/${altModel.name}:generateContent?key=${apiKey}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: requestBody }
              );
              if (altResponse.ok) {
                const altData = await altResponse.json();
                if (altData.candidates?.[0]?.content?.parts?.[0]?.text) {
                  return this.parseAIResponse(altData.candidates[0].content.parts[0].text);
                }
              }
            } catch (altError) { continue; }
          }
          throw new Error(`All models failed. Primary and fallbacks could not be reached.`);
        } else if (response.status === 401) {
          throw new Error('Invalid API key. Please check your Gemini API key.');
        } else if (response.status === 429) {
          throw new Error('API quota exceeded. Please try again later.');
        } else {
          throw new Error(`API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
        }
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
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('Network error. Please check your internet connection.');
      }
      throw error;
    }
  }

  // --- FIX DÉFINITIF: La limite TOTAL_MAX_CHARS a été supprimée ---
  extractPageText() {
    const clone = document.cloneNode(true);
    clone.querySelectorAll('script, style, nav, footer, header, iframe, noscript, .ads, .advertisement').forEach(el => el.remove());
    
    const text = clone.body?.innerText || '';
    
    const cleanedText = text
      .replace(/(\n\s*){2,}/g, '\n') // Standardise les sauts de paragraphe
      .replace(/[ \t]+/g, ' ')       // Compresse les espaces
      .replace(/ \n/g, '\n')        // Nettoie les fins de ligne
      .trim();

    // Il n'y a plus de 'if' ou de '.substring()' ici.
    return cleanedText;
  }
  // --- Fin du fix ---

  buildPrompt(query, text) {
    return `You are a silent text analysis engine.
Your ONLY task is to extract information from the <TEXT_TO_ANALYZE> based on the user's <QUERY>.
Your response MUST be ONLY a valid JSON array.
Do NOT include any pre-amble, explanation, or conversational text before or after the JSON.
<QUERY>
${query}
</QUERY>
<TEXT_TO_ANALYZE>
${text}
</TEXT_TO_ANALYZE>
Return ONLY a JSON array where each object has:
- "text": an exact text snippet (2-15 words) from the <TEXT_TO_ANALYZE>.
- "category": one of: goal, definition, keypoint, risk, date, or another relevant category based on the <QUERY>.
- "reason": a brief explanation for why this snippet matches the category.
IMPORTANT:
- Find ALL possible matches, not just a few.
- If the <QUERY> has multiple parts (e.g., "definitions and formulas"), find all items for ALL parts.
Example response:
[
  {"text": "complete project by Q4 2024", "category": "goal", "reason": "mentions project completion timeline"},
  {"text": "machine learning algorithm", "category": "definition", "reason": "defines a technical concept"}
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
            item.text && item.category && item.reason &&
            typeof item.text === 'string' &&
            item.text.length >= 2 && item.text.length <= 200
          );
          if (validItems.length > 0) {
            return { categories: validItems };
          }
        }
      }
      // Ne pas lancer d'erreur si un chunk est vide, juste retourner vide
      return { categories: [] };
    } catch (error) {
      console.error('Failed to parse AI response:', error, 'Response:', response);
      return { categories: [] }; // Renvoyer vide en cas d'erreur de parsing
    }
  }

  applyHighlights(categories) {
    this.clearHighlights();
    const highlightedTexts = new Set(); 
    
    categories.forEach((item, index) => {
      const uniqueKey = item.text.toLowerCase().trim();
      if (highlightedTexts.has(uniqueKey)) {
        return; // Empêche les doublons du chevauchement
      }
      const color = this.highlightColors[item.category] || this.highlightColors.default;
      const success = this.highlightText(item.text, color, item.category, index, item.reason);
      if (success) {
        highlightedTexts.add(uniqueKey);
      }
    });
  }

  highlightText(text, color, category, id, reason) {
    if (!text || text.length < 2) return false;
    
    try {
      const escapedText = this.escapeRegExp(text);
      const regex = new RegExp(escapedText, 'gi');
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: function(node) {
            if (node.parentNode.nodeName === 'SCRIPT' || 
                node.parentNode.nodeName === 'STYLE' ||
                node.parentNode.style?.display === 'none' ||
                node.parentNode.style?.visibility === 'hidden') {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        },
        false
      );

      let found = false;
      let node;
      const nodesToProcess = [];
      while (node = walker.nextNode()) {
        if (node.textContent.match(regex)) {
          nodesToProcess.push(node);
        }
      }
      
      nodesToProcess.reverse().forEach(node => {
        const matches = [...node.textContent.matchAll(regex)];
        matches.reverse().forEach(match => {
          const matchText = match[0];
          const matchIndex = match.index;
          const span = document.createElement('span');
          span.className = 'ai-highlight';
          span.style.backgroundColor = color;
          span.style.cursor = 'help';
          span.style.borderRadius = '2px';
          span.style.padding = '1px 2px';
          span.setAttribute('data-category', category);
          span.setAttribute('data-highlight-id', `${id}-${matchIndex}`);
          span.setAttribute('title', `${category}: ${reason}`);
          
          try {
            const newNode = node.splitText(matchIndex);
            newNode.splitText(matchText.length);
            span.appendChild(newNode.cloneNode(true));
            newNode.parentNode.replaceChild(span, newNode);
            this.highlights.set(`${id}-${matchIndex}`, span);
            found = true;
          } catch (e) {
            console.warn('Error splitting text node for highlight:', e);
          }
        });
      });

      if (!found) {
        console.warn('Text not found for highlighting:', text.substring(0, 50));
      }
      return found;
    } catch (error) {
      console.warn('Failed to highlight text:', text.substring(0, 50), error);
      return false;
    }
  }

  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  clearHighlights() {
    this.highlights.forEach(highlight => {
      const parent = highlight.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
        parent.normalize();
      }
    });
    this.highlights.clear();
  }
}

// Initialiser le highlighter
const highlighter = new AIHighlighter();

// Écouteur de messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analyzeAndHighlight') {
    highlighter.analyzeAndHighlight(request.query, request.apiKey)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ 
        success: false, 
        error: error.message,
        details: { stack: error.stack }
      }));
    return true; // Indique une réponse asynchrone
  }
  
  if (request.action === 'clearHighlights') {
    highlighter.clearHighlights();
    sendResponse({ success: true });
  }
});
