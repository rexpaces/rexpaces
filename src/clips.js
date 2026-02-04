const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { generateAssSubtitle } = require('./subtitles.ass');

/**
 * Create a highlight clip with burned-in subtitles
 * @param {string} videoPath - Path to source video
 * @param {object} highlight - Highlight with words and timestamps
 * @param {string} outputPath - Path for output clip
 * @param {object} options - Optional settings
 * @returns {Promise<string>} - Path to created clip
 */
async function createHighlightClip(videoPath, highlight, outputPath, options = {}) {
  const {
    padding = 0.5, // Add padding before/after clip in seconds
    assOptions = {},
  } = options;

  const startTime = Math.max(0, highlight.start - padding);
  const endTime = highlight.end + padding;
  const duration = endTime - startTime;

  // Generate .ass content with time offset so subtitles start at 0:00
  const assContent = generateAssSubtitle(highlight, {
    ...assOptions,
    timeOffset: startTime,
  });

  // Write temp .ass file
  const tempAssPath = outputPath.replace(/\.[^.]+$/, '.ass');
  fs.writeFileSync(tempAssPath, assContent);

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .setStartTime(startTime)
      .setDuration(duration)
      .videoFilters(`ass=${tempAssPath}`)
      .outputOptions([
        '-c:v libx264',
        '-preset fast',
        '-crf 23',
        '-c:a aac',
        '-b:a 128k',
      ])
      .output(outputPath)
      .on('start', (cmd) => {
        console.log(`  FFmpeg: ${cmd.substring(0, 100)}...`);
      })
      .on('end', () => {
        // Clean up temp .ass file
        fs.unlinkSync(tempAssPath);
        resolve(outputPath);
      })
      .on('error', (err) => {
        // Clean up temp .ass file on error
        if (fs.existsSync(tempAssPath)) {
          fs.unlinkSync(tempAssPath);
        }
        reject(err);
      })
      .run();
  });
}

/**
 * Create clips for all highlights
 * @param {string} videoPath - Path to source video
 * @param {Array} highlights - Array of highlights with timestamps
 * @param {string} outputDir - Directory for output clips
 * @param {object} options - Optional settings
 * @returns {Promise<Array<string>>} - Paths to created clips
 */
async function createAllHighlightClips(videoPath, highlights, outputDir, options = {}) {
  fs.mkdirSync(outputDir, { recursive: true });

  const clipPaths = [];

  for (let i = 0; i < highlights.length; i++) {
    const highlight = highlights[i];
    const outputPath = path.join(outputDir, `clip_${String(i + 1).padStart(3, '0')}.mp4`);

    console.log(`\nCreating clip ${i + 1}/${highlights.length}...`);
    console.log(`  Quote: "${highlight.quote.substring(0, 50)}..."`);
    console.log(`  Time: ${highlight.start.toFixed(2)}s - ${highlight.end.toFixed(2)}s`);

    await createHighlightClip(videoPath, highlight, outputPath, options);

    console.log(`  Output: ${outputPath}`);
    clipPaths.push(outputPath);
  }

  return clipPaths;
}

module.exports = {
  createHighlightClip,
  createAllHighlightClips,
};
