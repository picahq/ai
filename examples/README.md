# Pica Vercel AI SDK Examples

This folder contains examples demonstrating how to use the Pica SDK.

## Setup

1. Create a `.env` file in the root of the project with your API keys:
   ```
   PICA_SECRET_KEY=your_api_key_here
   OPENAI_API_KEY=your_openai_api_key_here
   ```

2. Install dependencies:
   ```bash
   npm install dotenv @ai-sdk/openai ai express
   ```

## Examples

### Basic Example with Streaming

The `basic-example.ts` example demonstrates how to:
- Initialize the Pica SDK
- Generate a system prompt
- Stream responses from an LLM using the Vercel AI SDK with Pica tools

This example shows how to handle streaming responses from the LLM.

**Run the example:**
```bash
npm run example:basic
```

### Express Server Example

The `express-server.ts` example demonstrates how to:
- Set up an Express server with Pica integration
- Create an API endpoint that uses Pica with the Vercel AI SDK
- Process requests and return AI-generated responses

This example is useful for building web applications or APIs that need to integrate with Pica.

**Run the server:**
```bash
npm run example:express
```

**Test the Express server:**
```bash
curl -X POST http://localhost:7422/api/ai \
  -H "Content-Type: application/json" \
  -d '{"message":"What connections do I have access to?"}'
```
