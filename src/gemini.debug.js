const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listModels(apiKey) {
  console.log('=== Listing Available Models ===\n');

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      console.log('Error:', data.error.message);
      return;
    }

    if (data.models) {
      console.log('Available models:');
      data.models.forEach(m => {
        console.log(`  - ${m.name} (${m.displayName})`);
        console.log(`    Supported methods: ${m.supportedGenerationMethods?.join(', ')}`);
      });
    }
  } catch (error) {
    console.log('Failed to list models:', error.message);
  }
}

async function debugGeminiRequest() {
  const apiKey = process.env.GEMINI_API_KEY;

  console.log('=== Gemini API Debug ===\n');
  console.log('API Key:', apiKey ? `${apiKey.substring(0, 10)}...` : 'NOT SET');

  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY not set');
    process.exit(1);
  }

  // List available models first
  await listModels(apiKey);

  const genAI = new GoogleGenerativeAI(apiKey);

  const modelsToTry = [
    'gemini-2.5-flash',
    'gemini-2.0-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-2.0-flash',
  ];

  for (const modelName of modelsToTry) {
    console.log(`\n--- Testing model: ${modelName} ---`);

    try {
      const model = genAI.getGenerativeModel({ model: modelName });

      const prompt = 'Say "hello" in one word.';
      console.log('Prompt:', prompt);

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      console.log('SUCCESS!');
      console.log('Response:', text);
      return; // Stop on first success
    } catch (error) {
      console.log('FAILED');
      console.log('Status:', error.status);
      console.log('Status Text:', error.statusText);
      console.log('Message:', error.message);

      if (error.errorDetails) {
        console.log('Error Details:', JSON.stringify(error.errorDetails, null, 2));
      }
    }

    // Wait between attempts
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('\n=== All models failed ===');
}

debugGeminiRequest();
