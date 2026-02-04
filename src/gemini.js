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
 * Format seconds to MM:SS
 */
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Summarize a single chunk of transcript
 * @param {string} chunkText - The transcript text for this chunk
 * @param {number} chunkIndex - The chunk index
 * @param {number} startTime - Start time in seconds
 * @param {number} endTime - End time in seconds
 * @returns {Promise<string>} - 1-2 sentence summary
 */
async function summarizeChunk(chunkText, chunkIndex, startTime, endTime) {
  const prompt = `You are summarizing a segment of a conversation from a Twitter/X Space.

SEGMENT ${chunkIndex + 1} (${formatTime(startTime)} - ${formatTime(endTime)}):
${chunkText}

Provide a 1-2 sentence summary of what is discussed in this segment. Focus on the main topics, key points, or any notable moments. Be concise and factual.

Summary:`;

  return queueRequest(async () => {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  });
}

/**
 * Extract overall conversation context from chunk summaries
 * @param {Array<{index: number, startTime: number, endTime: number, summary: string}>} chunkSummaries
 * @returns {Promise<{topic: string, participants: string[], keyPoints: string[], narrative: string}>}
 */
async function extractConversationContext(chunkSummaries) {
  const summariesText = chunkSummaries
    .map(s => `[${formatTime(s.startTime)} - ${formatTime(s.endTime)}]: ${s.summary}`)
    .join('\n');

  const prompt = `You are analyzing a Twitter/X Space conversation. Below are summaries of each segment of the conversation.

SEGMENT SUMMARIES:
${summariesText}

Based on these summaries, extract the following information about the overall conversation. Respond in JSON format only, no additional text.

{
  "topic": "The main topic or theme of the conversation (1 sentence)",
  "participants": ["List of speaker names or roles mentioned, if identifiable"],
  "keyPoints": ["List of 3-5 key discussion points or themes"],
  "narrative": "A brief narrative arc of how the conversation progressed (2-3 sentences)"
}

JSON:`;

  return queueRequest(async () => {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();

    // Parse JSON from response, handling potential markdown code blocks
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse conversation context JSON');
    }

    return JSON.parse(jsonMatch[0]);
  });
}

/**
 * Detect highlights in a chunk given conversation context
 * @param {string} chunkText - The transcript text for this chunk
 * @param {number} startTime - Start time in seconds
 * @param {number} endTime - End time in seconds
 * @param {object} conversationContext - The context from extractConversationContext
 * @returns {Promise<Array<{quote: string, reason: string}>>}
 */
async function detectHighlights(chunkText, startTime, endTime, conversationContext) {
  const prompt = `You are identifying highlight-worthy moments from a Twitter/X Space conversation for creating short video clips.

CONVERSATION CONTEXT:
- Topic: ${conversationContext.topic}
- Key themes: ${conversationContext.keyPoints.join(', ')}
- Narrative: ${conversationContext.narrative}

CURRENT SEGMENT (${formatTime(startTime)} - ${formatTime(endTime)}):
${chunkText}

Identify 0-3 highlight-worthy moments from this segment. A good highlight is:
- An insightful or thought-provoking statement
- A memorable quote or strong opinion
- An interesting fact, statistic, or revelation
- A moment of humor or wit
- A key conclusion or important point

For each highlight, provide the EXACT quote (word-for-word as it appears in the text) and a brief reason why it's highlight-worthy.

Respond in JSON format only, no additional text. If no highlights are found, return an empty array.

[
  {
    "quote": "exact quote from the transcript",
    "reason": "why this is highlight-worthy"
  }
]

JSON:`;

  return queueRequest(async () => {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();

    // Parse JSON from response, handling potential markdown code blocks
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return [];
    }
  });
}

module.exports = {
  summarizeChunk,
  extractConversationContext,
  detectHighlights,
};
