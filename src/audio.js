const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

/**
 * Extract audio from video file
 */
function extractAudio(videoPath, outputDir) {
  return new Promise((resolve, reject) => {
    const audioPath = path.join(outputDir, 'audio.wav');

    fs.mkdirSync(outputDir, { recursive: true });

    ffmpeg(videoPath)
      .output(audioPath)
      .audioFrequency(16000) // 16kHz is optimal for Whisper
      .audioChannels(1)      // mono
      .format('wav')
      .on('end', () => resolve(audioPath))
      .on('error', reject)
      .run();
  });
}

/**
 * Get audio duration in seconds
 */
function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
}

/**
 * Split audio into chunks
 */
async function splitAudioIntoChunks(audioPath, outputDir, chunkDurationSec = 300) {
  const duration = await getAudioDuration(audioPath);
  const chunks = [];
  const chunksDir = path.join(outputDir, 'chunks');

  fs.mkdirSync(chunksDir, { recursive: true });

  const numChunks = Math.ceil(duration / chunkDurationSec);

  for (let i = 0; i < numChunks; i++) {
    const startTime = i * chunkDurationSec;
    const chunkPath = path.join(chunksDir, `chunk_${String(i).padStart(3, '0')}.wav`);

    await new Promise((resolve, reject) => {
      ffmpeg(audioPath)
        .setStartTime(startTime)
        .setDuration(chunkDurationSec)
        .output(chunkPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    chunks.push({
      index: i,
      path: chunkPath,
      startTime,
    });
  }

  return chunks;
}

module.exports = {
  extractAudio,
  getAudioDuration,
  splitAudioIntoChunks,
};
