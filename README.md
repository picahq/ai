# Pica AI SDK

Pica AI SDK is a TypeScript library that allows you to integrate with Pica's AI platform.

## Installation

```bash
npm install @picahq/ai
```

# Setup

1. Create a new Pica account at [Pica](https://app.picaos.com)
2. Create a Pica API key at [Pica](https://app.picaos.com/settings/api-keys)
3. Set the API key as an environment variable: `PICA_SECRET_KEY=<your-api-key>`
4. Set the OpenAI API key as an environment variable: `OPENAI_API_KEY=<your-openai-api-key>`

## Usage

Here's a basic example of how to use the SDK:

```typescript
import { openai } from "@ai-sdk/openai";
import { convertToCoreMessages, streamText } from "ai";
import { Pica } from "@picahq/ai";

export async function POST(request: Request) {
  const { messages } = await request.json();

  const pica = new Pica(process.env.PICA_SECRET_KEY as string);

  const systemPrompt = await pica.generateSystemPrompt();

  const stream = streamText({
    model: openai("gpt-4"),
    system: systemPrompt,
    tools: { ...pica.oneTool },
    messages: convertToCoreMessages(messages),
    maxSteps: 5,
  });

  return (await stream).toDataStreamResponse();
}
```

## Features

- Seamless integration with Vercel AI SDK
- Full TypeScript support
- Built-in tools for managing entities
- System prompt generation
- Connection management

## License

MIT