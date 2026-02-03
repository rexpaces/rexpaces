const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { extractAudio, splitAudioIntoChunks, getAudioDuration } = require('./audio');
const { transcribeChunk, mergeTranscriptions } = require('./transcribe');
const { formatSrtTime, transcriptToSrt, saveAsSrt } = require('./subtitles');

const INPUT_VIDEO = path.resolve(__dirname, '../input/space.mp4');
const OUTPUT_DIR = path.resolve(__dirname, '../output/test');

describe('transcription pipeline', () => {
  it('should process video, generate chunks, and transcribe with matching duration', async () => {
    // Clean up previous test output
    if (fs.existsSync(OUTPUT_DIR)) {
      fs.rmSync(OUTPUT_DIR, { recursive: true });
    }

    // Step 1: Extract audio from video
    console.log('Extracting audio...');
    const audioPath = await extractAudio(INPUT_VIDEO, OUTPUT_DIR);
    assert.ok(fs.existsSync(audioPath), 'Audio file should exist');

    // Get original audio duration
    const originalDuration = await getAudioDuration(audioPath);
    console.log(`Original audio duration: ${originalDuration} seconds`);

    // Step 2: Split into chunks (5 min chunks)
    console.log('Splitting into chunks...');
    const chunkDuration = 300;
    const chunks = await splitAudioIntoChunks(audioPath, OUTPUT_DIR, chunkDuration);
    console.log(`Generated ${chunks.length} chunks`);

    assert.ok(chunks.length > 0, 'Should have at least one chunk');

    // Verify total chunk duration matches original
    let totalChunkDuration = 0;
    for (const chunk of chunks) {
      assert.ok(fs.existsSync(chunk.path), `Chunk file should exist: ${chunk.path}`);
      const duration = await getAudioDuration(chunk.path);
      totalChunkDuration += duration;
      console.log(`Chunk ${chunk.index}: ${duration.toFixed(2)}s`);
    }

    console.log(`Total chunk duration: ${totalChunkDuration.toFixed(2)}s`);
    console.log(`Original duration: ${originalDuration.toFixed(2)}s`);

    // Allow 1 second tolerance for rounding
    const durationDiff = Math.abs(totalChunkDuration - originalDuration);
    assert.ok(durationDiff < 1, `Duration mismatch: ${durationDiff}s difference`);

    // Step 3: Transcribe each chunk synchronously
    console.log('\nTranscribing chunks...');
    const transcripts = [];

    for (const chunk of chunks) {
      console.log(`Transcribing chunk ${chunk.index + 1}/${chunks.length}...`);

      const result = await transcribeChunk(chunk.path);

      // Verify transcription structure
      assert.ok(result, `Chunk ${chunk.index} should return a result`);
      assert.ok(Array.isArray(result.segments), `Chunk ${chunk.index} should have segments array`);

      // Verify word-level timestamps exist
      if (result.segments.length > 0) {
        const segment = result.segments[0];
        assert.ok(typeof segment.start === 'number', 'Segment should have start time');
        assert.ok(typeof segment.end === 'number', 'Segment should have end time');
        assert.ok(typeof segment.text === 'string', 'Segment should have text');
        assert.ok(Array.isArray(segment.words), 'Segment should have words array');

        if (segment.words.length > 0) {
          const word = segment.words[0];
          assert.ok(typeof word.start === 'number', 'Word should have start time');
          assert.ok(typeof word.end === 'number', 'Word should have end time');
        }
      }

      // Save transcription to file
      const transcriptPath = path.join(OUTPUT_DIR, `chunk_${String(chunk.index).padStart(3, '0')}_transcript.json`);
      fs.writeFileSync(transcriptPath, JSON.stringify(result, null, 2));

      transcripts.push({
        chunkIndex: chunk.index,
        path: transcriptPath,
        segmentCount: result.segments.length,
        text: result.text || result.segments.map(s => s.text).join(' ')
      });

      console.log(`  - ${result.segments.length} segments, ${result.segments.reduce((acc, s) => acc + (s.words?.length || 0), 0)} words`);
    }

    // Verify all transcription files exist
    console.log('\nVerifying transcription files...');
    for (const t of transcripts) {
      assert.ok(fs.existsSync(t.path), `Transcript file should exist: ${t.path}`);
      const content = JSON.parse(fs.readFileSync(t.path, 'utf-8'));
      assert.ok(Array.isArray(content.segments), 'Saved transcript should have segments');
      console.log(`Chunk ${t.chunkIndex}: ${t.segmentCount} segments - OK`);
    }

    console.log('\nAll tests passed!');
  });

  it('should concatenate transcription chunks with correct timestamps', async () => {
    const testDir = OUTPUT_DIR;
    const chunksDir = path.join(testDir, 'chunks');

    // Check that previous test output exists
    assert.ok(fs.existsSync(testDir), 'Test output directory should exist from previous test');

    // Get original audio duration
    const audioPath = path.join(testDir, 'audio.wav');
    assert.ok(fs.existsSync(audioPath), 'Audio file should exist from previous test');
    const originalDuration = await getAudioDuration(audioPath);
    console.log(`Original audio duration: ${originalDuration.toFixed(2)}s`);

    // Find all transcript files
    const chunkFiles = fs.readdirSync(chunksDir)
      .filter(f => f.endsWith('.wav'))
      .sort();

    const transcriptPaths = [];
    const chunkStartTimes = [];
    const chunkDuration = 300;

    for (let i = 0; i < chunkFiles.length; i++) {
      const transcriptPath = path.join(testDir, `chunk_${String(i).padStart(3, '0')}_transcript.json`);
      assert.ok(fs.existsSync(transcriptPath), `Transcript file should exist: ${transcriptPath}`);
      transcriptPaths.push(transcriptPath);
      chunkStartTimes.push(i * chunkDuration);
    }

    console.log(`Found ${transcriptPaths.length} transcription files`);

    // Merge transcriptions
    console.log('Merging transcriptions...');
    const merged = mergeTranscriptions(transcriptPaths, chunkStartTimes);

    assert.ok(merged.segments.length > 0, 'Merged transcript should have segments');
    console.log(`Total segments: ${merged.segments.length}`);

    // Verify timestamps are correctly adjusted
    const firstSegment = merged.segments[0];
    const lastSegment = merged.segments[merged.segments.length - 1];

    console.log(`First segment: ${firstSegment.start.toFixed(2)}s - ${firstSegment.end.toFixed(2)}s`);
    console.log(`Last segment: ${lastSegment.start.toFixed(2)}s - ${lastSegment.end.toFixed(2)}s`);

    // First segment should start near 0
    assert.ok(firstSegment.start < 10, `First segment should start near beginning, got ${firstSegment.start}s`);

    // Last segment should end near the original duration (within 30s tolerance)
    const endDiff = Math.abs(lastSegment.end - originalDuration);
    console.log(`Last segment ends at ${lastSegment.end.toFixed(2)}s, original duration is ${originalDuration.toFixed(2)}s (diff: ${endDiff.toFixed(2)}s)`);
    assert.ok(endDiff < 30, `Last segment should end near original duration, diff: ${endDiff.s}`);

    // Verify word-level timestamps are also adjusted
    let totalWords = 0;
    for (const segment of merged.segments) {
      if (segment.words && segment.words.length > 0) {
        totalWords += segment.words.length;

        // Check word timestamps are within segment bounds (with tolerance for Whisper quirks)
        for (const word of segment.words) {
          assert.ok(word.start >= segment.start - 1, `Word start ${word.start} should be >= segment start ${segment.start}`);
          assert.ok(word.end <= segment.end + 1, `Word end ${word.end} should be <= segment end ${segment.end}`);
        }
      }
    }
    console.log(`Total words with timestamps: ${totalWords}`);

    // Verify segments are in chronological order
    for (let i = 1; i < merged.segments.length; i++) {
      const prev = merged.segments[i - 1];
      const curr = merged.segments[i];
      assert.ok(curr.start >= prev.start, `Segments should be in order: segment ${i} starts at ${curr.start}, previous ends at ${prev.end}`);
    }
    console.log('Segments are in chronological order');

    // Save merged transcript
    const mergedPath = path.join(testDir, 'transcript_merged.json');
    fs.writeFileSync(mergedPath, JSON.stringify(merged, null, 2));
    console.log(`Merged transcript saved to: ${mergedPath}`);

    console.log('\nConcatenation test passed!');
  });

  it('should convert transcript to SRT format', async () => {
    const mergedPath = path.join(OUTPUT_DIR, 'transcript_merged.json');
    assert.ok(fs.existsSync(mergedPath), 'Merged transcript should exist from previous test');

    // Load merged transcript
    const transcript = JSON.parse(fs.readFileSync(mergedPath, 'utf-8'));
    console.log(`Loaded transcript with ${transcript.segments.length} segments`);

    // Test time formatting
    assert.strictEqual(formatSrtTime(0), '00:00:00,000');
    assert.strictEqual(formatSrtTime(61.5), '00:01:01,500');
    assert.strictEqual(formatSrtTime(3661.123), '01:01:01,123');
    console.log('Time formatting: OK');

    // Convert to SRT
    const srtContent = transcriptToSrt(transcript);
    assert.ok(srtContent.length > 0, 'SRT content should not be empty');

    // Verify SRT structure
    const lines = srtContent.split('\n');
    assert.ok(lines.length > 3, 'SRT should have multiple lines');

    // Check first subtitle block structure
    assert.strictEqual(lines[0], '1', 'First line should be subtitle number');
    assert.ok(lines[1].includes(' --> '), 'Second line should be timestamp range');
    assert.ok(lines[2].length > 0, 'Third line should be subtitle text');
    assert.strictEqual(lines[3], '', 'Fourth line should be empty');
    console.log('SRT structure: OK');

    // Verify timestamp format (HH:MM:SS,mmm --> HH:MM:SS,mmm)
    const timestampRegex = /^\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}$/;
    assert.ok(timestampRegex.test(lines[1]), `Timestamp format invalid: ${lines[1]}`);
    console.log('Timestamp format: OK');

    // Save SRT file
    const srtPath = path.join(OUTPUT_DIR, 'transcript.srt');
    saveAsSrt(transcript, srtPath);
    assert.ok(fs.existsSync(srtPath), 'SRT file should be created');

    // Verify saved file content matches
    const savedContent = fs.readFileSync(srtPath, 'utf-8');
    assert.strictEqual(savedContent, srtContent, 'Saved content should match generated content');

    // Count subtitles
    const subtitleCount = (srtContent.match(/^\d+$/gm) || []).length;
    console.log(`Generated ${subtitleCount} subtitles`);
    console.log(`SRT file saved to: ${srtPath}`);

    // Show sample
    console.log('\nFirst 3 subtitle blocks:');
    console.log(lines.slice(0, 12).join('\n'));

    console.log('\nSRT conversion test passed!');
  });
});
