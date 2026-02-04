const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { summarizeChunk, extractConversationContext, detectHighlights } = require('./gemini');
const { groupSegmentsIntoChunks, mapHighlightsToTimestamps } = require('./highlights');

const OUTPUT_DIR = path.resolve(__dirname, '../output/test');

describe('gemini integration', () => {
  it('should summarize chunks, extract context, and detect highlights', async () => {
    // Check API key
    if (!process.env.GEMINI_API_KEY) {
      console.log('Skipping test: GEMINI_API_KEY not set');
      return;
    }

    const mergedPath = path.join(OUTPUT_DIR, 'transcript_merged.json');
    assert.ok(fs.existsSync(mergedPath), 'Merged transcript should exist');

    const transcript = JSON.parse(fs.readFileSync(mergedPath, 'utf-8'));
    const chunks = groupSegmentsIntoChunks(transcript.segments, 300);

    console.log(`Loaded ${chunks.length} chunks`);

    // Test summarizeChunk on first 3 chunks to save API calls
    console.log('\n=== Testing summarizeChunk ===');
    const summaries = [];

    for (let i = 0; i < 3; i++) {
      const chunk = chunks[i];
      console.log(`\nSummarizing chunk ${i + 1}...`);

      const summary = await summarizeChunk(
        chunk.text,
        chunk.index,
        chunk.startTime,
        chunk.endTime
      );

      assert.ok(typeof summary === 'string', 'Summary should be a string');
      assert.ok(summary.length > 10, 'Summary should not be empty');

      summaries.push({
        index: chunk.index,
        startTime: chunk.startTime,
        endTime: chunk.endTime,
        summary,
      });

      console.log(`Summary: ${summary}`);
    }

    console.log('\nsummarizeChunk: OK');

    // Test extractConversationContext
    console.log('\n=== Testing extractConversationContext ===');
    const context = await extractConversationContext(summaries);

    assert.ok(typeof context.topic === 'string', 'Context should have topic');
    assert.ok(Array.isArray(context.participants), 'Context should have participants array');
    assert.ok(Array.isArray(context.keyPoints), 'Context should have keyPoints array');
    assert.ok(typeof context.narrative === 'string', 'Context should have narrative');

    console.log('Topic:', context.topic);
    console.log('Participants:', context.participants);
    console.log('Key Points:', context.keyPoints);
    console.log('Narrative:', context.narrative);

    console.log('\nextractConversationContext: OK');

    // Test detectHighlights on a chunk with actual content
    console.log('\n=== Testing detectHighlights ===');
    const testChunk = chunks[1]; // Use chunk 1 which should have real content

    const highlights = await detectHighlights(
      testChunk.text,
      testChunk.startTime,
      testChunk.endTime,
      context
    );

    assert.ok(Array.isArray(highlights), 'Highlights should be an array');

    console.log(`Found ${highlights.length} highlights:`);
    highlights.forEach((h, i) => {
      assert.ok(typeof h.quote === 'string', 'Highlight should have quote');
      assert.ok(typeof h.reason === 'string', 'Highlight should have reason');

      console.log(`\n${i + 1}. "${h.quote}"`);
      console.log(`   Reason: ${h.reason}`);
    });

    console.log('\ndetectHighlights: OK');

    // Save test results
    const resultsPath = path.join(OUTPUT_DIR, 'gemini_test_results.json');
    fs.writeFileSync(resultsPath, JSON.stringify({ summaries, context, highlights }, null, 2));
    console.log(`\nResults saved to: ${resultsPath}`);

    console.log('\nGemini integration test passed!');
  });

  it('should map highlights to word-level timestamps', () => {
    const resultsPath = path.join(OUTPUT_DIR, 'gemini_test_results.json');
    assert.ok(fs.existsSync(resultsPath), 'Gemini test results should exist');

    const mergedPath = path.join(OUTPUT_DIR, 'transcript_merged.json');
    assert.ok(fs.existsSync(mergedPath), 'Merged transcript should exist');

    // Load data
    const { highlights } = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
    const transcript = JSON.parse(fs.readFileSync(mergedPath, 'utf-8'));

    console.log(`Loaded ${highlights.length} highlights`);
    console.log(`Loaded transcript with ${transcript.segments.length} segments`);

    // Add chunk metadata to highlights (they came from chunk 1, which is 300-600s)
    const highlightsWithChunkInfo = highlights.map(h => ({
      ...h,
      chunkIndex: 1,
      chunkStartTime: 300,
      chunkEndTime: 600,
    }));

    // Map highlights to timestamps
    const mappedHighlights = mapHighlightsToTimestamps(highlightsWithChunkInfo, transcript.segments);

    assert.strictEqual(mappedHighlights.length, highlights.length, 'Should return same number of highlights');

    console.log('\nMapped highlights:');
    for (const h of mappedHighlights) {
      console.log(`\nQuote: "${h.quote.substring(0, 60)}..."`);
      console.log(`  Start: ${h.start?.toFixed(2)}s`);
      console.log(`  End: ${h.end?.toFixed(2)}s`);
      console.log(`  Duration: ${(h.end - h.start)?.toFixed(2)}s`);
      console.log(`  Match score: ${h.matchScore}`);
      console.log(`  Words: ${h.words?.length || 0}`);

      // Verify structure
      assert.ok(typeof h.start === 'number', 'Should have start time');
      assert.ok(typeof h.end === 'number', 'Should have end time');
      assert.ok(h.start < h.end, 'Start should be before end');
      assert.ok(Array.isArray(h.words), 'Should have words array');

      // If we have words, verify they have timestamps
      if (h.words.length > 0) {
        const firstWord = h.words[0];
        const lastWord = h.words[h.words.length - 1];

        assert.ok(typeof firstWord.start === 'number', 'First word should have start');
        assert.ok(typeof lastWord.end === 'number', 'Last word should have end');

        console.log(`  First word: "${firstWord.word}" at ${firstWord.start.toFixed(2)}s`);
        console.log(`  Last word: "${lastWord.word}" at ${lastWord.end.toFixed(2)}s`);
      }
    }

    // Save mapped highlights
    const outputPath = path.join(OUTPUT_DIR, 'highlights_with_timestamps.json');
    fs.writeFileSync(outputPath, JSON.stringify(mappedHighlights, null, 2));
    console.log(`\nSaved to: ${outputPath}`);

    console.log('\nHighlight timestamp mapping test passed!');
  });
});
