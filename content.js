// Content script - runs on every page
class AIHighlighter {
  constructor() {
    this.highlightColors = {
      goal: '#FFA500',       // Orange
      definition: '#90EE90', // Light Green
      keypoint: '#87CEEB',   // Sky Blue
      risk: '#FFB6C1',       // Light Pink
      date: '#DDA0DD',       // Plum
      default: '#FFFF00'     // Yellow
    };
    this.highlights = new Map();
  }

  // Main analysis function
  async analyzeAndHighlight(query, apiKey) {
    try {
      const pageText = this.extractPageText();
      
      // Try local AI first (Gemini Nano)
      let result = await this.tryLocalAI(query, pageText);
      let aiUsed = 'local';
      
      // Fallback to cloud API
      if (!result || !result.categories) {
        result = await this.useGeminiAPI(query, pageText, apiKey);
        aiUsed = 'cloud';
      }

      if (result && result.categories) {
        this.applyHighlights(result.categories);
        return { success: true, highlightCount: this.highlights.size, aiUsed };
      }
      
      throw new Error('AI analysis failed');
      
    } catch (error) {
      console.error('Analysis error:', error);
      return { success: false, error: error.message };
    }
  }

  // Try Chrome's built-in AI (Gemini Nano)
  async tryLocalAI(query, text) {
    try {
      if (window.ai && window.ai.prompt) {
        const prompt = this.buildPrompt(query, text);
        const response = await window.ai.prompt(prompt);
        return this.parseAIResponse(response);
      }
    } catch (error) {
      console.log('Local AI not available, falling back to cloud API');
    }
    return null;
  }

  // Use Gemini Cloud API
  async useGeminiAPI(query, text, apiKey) {
    if (!apiKey) throw new Error('API key required for cloud fallback');

    const prompt = this.buildPrompt(query, text);
    
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

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    
    const data = await response.json();
    const responseText = data.candidates[0].content.parts[0].text;
    
    return this.parseAIResponse(responseText);
  }

  buildPrompt(query, text) {
    return `Analyze the following text and identify different categories mentioned in the query: "${query}"

TEXT TO ANALYZE:
${text.substring(0, 10000)} // Limit text length

Return ONLY a JSON array where each object has:
- "text": exact text snippet
- "category": one of: goal, definition, keypoint, risk, date, or other relevant category
- "reason": brief explanation

Example:
[
  {"text": "complete project by Q4", "category": "goal", "reason": "mentions project completion timeline"},
  {"text": "machine learning", "category": "definition", "reason": "defines a technical concept"}
]

Return ONLY valid JSON:`;
  }

  parseAIResponse(response) {
    try {
      // Extract JSON from response (handles cases where AI adds extra text)
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return { categories: JSON.parse(jsonMatch[0]) };
      }
    } catch (error) {
      console.error('Failed to parse AI response:', error);
    }
    return null;
  }

  extractPageText() {
    // Remove script and style elements
    const clone = document.cloneNode(true);
    clone.querySelectorAll('script, style, nav, footer').forEach(el => el.remove());
    return clone.body.innerText;
  }

  applyHighlights(categories) {
    this.clearHighlights(); // Clear existing highlights

    categories.forEach((item, index) => {
      const color = this.highlightColors[item.category] || this.highlightColors.default;
      this.highlightText(item.text, color, item.category, index);
    });
  }

  highlightText(text, color, category, id) {
    const regex = new RegExp(this.escapeRegExp(text), 'gi');
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let node;
    while (node = walker.nextNode()) {
      if (node.textContent.match(regex)) {
        const span = document.createElement('span');
        span.className = 'ai-highlight';
        span.style.backgroundColor = color;
        span.style.cursor = 'pointer';
        span.setAttribute('data-category', category);
        span.setAttribute('data-highlight-id', id);
        
        // Add tooltip
        span.title = `${category}: ${text.substring(0, 50)}...`;
        
        const newNode = node.splitText(node.textContent.indexOf(text));
        newNode.splitText(text.length);
        span.appendChild(newNode.cloneNode(true));
        newNode.parentNode.replaceChild(span, newNode);
        
        this.highlights.set(id, span);
      }
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

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analyzeAndHighlight') {
    highlighter.analyzeAndHighlight(request.query, request.apiKey)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }
  
  if (request.action === 'clearHighlights') {
    highlighter.clearHighlights();
    sendResponse({ success: true });
  }
});
