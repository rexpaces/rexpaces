#!/usr/bin/env node

const { program } = require('commander');
const path = require('path');
const { extractAudio, splitAudioIntoChunks } = require('./audio');
const { transcribeAllChunks } = require('./transcribe');

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
    const chunkDuration = parseInt(options.chunkDuration, 10);

    console.log('Input video:', videoPath);
    console.log('Output directory:', outputDir);
    console.log('Chunk duration:', chunkDuration, 'seconds');

    try {
      // Step 1: Extract audio from video
      console.log('\n[1/4] Extracting audio from video...');
      const audioPath = await extractAudio(videoPath, outputDir);
      console.log('Audio extracted:', audioPath);

      // Step 2: Split audio into chunks
      console.log('\n[2/4] Splitting audio into chunks...');
      const chunks = await splitAudioIntoChunks(audioPath, outputDir, chunkDuration);
      console.log(`Created ${chunks.length} chunks`);

      // Step 3: Transcribe chunks with Whisper
      console.log('\n[3/4] Transcribing audio chunks...');
      const transcript = await transcribeAllChunks(chunks, outputDir);
      console.log('Transcription complete. Total segments:', transcript.segments.length);

      // Step 4: Analyze transcript for highlights (TODO)
      console.log('\n[4/4] Analyzing transcript for highlights...');
      // TODO: Use Google Gemini to identify highlights
      // TODO: Cut video into highlight clips

      console.log('\nDone!');
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program.parse();
