const fs = require('fs');
const path = require('path');

const WHISPER_API_URL = 'http://192.168.2.8:9000';

/**
 * Transcribe a single audio chunk using Whisper HTTP API
 */
async function transcribeChunk(chunkPath) {
  const formData = new FormData();
  const audioBuffer = fs.readFileSync(chunkPath);
  const blob = new Blob([audioBuffer], { type: 'audio/wav' });
  formData.append('audio_file', blob, path.basename(chunkPath));

  const response = await fetch(`${WHISPER_API_URL}/asr?output=json&word_timestamps=true`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Whisper API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Transcribe all chunks and merge results
 */
async function transcribeAllChunks(chunks, outputDir) {
  const allSegments = [];

  for (const chunk of chunks) {
    console.log(`Transcribing chunk ${chunk.index + 1}/${chunks.length}...`);

    const result = await transcribeChunk(chunk.path);

    // Adjust timestamps to be relative to full audio
    const adjustedSegments = (result.segments || []).map((segment) => ({
      ...segment,
      start: segment.start + chunk.startTime,
      end: segment.end + chunk.startTime,
      words: (segment.words || []).map((word) => ({
        ...word,
        start: word.start + chunk.startTime,
        end: word.end + chunk.startTime,
      })),
    }));

    allSegments.push(...adjustedSegments);
  }

  // Save merged transcript
  const fullTranscript = {
    segments: allSegments,
    text: allSegments.map((s) => s.text).join(' '),
  };

  const outputPath = path.join(outputDir, 'transcript.json');
  fs.writeFileSync(outputPath, JSON.stringify(fullTranscript, null, 2));

  return fullTranscript;
}

/**
 * Merge existing transcription files from chunks
 */
function mergeTranscriptions(transcriptPaths, chunkStartTimes) {
  const allSegments = [];

  for (let i = 0; i < transcriptPaths.length; i++) {
    const content = JSON.parse(fs.readFileSync(transcriptPaths[i], 'utf-8'));
    const startTime = chunkStartTimes[i];

    const adjustedSegments = (content.segments || []).map((segment) => ({
      ...segment,
      start: segment.start + startTime,
      end: segment.end + startTime,
      words: (segment.words || []).map((word) => ({
        ...word,
        start: word.start + startTime,
        end: word.end + startTime,
      })),
    }));

    allSegments.push(...adjustedSegments);
  }

  return {
    segments: allSegments,
    text: allSegments.map((s) => s.text).join(' '),
  };
}

module.exports = {
  transcribeChunk,
  transcribeAllChunks,
  mergeTranscriptions,
};
