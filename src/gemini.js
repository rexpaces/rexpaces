/**
 * Gemini API provider
 * Handles communication with Google Gemini API
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// Queue to ensure only one request at a time
let requestQueue = Promise.resolve();

/**
 * Parse rate limit wait time from error message
 * Looks for patterns like "Please retry in 58.384186637s"
 * @param {string} errorMessage - The error message from Gemini
 * @returns {number|null} - Wait time in milliseconds, or null if not a rate limit error
 */
function parseRateLimitWaitTime(errorMessage) {
  const match = errorMessage.match(/retry in (\d+(?:\.\d+)?)s/i);
  if (match) {
    return Math.ceil(parseFloat(match[1]) * 1000);
  }
  return null;
}

/**
 * Execute a Gemini request with retry logic for rate limits
 * @param {Function} requestFn - Async function that performs the Gemini request
 * @param {number} retryCount - Current retry attempt (starts at 0)
 * @returns {Promise<any>} - The result from Gemini
 */
async function executeWithRetry(requestFn, retryCount = 0) {
  try {
    return await requestFn();
  } catch (error) {
    const errorMessage = error.message || String(error);
    const waitTimeMs = parseRateLimitWaitTime(errorMessage);

    if (waitTimeMs !== null) {
      // Add 1 minute per retry to the wait time
      const extraWaitMs = retryCount * 60 * 1000;
      const totalWaitMs = waitTimeMs + extraWaitMs;
      const totalWaitSec = (totalWaitMs / 1000).toFixed(1);

      console.log(`Rate limit hit. Waiting ${totalWaitSec}s (retry #${retryCount + 1})...`);
      await new Promise(resolve => setTimeout(resolve, totalWaitMs));

      return executeWithRetry(requestFn, retryCount + 1);
    }

    // Not a rate limit error, rethrow
    throw error;
  }
}

/**
 * Queue a request to ensure sequential execution (no parallel requests)
 * @param {Function} requestFn - Async function that performs the Gemini request
 * @returns {Promise<any>} - The result from Gemini
 */
function queueRequest(requestFn) {
  const previousQueue = requestQueue;

  requestQueue = (async () => {
    await previousQueue;
    return executeWithRetry(requestFn);
  })();

  return requestQueue;
}

/**
 * Generate content using Gemini API
 * @param {string} prompt - The prompt to send
 * @returns {Promise<string>} - The response text
 */
async function generateContent(prompt) {
  return queueRequest(async () => {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  });
}

module.exports = {
  generateContent,
};
