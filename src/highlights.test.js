const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { groupSegmentsIntoChunks, buildWordIndex, findQuoteInWords, mapHighlightsToTimestamps } = require('./highlights');

const OUTPUT_DIR = path.resolve(__dirname, '../output/test');

describe('highlights', () => {
  it('should group segments into chunks by time ranges', () => {
    const mergedPath = path.join(OUTPUT_DIR, 'transcript_merged.json');
    assert.ok(fs.existsSync(mergedPath), 'Merged transcript should exist');

    const transcript = JSON.parse(fs.readFileSync(mergedPath, 'utf-8'));
    console.log(`Loaded transcript with ${transcript.segments.length} segments`);

    const chunkDuration = 300; // 5 minutes
    const chunks = groupSegmentsIntoChunks(transcript.segments, chunkDuration);

    console.log(`Created ${chunks.length} chunks`);

    // Should have multiple chunks
    assert.ok(chunks.length > 0, 'Should have at least one chunk');

    // Verify chunk structure
    for (const chunk of chunks) {
      assert.ok(typeof chunk.index === 'number', 'Chunk should have index');
      assert.ok(typeof chunk.startTime === 'number', 'Chunk should have startTime');
      assert.ok(typeof chunk.endTime === 'number', 'Chunk should have endTime');
      assert.ok(typeof chunk.text === 'string', 'Chunk should have text');
      assert.ok(Array.isArray(chunk.segments), 'Chunk should have segments array');

      // Verify time boundaries
      assert.strictEqual(chunk.endTime - chunk.startTime, chunkDuration, 'Chunk duration should match');
      assert.strictEqual(chunk.startTime, chunk.index * chunkDuration, 'Start time should match index');
    }

    // Verify segments are in correct chunks
    for (const chunk of chunks) {
      for (const segment of chunk.segments) {
        assert.ok(
          segment.start >= chunk.startTime && segment.start < chunk.endTime,
          `Segment start ${segment.start} should be within chunk ${chunk.index} (${chunk.startTime}-${chunk.endTime})`
        );
      }
    }

    // Verify all segments are accounted for
    const totalSegmentsInChunks = chunks.reduce((sum, c) => sum + c.segments.length, 0);
    assert.strictEqual(totalSegmentsInChunks, transcript.segments.length, 'All segments should be in chunks');

    // Show chunk summary
    console.log('\nChunk summary:');
    for (const chunk of chunks) {
      const textPreview = chunk.text.substring(0, 50).replace(/\n/g, ' ');
      console.log(`  Chunk ${chunk.index}: ${chunk.startTime}s-${chunk.endTime}s, ${chunk.segments.length} segments, "${textPreview}..."`);
    }

    console.log('\ngroupSegmentsIntoChunks test passed!');
  });

  it('should build a flat word index with timestamps', () => {
    const mergedPath = path.join(OUTPUT_DIR, 'transcript_merged.json');
    const transcript = JSON.parse(fs.readFileSync(mergedPath, 'utf-8'));

    const wordIndex = buildWordIndex(transcript.segments);

    console.log(`Built word index with ${wordIndex.length} words`);

    // Should have words
    assert.ok(wordIndex.length > 0, 'Word index should not be empty');

    // Verify word structure
    for (let i = 0; i < Math.min(100, wordIndex.length); i++) {
      const word = wordIndex[i];
      assert.ok(typeof word.word === 'string', 'Word should have text');
      assert.ok(typeof word.start === 'number', 'Word should have start time');
      assert.ok(typeof word.end === 'number', 'Word should have end time');
      assert.ok(typeof word.segmentIndex === 'number', 'Word should have segment index');
      assert.ok(word.start <= word.end, 'Start should be <= end');
    }

    // Verify words are in chronological order
    for (let i = 1; i < wordIndex.length; i++) {
      assert.ok(
        wordIndex[i].start >= wordIndex[i - 1].start,
        `Words should be in order: word ${i} starts at ${wordIndex[i].start}, previous at ${wordIndex[i - 1].start}`
      );
    }

    // Verify first and last word timestamps span the conversation
    const firstWord = wordIndex[0];
    const lastWord = wordIndex[wordIndex.length - 1];
    console.log(`First word: "${firstWord.word}" at ${firstWord.start.toFixed(2)}s`);
    console.log(`Last word: "${lastWord.word}" at ${lastWord.end.toFixed(2)}s`);

    assert.ok(firstWord.start < 60, 'First word should be near the beginning');
    assert.ok(lastWord.end > 3000, 'Last word should be near the end of conversation');

    // Show sample words
    console.log('\nSample words (first 10):');
    wordIndex.slice(0, 10).forEach((w, i) => {
      console.log(`  ${i}: "${w.word}" ${w.start.toFixed(2)}s-${w.end.toFixed(2)}s (segment ${w.segmentIndex})`);
    });

    console.log('\nbuildWordIndex test passed!');
  });

  it('should preserve word order from original transcript in word index', () => {
    const mergedPath = path.join(OUTPUT_DIR, 'transcript_merged.json');
    const transcript = JSON.parse(fs.readFileSync(mergedPath, 'utf-8'));

    const wordIndex = buildWordIndex(transcript.segments);

    let wordIndexPos = 0;
    for (let segIdx = 0; segIdx < transcript.segments.length; segIdx++) {
      const segment = transcript.segments[segIdx];
      if (!segment.words || segment.words.length === 0) continue;

      for (const originalWord of segment.words) {
        const indexedWord = wordIndex[wordIndexPos];
        const originalText = (originalWord.word || originalWord.text || '').toLowerCase().trim();

        assert.strictEqual(
          indexedWord.word,
          originalText,
          `Word mismatch at position ${wordIndexPos}: expected "${originalText}", got "${indexedWord.word}"`
        );
        assert.strictEqual(
          indexedWord.segmentIndex,
          segIdx,
          `Segment index mismatch at position ${wordIndexPos}`
        );

        wordIndexPos++;
      }
    }

    assert.strictEqual(wordIndexPos, wordIndex.length, 'All words should be accounted for');
    console.log(`Verified ${wordIndexPos} words match original transcript order`);

    console.log('\nWord order preservation test passed!');
  });

  it('should find a quote in word index with word-level timestamps', () => {
    const mergedPath = path.join(OUTPUT_DIR, 'transcript_merged.json');
    const transcript = JSON.parse(fs.readFileSync(mergedPath, 'utf-8'));

    const wordIndex = buildWordIndex(transcript.segments);

    // Pick a sequence of consecutive words from the index to use as test quote
    const startIdx = 100;
    const quoteLength = 5;
    const testWords = wordIndex.slice(startIdx, startIdx + quoteLength);
    const testQuote = testWords.map(w => w.word).join(' ');

    console.log(`Test quote: "${testQuote}"`);
    console.log(`Expected start: ${testWords[0].start.toFixed(2)}s`);
    console.log(`Expected end: ${testWords[quoteLength - 1].end.toFixed(2)}s`);

    // Find the quote
    const result = findQuoteInWords(testQuote, wordIndex, 0, 4000);

    assert.ok(result, 'Should find the quote');
    assert.strictEqual(result.matchScore, 1, 'Should be a perfect match');
    assert.strictEqual(result.words.length, quoteLength, 'Should return correct number of words');

    // Verify timestamps match
    assert.strictEqual(result.start, testWords[0].start, 'Start time should match first word');
    assert.strictEqual(result.end, testWords[quoteLength - 1].end, 'End time should match last word');

    // Verify each word
    for (let i = 0; i < quoteLength; i++) {
      assert.strictEqual(result.words[i].word, testWords[i].word, `Word ${i} should match`);
      assert.strictEqual(result.words[i].start, testWords[i].start, `Word ${i} start should match`);
      assert.strictEqual(result.words[i].end, testWords[i].end, `Word ${i} end should match`);
    }

    console.log('\nResult:');
    console.log(`  Start: ${result.start.toFixed(2)}s`);
    console.log(`  End: ${result.end.toFixed(2)}s`);
    console.log(`  Match score: ${result.matchScore}`);
    console.log(`  Words: ${result.words.map(w => w.word).join(' ')}`);

    console.log('\nfindQuoteInWords test passed!');
  });

  it('should map highlight quotes to word-level timestamps', () => {
    const mergedPath = path.join(OUTPUT_DIR, 'transcript_merged.json');
    const transcript = JSON.parse(fs.readFileSync(mergedPath, 'utf-8'));

    const wordIndex = buildWordIndex(transcript.segments);

    // Create mock highlights with real quotes from the transcript
    // Pick quotes from different chunks to test time boundary handling
    const quote1Words = wordIndex.slice(100, 105);
    const quote2Words = wordIndex.slice(500, 508);

    const mockHighlights = [
      {
        chunkIndex: 0,
        chunkStartTime: 0,
        chunkEndTime: 300,
        quote: quote1Words.map(w => w.word).join(' '),
        reason: 'Test highlight 1',
      },
      {
        chunkIndex: 1,
        chunkStartTime: 300,
        chunkEndTime: 600,
        quote: quote2Words.map(w => w.word).join(' '),
        reason: 'Test highlight 2',
      },
    ];

    console.log('Mock highlights:');
    mockHighlights.forEach((h, i) => {
      console.log(`  ${i + 1}. "${h.quote}" (chunk ${h.chunkIndex})`);
    });

    // Map highlights to timestamps
    const mappedHighlights = mapHighlightsToTimestamps(mockHighlights, transcript.segments);

    assert.strictEqual(mappedHighlights.length, mockHighlights.length, 'Should return same number of highlights');

    // Verify first highlight
    const h1 = mappedHighlights[0];
    assert.ok(h1.start, 'Highlight 1 should have start time');
    assert.ok(h1.end, 'Highlight 1 should have end time');
    assert.ok(Array.isArray(h1.words), 'Highlight 1 should have words array');
    assert.ok(h1.matchScore > 0.5, 'Highlight 1 should have good match score');
    assert.strictEqual(h1.start, quote1Words[0].start, 'Highlight 1 start should match');
    assert.strictEqual(h1.end, quote1Words[quote1Words.length - 1].end, 'Highlight 1 end should match');

    // Verify second highlight
    const h2 = mappedHighlights[1];
    assert.ok(h2.start, 'Highlight 2 should have start time');
    assert.ok(h2.end, 'Highlight 2 should have end time');
    assert.ok(Array.isArray(h2.words), 'Highlight 2 should have words array');
    assert.ok(h2.matchScore > 0.5, 'Highlight 2 should have good match score');
    assert.strictEqual(h2.start, quote2Words[0].start, 'Highlight 2 start should match');
    assert.strictEqual(h2.end, quote2Words[quote2Words.length - 1].end, 'Highlight 2 end should match');

    console.log('\nMapped highlights:');
    mappedHighlights.forEach((h, i) => {
      console.log(`  ${i + 1}. "${h.quote}"`);
      console.log(`     Start: ${h.start.toFixed(2)}s, End: ${h.end.toFixed(2)}s`);
      console.log(`     Match score: ${h.matchScore}`);
      console.log(`     Words: ${h.words.length}`);
    });

    console.log('\nmapHighlightsToTimestamps test passed!');
  });
});
