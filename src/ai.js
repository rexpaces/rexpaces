/**
 * AI service abstraction layer
 * Contains prompts and business logic, uses configured provider for API calls
 */

const AI_PROVIDER = process.env.AI_PROVIDER || 'ollama';

// Lazy-load provider to avoid initialization errors when provider is not configured
let provider = null;

function getProvider() {
  if (provider) return provider;

  if (AI_PROVIDER === 'ollama') {
    provider = require('./ollama');
  } else {
    provider = require('./gemini');
  }

  return provider;
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

  const response = await getProvider().generateContent(prompt);
  return response.trim();
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

  const response = await getProvider().generateContent(prompt);
  const text = response.trim();

  // Parse JSON from response, handling potential markdown code blocks
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse conversation context JSON');
  }

  return JSON.parse(jsonMatch[0]);
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

  const response = await getProvider().generateContent(prompt);
  const text = response.trim();

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
}

module.exports = {
  summarizeChunk,
  extractConversationContext,
  detectHighlights,
};
