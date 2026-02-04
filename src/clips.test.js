const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { createHighlightClip, createAllHighlightClips } = require('./clips');

const INPUT_VIDEO = path.resolve(__dirname, '../input/space.mp4');
const OUTPUT_DIR = path.resolve(__dirname, '../output/test/clips');

describe('video clips', () => {
  it('should create a single highlight clip with subtitles', async () => {
    const highlightsPath = path.resolve(__dirname, '../output/test/highlights_with_timestamps.json');
    assert.ok(fs.existsSync(highlightsPath), 'Highlights file should exist');
    assert.ok(fs.existsSync(INPUT_VIDEO), 'Input video should exist');

    const highlights = JSON.parse(fs.readFileSync(highlightsPath, 'utf-8'));
    const highlight = highlights[0];

    console.log(`Creating clip for: "${highlight.quote.substring(0, 50)}..."`);
    console.log(`Time: ${highlight.start.toFixed(2)}s - ${highlight.end.toFixed(2)}s`);
    console.log(`Words: ${highlight.words.length}`);

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const outputPath = path.join(OUTPUT_DIR, 'test_clip.mp4');

    await createHighlightClip(INPUT_VIDEO, highlight, outputPath);

    assert.ok(fs.existsSync(outputPath), 'Clip should be created');

    const stats = fs.statSync(outputPath);
    console.log(`\nClip created: ${outputPath}`);
    console.log(`File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    console.log('\nSingle clip test passed!');
  });

  it('should create clips for all highlights', async () => {
    const highlightsPath = path.resolve(__dirname, '../output/test/highlights_with_timestamps.json');
    const highlights = JSON.parse(fs.readFileSync(highlightsPath, 'utf-8'));

    console.log(`\nCreating ${highlights.length} clips...`);

    const clipPaths = await createAllHighlightClips(INPUT_VIDEO, highlights, OUTPUT_DIR);

    assert.strictEqual(clipPaths.length, highlights.length, 'Should create all clips');

    for (const clipPath of clipPaths) {
      assert.ok(fs.existsSync(clipPath), `Clip should exist: ${clipPath}`);
    }

    console.log('\nAll clips created successfully!');
  });
});
