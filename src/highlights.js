const fs = require('fs');
const path = require('path');
const { summarizeChunk, extractConversationContext, detectHighlights } = require('./ai');

/**
 * Group transcript segments into chunks by time
 * @param {Array} segments - Transcript segments with start/end times
 * @param {number} chunkDuration - Chunk duration in seconds
 * @returns {Array<{index: number, startTime: number, endTime: number, text: string, segments: Array}>}
 */
function groupSegmentsIntoChunks(segments, chunkDuration = 300) {
  const chunks = [];
  let currentChunk = null;

  for (const segment of segments) {
    const chunkIndex = Math.floor(segment.start / chunkDuration);
    const chunkStartTime = chunkIndex * chunkDuration;
    const chunkEndTime = chunkStartTime + chunkDuration;

    if (!currentChunk || currentChunk.index !== chunkIndex) {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      currentChunk = {
        index: chunkIndex,
        startTime: chunkStartTime,
        endTime: chunkEndTime,
        text: '',
        segments: [],
      };
    }

    currentChunk.segments.push(segment);
    currentChunk.text += segment.text + ' ';
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  // Trim text
  chunks.forEach(chunk => {
    chunk.text = chunk.text.trim();
  });

  return chunks;
}

/**
 * Pass 1: Generate summaries for all chunks
 * @param {Array} chunks - Chunks from groupSegmentsIntoChunks
 * @returns {Promise<Array<{index: number, startTime: number, endTime: number, summary: string}>>}
 */
async function generateChunkSummaries(chunks) {
  const summaries = [];

  for (const chunk of chunks) {
    console.log(`Summarizing chunk ${chunk.index + 1}/${chunks.length}...`);

    const summary = await summarizeChunk(
      chunk.text,
      chunk.index,
      chunk.startTime,
      chunk.endTime
    );

    summaries.push({
      index: chunk.index,
      startTime: chunk.startTime,
      endTime: chunk.endTime,
      summary,
    });
  }

  return summaries;
}

/**
 * Pass 2: Detect highlights in all chunks with context
 * @param {Array} chunks - Chunks from groupSegmentsIntoChunks
 * @param {object} conversationContext - Context from extractConversationContext
 * @returns {Promise<Array<{chunkIndex: number, startTime: number, endTime: number, quote: string, reason: string}>>}
 */
async function detectAllHighlights(chunks, conversationContext) {
  const allHighlights = [];

  for (const chunk of chunks) {
    console.log(`Detecting highlights in chunk ${chunk.index + 1}/${chunks.length}...`);

    const highlights = await detectHighlights(
      chunk.text,
      chunk.startTime,
      chunk.endTime,
      conversationContext
    );

    for (const highlight of highlights) {
      allHighlights.push({
        chunkIndex: chunk.index,
        chunkStartTime: chunk.startTime,
        chunkEndTime: chunk.endTime,
        ...highlight,
      });
    }
  }

  return allHighlights;
}

/**
 * Build a flat array of all words with timestamps from segments
 * @param {Array} segments - Transcript segments with word-level timestamps
 * @returns {Array<{word: string, start: number, end: number, segmentIndex: number}>}
 */
function buildWordIndex(segments) {
  const words = [];

  segments.forEach((segment, segmentIndex) => {
    if (segment.words && segment.words.length > 0) {
      segment.words.forEach(word => {
        words.push({
          word: (word.word || word.text || '').toLowerCase().trim(),
          start: word.start,
          end: word.end,
          segmentIndex,
        });
      });
    }
  });

  return words;
}

/**
 * Find a sequence of words matching the quote
 * @param {string} quote - The quote to find
 * @param {Array} wordIndex - Flat array of words with timestamps
 * @param {number} startTime - Start time boundary
 * @param {number} endTime - End time boundary
 * @returns {{start: number, end: number, words: Array, matchScore: number} | null}
 */
function findQuoteInWords(quote, wordIndex, startTime, endTime) {
  const quoteWords = quote.toLowerCase().trim().split(/\s+/).filter(w => w.length > 0);
  if (quoteWords.length === 0) return null;

  // Filter words within time boundary
  const boundedWords = wordIndex.filter(w => w.start >= startTime && w.end <= endTime);
  if (boundedWords.length === 0) return null;

  let bestMatch = null;
  let bestScore = 0;

  // Sliding window to find best match
  for (let i = 0; i <= boundedWords.length - quoteWords.length; i++) {
    let matchCount = 0;
    const windowWords = [];

    for (let j = 0; j < quoteWords.length; j++) {
      const wordObj = boundedWords[i + j];
      const cleanWord = wordObj.word.replace(/[^a-z0-9]/g, '');
      const cleanQuoteWord = quoteWords[j].replace(/[^a-z0-9]/g, '');

      windowWords.push(wordObj);

      if (cleanWord === cleanQuoteWord || cleanWord.includes(cleanQuoteWord) || cleanQuoteWord.includes(cleanWord)) {
        matchCount++;
      }
    }

    const score = matchCount / quoteWords.length;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = {
        start: windowWords[0].start,
        end: windowWords[windowWords.length - 1].end,
        words: windowWords.map(w => ({
          word: w.word,
          start: w.start,
          end: w.end,
        })),
        matchScore: score,
      };
    }

    // Perfect match found
    if (score === 1) break;
  }

  return bestMatch;
}

/**
 * Expand a highlight to include surrounding segments until minimum duration is reached
 * @param {object} highlight - Highlight with start/end timestamps
 * @param {Array} segments - Original transcript segments
 * @param {number} minDuration - Minimum clip duration in seconds
 * @returns {object} - Highlight with expanded timestamps and words
 */
function expandHighlightWithSegments(highlight, segments, minDuration = 60) {
  const currentDuration = highlight.end - highlight.start;
  if (currentDuration >= minDuration) {
    return highlight;
  }

  // Find segment indices that overlap with the highlight
  let startSegmentIdx = -1;
  let endSegmentIdx = -1;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    // Check if segment overlaps with highlight
    if (seg.end >= highlight.start && seg.start <= highlight.end) {
      if (startSegmentIdx === -1) startSegmentIdx = i;
      endSegmentIdx = i;
    }
  }

  // If no segments found, return original
  if (startSegmentIdx === -1) {
    return highlight;
  }

  // Expand segments until we reach minimum duration
  let expandedStart = segments[startSegmentIdx].start;
  let expandedEnd = segments[endSegmentIdx].end;

  while (expandedEnd - expandedStart < minDuration) {
    const canExpandBackward = startSegmentIdx > 0;
    const canExpandForward = endSegmentIdx < segments.length - 1;

    if (!canExpandBackward && !canExpandForward) break;

    // Prefer expanding backward (context/setup is usually more important)
    if (canExpandBackward) {
      startSegmentIdx--;
      expandedStart = segments[startSegmentIdx].start;
    }

    // Check if we've reached the minimum
    if (expandedEnd - expandedStart >= minDuration) break;

    // Then expand forward
    if (canExpandForward) {
      endSegmentIdx++;
      expandedEnd = segments[endSegmentIdx].end;
    }
  }

  // Collect all words from expanded segments
  const expandedWords = [];
  for (let i = startSegmentIdx; i <= endSegmentIdx; i++) {
    const seg = segments[i];
    if (seg.words && seg.words.length > 0) {
      seg.words.forEach(w => {
        expandedWords.push({
          word: w.word || w.text || '',
          start: w.start,
          end: w.end,
        });
      });
    }
  }

  return {
    ...highlight,
    // Preserve original quote boundaries
    quoteStart: highlight.start,
    quoteEnd: highlight.end,
    quoteWords: highlight.words,
    // Set expanded boundaries
    start: expandedStart,
    end: expandedEnd,
    words: expandedWords,
  };
}

/**
 * Map highlight quotes back to transcript timestamps with word-level precision
 * @param {Array} highlights - Highlights with quotes
 * @param {Array} segments - Original transcript segments with word-level timestamps
 * @returns {Array} - Highlights with start/end timestamps and words array
 */
function mapHighlightsToTimestamps(highlights, segments) {
  const wordIndex = buildWordIndex(segments);

  return highlights.map(highlight => {
    const quote = highlight.quote;

    // Try to find exact word sequence
    const match = findQuoteInWords(
      quote,
      wordIndex,
      highlight.chunkStartTime - 10, // Small buffer before chunk
      highlight.chunkEndTime + 10     // Small buffer after chunk
    );

    if (match && match.matchScore > 0.5) {
      return {
        ...highlight,
        start: match.start,
        end: match.end,
        words: match.words,
        matchScore: match.matchScore,
      };
    }

    // Fallback: find in segment text and use segment's words
    for (const segment of segments) {
      if (segment.start >= highlight.chunkStartTime && segment.end <= highlight.chunkEndTime) {
        const segmentText = segment.text.toLowerCase();
        if (segmentText.includes(quote.toLowerCase().trim())) {
          return {
            ...highlight,
            start: segment.words?.[0]?.start || segment.start,
            end: segment.words?.[segment.words.length - 1]?.end || segment.end,
            words: segment.words || [],
            matchScore: 0.7,
          };
        }
      }
    }

    // Last fallback: return chunk boundaries with no words
    return {
      ...highlight,
      start: highlight.chunkStartTime,
      end: highlight.chunkEndTime,
      words: [],
      matchScore: 0,
    };
  });
}

/**
 * Main function: Extract highlights from transcript
 * @param {object} transcript - Merged transcript with segments
 * @param {string} outputDir - Directory to save results
 * @param {object} options - Options
 * @param {number} options.chunkDuration - Chunk duration in seconds (default: 300)
 * @param {number} options.minClipDuration - Minimum clip duration in seconds (default: 60)
 * @returns {Promise<{context: object, highlights: Array}>}
 */
async function extractHighlights(transcript, outputDir, options = {}) {
  const { chunkDuration = 300, minClipDuration = 60 } = options;

  const summariesPath = path.join(outputDir, 'chunk_summaries.json');
  const contextPath = path.join(outputDir, 'conversation_context.json');

  // Always group segments into chunks (needed for highlight detection)
  console.log('Grouping segments into chunks...');
  const chunks = groupSegmentsIntoChunks(transcript.segments, chunkDuration);
  console.log(`Created ${chunks.length} chunks`);

  let summaries;
  let context;

  // Check if summaries and context already exist
  if (fs.existsSync(summariesPath) && fs.existsSync(contextPath)) {
    console.log('\nFound existing chunk_summaries.json and conversation_context.json');
    console.log('Skipping Pass 1 (summaries) and context extraction...');

    summaries = JSON.parse(fs.readFileSync(summariesPath, 'utf-8'));
    context = JSON.parse(fs.readFileSync(contextPath, 'utf-8'));

    console.log(`Loaded ${summaries.length} chunk summaries`);
    console.log(`Conversation topic: ${context.topic}`);
  } else {
    // Pass 1: Generate summaries
    console.log('\n=== Pass 1: Generating chunk summaries ===');
    summaries = await generateChunkSummaries(chunks);

    // Save summaries
    fs.writeFileSync(summariesPath, JSON.stringify(summaries, null, 2));
    console.log(`Summaries saved to: ${summariesPath}`);

    // Extract conversation context
    console.log('\nExtracting conversation context...');
    context = await extractConversationContext(summaries);

    // Save context
    fs.writeFileSync(contextPath, JSON.stringify(context, null, 2));
    console.log(`Context saved to: ${contextPath}`);
  }

  // Pass 2: Detect highlights
  console.log('\n=== Pass 2: Detecting highlights ===');
  const rawHighlights = await detectAllHighlights(chunks, context);
  console.log(`Found ${rawHighlights.length} potential highlights`);

  // Map highlights to timestamps
  console.log('\nMapping highlights to timestamps...');
  const mappedHighlights = mapHighlightsToTimestamps(rawHighlights, transcript.segments);

  // Expand highlights to minimum duration
  console.log(`\nExpanding highlights to minimum ${minClipDuration}s duration...`);
  const highlights = mappedHighlights.map(h => {
    const expanded = expandHighlightWithSegments(h, transcript.segments, minClipDuration);
    const originalDuration = (h.end - h.start).toFixed(1);
    const expandedDuration = (expanded.end - expanded.start).toFixed(1);
    if (originalDuration !== expandedDuration) {
      console.log(`  "${h.quote.substring(0, 30)}..." ${originalDuration}s -> ${expandedDuration}s`);
    }
    return expanded;
  });

  // Save highlights
  const highlightsPath = path.join(outputDir, 'highlights.json');
  fs.writeFileSync(highlightsPath, JSON.stringify(highlights, null, 2));
  console.log(`Highlights saved to: ${highlightsPath}`);

  return { context, highlights };
}

module.exports = {
  groupSegmentsIntoChunks,
  generateChunkSummaries,
  detectAllHighlights,
  buildWordIndex,
  findQuoteInWords,
  expandHighlightWithSegments,
  mapHighlightsToTimestamps,
  extractHighlights,
};
