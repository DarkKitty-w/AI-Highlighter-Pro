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
  }

  async analyzeAndHighlight(query, apiKey) {
    try {
      this.sendProgress('Extracting text from page...');
      const pageText = this.extractPageText();
      
      if (!pageText || pageText.length < 50) {
        throw new Error('No sufficient text content found on this page. The page might be empty or contain mostly non-text elements.');
      }

      this.sendProgress('Trying local AI (Gemini Nano)...');
      let result = await this.tryLocalAI(query, pageText);
      let aiUsed = 'local';
      
      if (!result || !result.categories || result.categories.length === 0) {
        this.sendProgress('Local AI unavailable, trying cloud API...');
        result = await this.useGeminiAPI(query, pageText, apiKey);
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
        throw new Error('AI analysis completed but no relevant content was found for your query.');
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
      // Ignore errors if no listener
    });
  }

  async tryLocalAI(query, text) {
    try {
      if (window.ai && window.ai.prompt) {
        const prompt = this.buildPrompt(query, text);
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
    
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: prompt }]
            }]
          })
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 401) {
          throw new Error('Invalid API key. Please check your Gemini API key.');
        } else if (response.status === 429) {
          throw new Error('API quota exceeded. Please try again later.');
        } else {
          throw new Error(`API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
        }
      }

      const data = await response.json();
      
      if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
        throw new Error('Invalid response format from Gemini API');
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

  extractPageText() {
    // Clone the document to avoid modifying the original
    const clone = document.cloneNode(true);
    
    // Remove unwanted elements
    clone.querySelectorAll('script, style, nav, footer, header, iframe, noscript').forEach(el => el.remove());
    
    // Get text content
    const text = clone.body?.innerText || '';
    
    // Clean up text
    return text
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 15000); // Limit for API constraints
  }

  // ... (rest of the methods from previous implementation remain the same)
  buildPrompt(query, text) {
    return `Analyze the following text and identify different categories mentioned in the query: "${query}"

TEXT TO ANALYZE:
${text}

Return ONLY a JSON array where each object has:
- "text": exact text snippet (2-15 words)
- "category": one of: goal, definition, keypoint, risk, date, or other relevant category
- "reason": brief explanation

IMPORTANT: Return ONLY valid JSON, no other text.

Example:
[
  {"text": "complete project by Q4", "category": "goal", "reason": "mentions timeline"},
  {"text": "machine learning algorithm", "category": "definition", "reason": "defines technical concept"}
]`;
  }

  parseAIResponse(response) {
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          return { categories: parsed };
        }
      }
      throw new Error('Invalid JSON response from AI');
    } catch (error) {
      console.error('Failed to parse AI response:', error, 'Response:', response);
      throw new Error('AI returned invalid format. Please try again with a different query.');
    }
  }

  applyHighlights(categories) {
    this.clearHighlights();
    
    categories.forEach((item, index) => {
      const color = this.highlightColors[item.category] || this.highlightColors.default;
      this.highlightText(item.text, color, item.category, index, item.reason);
    });
  }

  highlightText(text, color, category, id, reason) {
    if (!text || text.length < 2) return;
    
    try {
      const regex = new RegExp(this.escapeRegExp(text), 'gi');
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      let node;
      while (node = walker.nextNode()) {
        if (node.textContent.match(regex) && node.parentNode.nodeName !== 'SCRIPT') {
          const span = document.createElement('span');
          span.className = 'ai-highlight';
          span.style.backgroundColor = color;
          span.style.cursor = 'help';
          span.setAttribute('data-category', category);
          span.setAttribute('data-highlight-id', id);
          span.setAttribute('title', `${category}: ${reason}`);
          
          const newNode = node.splitText(node.textContent.indexOf(text));
          newNode.splitText(text.length);
          span.appendChild(newNode.cloneNode(true));
          newNode.parentNode.replaceChild(span, newNode);
          
          this.highlights.set(id, span);
        }
      }
    } catch (error) {
      console.warn('Failed to highlight text:', text, error);
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

// Initialize highlighter
const highlighter = new AIHighlighter();

// Message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analyzeAndHighlight') {
    highlighter.analyzeAndHighlight(request.query, request.apiKey)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ 
        success: false, 
        error: error.message,
        details: { stack: error.stack }
      }));
    return true;
  }
  
  if (request.action === 'clearHighlights') {
    highlighter.clearHighlights();
    sendResponse({ success: true });
  }
});
