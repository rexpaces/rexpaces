const fs = require('fs');

/**
 * Format seconds to SRT timestamp (HH:MM:SS,mmm)
 */
function formatSrtTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * Convert transcript JSON to SRT format
 */
function transcriptToSrt(transcript) {
  const lines = [];

  transcript.segments.forEach((segment, index) => {
    const startTime = formatSrtTime(segment.start);
    const endTime = formatSrtTime(segment.end);
    const text = segment.text.trim();

    if (text) {
      lines.push(`${index + 1}`);
      lines.push(`${startTime} --> ${endTime}`);
      lines.push(text);
      lines.push('');
    }
  });

  return lines.join('\n');
}

/**
 * Save transcript as SRT file
 */
function saveAsSrt(transcript, outputPath) {
  const srtContent = transcriptToSrt(transcript);
  fs.writeFileSync(outputPath, srtContent);
  return outputPath;
}

module.exports = {
  formatSrtTime,
  transcriptToSrt,
  saveAsSrt,
};
