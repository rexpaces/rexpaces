# ReXpaces

Generate highlight clips with TikTok-style subtitles from X/Twitter Spaces recordings.

## Requirements

- Node.js 18+
- FFmpeg installed
- Whisper API server running (e.g., [whisper-asr-webservice](https://github.com/ahmetoner/whisper-asr-webservice))
- AI provider: Google Gemini API key OR local Ollama instance

## Installation

```bash
npm install
```

## Environment Variables

### AI Provider Configuration

Choose between Google Gemini (cloud) or Ollama (local):

```bash
# AI provider: "gemini" (default) or "ollama"
export AI_PROVIDER=gemini
```

#### Using Gemini (default)

```bash
export AI_PROVIDER=gemini
export GEMINI_API_KEY=your_gemini_api_key
```

#### Using Ollama (local)

```bash
export AI_PROVIDER=ollama
export OLLAMA_API_URL=http://localhost:11434  # optional, this is the default
export OLLAMA_MODEL=gemma3:12b                # optional, this is the default
```

Make sure Ollama is running and the model is available:

```bash
ollama pull gemma3:12b
ollama serve
```

### Whisper Configuration

```bash
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
# Using Gemini
GEMINI_API_KEY=your_key node src/index.js recording.mp4 -o ./output

# Using Ollama
AI_PROVIDER=ollama node src/index.js recording.mp4 -o ./output
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
4. Analyze with AI (summarize → extract context → detect highlights)
5. Map highlights to word timestamps
6. Generate clips with TikTok-style subtitles
