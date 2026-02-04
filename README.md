# ReXpaces

Generate highlight clips with TikTok-style subtitles from X/Twitter Spaces recordings.

## Requirements

- Node.js 18+
- FFmpeg installed
- Whisper API server running (e.g., [whisper-asr-webservice](https://github.com/ahmetoner/whisper-asr-webservice))
- Google Gemini API key

## Installation

```bash
npm install
```

## Environment Variables

```bash
export GEMINI_API_KEY=your_gemini_api_key
export WHISPER_API_URL=http://localhost:9000  # optional, defaults to localhost:9000
```

## Usage

```bash
node src/index.js <video> [options]
```

### Options

- `-o, --output <dir>` - Output directory (default: `./output`)
- `-c, --chunk-duration <seconds>` - Audio chunk duration for transcription (default: `300`)

### Example

```bash
node src/index.js recording.mp4 -o ./output
```

## Output

The tool generates:

- `output/transcript.json` - Full transcript with word-level timestamps
- `output/highlights.json` - Detected highlights with timestamps
- `output/clips/` - Video clips with burned-in subtitles

## Pipeline

1. Extract audio from video
2. Split audio into chunks (5 min default)
3. Transcribe with Whisper (word-level timestamps)
4. Analyze with Gemini (summarize → extract context → detect highlights)
5. Map highlights to word timestamps
6. Generate clips with TikTok-style subtitles
