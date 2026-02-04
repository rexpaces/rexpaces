const fs = require('fs');

/**
 * Format seconds to ASS timestamp (H:MM:SS.cc)
 */
function formatAssTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const centiseconds = Math.round((seconds % 1) * 100);

  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

/**
 * Generate ASS header with TikTok-style styling
 */
function generateAssHeader(options = {}) {
  const {
    width = 1080,
    height = 1920,
    fontName = 'Arial',
    fontSize = 60,
    primaryColor = '&H00FFFFFF', // White (inactive words)
    highlightColor = '&H0000FFFF', // Yellow (active word)
    outlineColor = '&H00000000', // Black outline
    backColor = '&H80000000', // Semi-transparent black background
    outline = 3,
    shadow = 0,
    marginV = 200,
  } = options;

  return `[Script Info]
Title: TikTok Style Captions
ScriptType: v4.00+
WrapStyle: 0
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${primaryColor},${highlightColor},${outlineColor},${backColor},1,0,0,0,100,100,0,0,1,${outline},${shadow},2,10,10,${marginV},1
Style: Highlight,${fontName},${fontSize},${highlightColor},${primaryColor},${outlineColor},${backColor},1,0,0,0,100,100,0,0,1,${outline},${shadow},2,10,10,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

/**
 * Group words into lines for display
 */
function groupWordsIntoLines(words, maxWordsPerLine = 4) {
  const lines = [];
  for (let i = 0; i < words.length; i += maxWordsPerLine) {
    lines.push(words.slice(i, i + maxWordsPerLine));
  }
  return lines;
}

/**
 * Generate ASS dialogue lines with word-by-word highlighting
 * Each word gets highlighted when it's being spoken
 */
function generateKaraokeDialogue(words, timeOffset = 0) {
  const lines = groupWordsIntoLines(words, 4);
  const dialogueLines = [];

  for (const lineWords of lines) {
    if (lineWords.length === 0) continue;

    const lineStart = lineWords[0].start - timeOffset;
    const lineEnd = lineWords[lineWords.length - 1].end - timeOffset;

    // For each word in the line, create the full line with that word highlighted
    for (let i = 0; i < lineWords.length; i++) {
      const wordStart = lineWords[i].start - timeOffset;
      const wordEnd = lineWords[i].end - timeOffset;

      // Build the text with current word highlighted
      let text = '';
      for (let j = 0; j < lineWords.length; j++) {
        const word = lineWords[j].word;
        if (j === i) {
          // Highlighted word (using override tag for yellow color)
          text += `{\\1c&H00FFFF&}${word}{\\1c&HFFFFFF&}`;
        } else {
          text += word;
        }
        if (j < lineWords.length - 1) text += ' ';
      }

      dialogueLines.push(
        `Dialogue: 0,${formatAssTime(wordStart)},${formatAssTime(wordEnd)},Default,,0,0,0,,${text}`
      );
    }
  }

  return dialogueLines.join('\n');
}

/**
 * Generate complete ASS content for a highlight clip
 */
function generateAssSubtitle(highlight, options = {}) {
  const { timeOffset = highlight.start } = options;

  const header = generateAssHeader(options);
  const dialogue = generateKaraokeDialogue(highlight.words, timeOffset);

  return header + dialogue;
}

/**
 * Save ASS subtitle file
 */
function saveAssSubtitle(highlight, outputPath, options = {}) {
  const content = generateAssSubtitle(highlight, options);
  fs.writeFileSync(outputPath, content);
  return outputPath;
}

module.exports = {
  formatAssTime,
  generateAssHeader,
  groupWordsIntoLines,
  generateKaraokeDialogue,
  generateAssSubtitle,
  saveAssSubtitle,
};
