/**
 * Ollama API provider
 * Handles communication with local Ollama instance
 */

const OLLAMA_API_URL = process.env.OLLAMA_API_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:12b';

/**
 * Generate content using Ollama API
 * @param {string} prompt - The prompt to send
 * @returns {Promise<string>} - The response text
 */
async function generateContent(prompt) {
  try {
    const response = await fetch(`${OLLAMA_API_URL}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: prompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorDetails;
      try {
        errorDetails = JSON.parse(errorText);
      } catch {
        errorDetails = errorText;
      }
      console.error('Ollama API error:', {
        status: response.status,
        statusText: response.statusText,
        details: errorDetails,
      });
      throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${typeof errorDetails === 'object' ? JSON.stringify(errorDetails) : errorDetails}`);
    }

    const data = await response.json();
    return data.response;
  } catch (error) {
    if (error.message.startsWith('Ollama API error:')) {
      throw error;
    }
    console.error('Ollama request failed:', {
      message: error.message,
      cause: error.cause,
      stack: error.stack,
    });
    throw new Error(`Ollama request failed: ${error.message}`);
  }
}

module.exports = {
  generateContent,
};
