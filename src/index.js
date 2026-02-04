#!/usr/bin/env node

const { program } = require('commander');
const path = require('path');
const fs = require('fs');
const { extractAudio, splitAudioIntoChunks } = require('./audio');
const { transcribeAllChunks } = require('./transcribe');
const { extractHighlights, mapHighlightsToTimestamps } = require('./highlights');
const { createAllHighlightClips } = require('./clips');

/**
 * Validate required environment variables
 */
function validateEnvironment() {
  const errors = [];
  const aiProvider = process.env.AI_PROVIDER || 'ollama';

  if (aiProvider === 'gemini' && !process.env.GEMINI_API_KEY) {
    errors.push('GEMINI_API_KEY environment variable is required when using Gemini provider');
  }

  if (aiProvider === 'ollama') {
    console.log('Using Ollama provider');
    console.log('  Endpoint:', process.env.OLLAMA_API_URL || 'http://localhost:11434');
    console.log('  Model:', process.env.OLLAMA_MODEL || 'gemma3:12b');
  }

  if (!process.env.WHISPER_API_URL) {
    console.warn('Warning: WHISPER_API_URL not set, using default http://localhost:9000');
  }

  if (errors.length > 0) {
    console.error('Environment configuration errors:');
    errors.forEach(e => console.error(`  - ${e}`));
    console.error('\nEnvironment variables:');
    console.error('  AI_PROVIDER     - AI provider: "gemini" (default) or "ollama"');
    console.error('  GEMINI_API_KEY  - Google Gemini API key (required for Gemini)');
    console.error('  OLLAMA_API_URL  - Ollama API endpoint (default: http://localhost:11434)');
    console.error('  OLLAMA_MODEL    - Ollama model name (default: gemma3:12b)');
    console.error('  WHISPER_API_URL - Whisper API endpoint (default: http://localhost:9000)');
    process.exit(1);
  }
}

/**
 * Validate input file exists
 */
function validateInputFile(videoPath) {
  if (!fs.existsSync(videoPath)) {
    console.error(`Error: Input video file not found: ${videoPath}`);
    process.exit(1);
  }
}

program
  .name('rexpaces')
  .description('Process X/Twitter Spaces recordings and generate highlight clips')
  .version('1.0.0');

program
  .argument('<video>', 'path to the input video file')
  .option('-o, --output <dir>', 'output directory for clips', './output')
  .option('-c, --chunk-duration <seconds>', 'chunk duration in seconds', '300')
  .action(async (video, options) => {
    const videoPath = path.resolve(video);
    const outputDir = path.resolve(options.output);
    const clipsDir = path.join(outputDir, 'clips');
    const chunkDuration = parseInt(options.chunkDuration, 10);

    // Validate environment and input
    validateEnvironment();
    validateInputFile(videoPath);

    console.log('=== ReXpaces - X Spaces Highlight Generator ===\n');
    console.log('Input video:', videoPath);
    console.log('Output directory:', outputDir);
    console.log('Chunk duration:', chunkDuration, 'seconds');

    try {
      const transcriptPath = path.join(outputDir, 'transcript.json');
      let transcript;

      // Check if transcript already exists
      if (fs.existsSync(transcriptPath)) {
        console.log('\n[1-3/6] Skipping audio extraction, splitting, and transcription (transcript.json found)');
        transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8'));
        console.log('Loaded existing transcript. Total segments:', transcript.segments.length);
      } else {
        // Step 1: Extract audio from video
        console.log('\n[1/6] Extracting audio from video...');
        const audioPath = await extractAudio(videoPath, outputDir);
        console.log('Audio extracted:', audioPath);

        // Step 2: Split audio into chunks
        console.log('\n[2/6] Splitting audio into chunks...');
        const chunks = await splitAudioIntoChunks(audioPath, outputDir, chunkDuration);
        console.log(`Created ${chunks.length} chunks`);

        // Step 3: Transcribe chunks with Whisper
        console.log('\n[3/6] Transcribing audio chunks...');
        transcript = await transcribeAllChunks(chunks, outputDir);
        console.log('Transcription complete. Total segments:', transcript.segments.length);
      }

      // Step 4: Analyze transcript for highlights with Gemini
      console.log('\n[4/6] Analyzing transcript for highlights...');
      const { context, highlights: rawHighlights } = await extractHighlights(
        transcript,
        outputDir,
        chunkDuration
      );
      console.log('Conversation topic:', context.topic);
      console.log(`Found ${rawHighlights.length} potential highlights`);

      if (rawHighlights.length === 0) {
        console.log('\nNo highlights found. Exiting.');
        process.exit(0);
      }

      // Step 5: Map highlights to word-level timestamps
      console.log('\n[5/6] Mapping highlights to timestamps...');
      const highlights = mapHighlightsToTimestamps(rawHighlights, transcript.segments);

      // Filter out highlights with poor match scores
      const validHighlights = highlights.filter(h => h.matchScore >= 0.5);
      console.log(`Valid highlights with timestamps: ${validHighlights.length}`);

      if (validHighlights.length === 0) {
        console.log('\nNo valid highlights could be mapped to timestamps. Exiting.');
        process.exit(0);
      }

      // Save highlights
      const highlightsPath = path.join(outputDir, 'highlights.json');
      fs.writeFileSync(highlightsPath, JSON.stringify(validHighlights, null, 2));
      console.log('Highlights saved to:', highlightsPath);

      // Step 6: Create video clips with subtitles
      console.log('\n[6/6] Creating video clips with subtitles...');
      const clipPaths = await createAllHighlightClips(videoPath, validHighlights, clipsDir);

      // Summary
      console.log('\n=== Processing Complete ===\n');
      console.log(`Created ${clipPaths.length} highlight clips:`);
      clipPaths.forEach((clipPath, i) => {
        const h = validHighlights[i];
        const duration = (h.end - h.start).toFixed(1);
        console.log(`  ${i + 1}. ${path.basename(clipPath)} (${duration}s)`);
        console.log(`     "${h.quote.substring(0, 60)}..."`);
      });

      console.log(`\nOutput directory: ${clipsDir}`);
      console.log('\nDone!');
    } catch (error) {
      clearDirectory(outputDir);
      console.error('\n=== Error ===');
      console.error('Message:', error.message);

      if (error.message.includes('Whisper API')) {
        console.error('\nWhisper API error. Check that:');
        console.error('  - Whisper server is running');
        console.error('  - WHISPER_API_URL is correct');
      } else if (error.message.includes('GoogleGenerativeAI') || error.message.includes('Gemini')) {
        console.error('\nGemini API error. Check that:');
        console.error('  - GEMINI_API_KEY is valid');
        console.error('  - You have API quota available');
      } else if (error.message.includes('Ollama')) {
        console.error('\nOllama API error. Check that:');
        console.error('  - Ollama server is running');
        console.error('  - OLLAMA_API_URL is correct');
        console.error('  - The model is available (run: ollama pull gemma3:12b)');
      } else if (error.message.includes('ffmpeg') || error.message.includes('FFmpeg')) {
        console.error('\nFFmpeg error. Check that:');
        console.error('  - FFmpeg is installed');
        console.error('  - Input video file is valid');
      }

      if (process.env.DEBUG) {
        console.error('\nStack trace:');
        console.error(error.stack);
      }

      process.exit(1);
    }
  });

program.parse();


function clearDirectory(dirPath, callback) {
  fs.readdir(dirPath, { withFileTypes: true }, (err, entries) => {
    if (err) return callback(err);

    let pending = entries.length;
    if (!pending) return callback(null);

    entries.forEach(entry => {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        fs.rm(fullPath, { recursive: true, force: true }, done);
      } else {
        fs.unlink(fullPath, done);
      }
    });

    function done(err) {
      if (err) return callback(err);
      if (!--pending) callback(null);
    }
  });
}