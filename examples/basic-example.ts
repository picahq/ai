import { Pica } from "../src/pica";
import * as dotenv from "dotenv";
import { openai } from "@ai-sdk/openai";
import { convertToCoreMessages, streamText } from "ai";

dotenv.config();

async function main() {
    if (!process.env.PICA_SECRET_KEY) {
        console.error("Error: PICA_SECRET_KEY not set. Create a .env file with PICA_SECRET_KEY=your_api_key_here");
        process.exit(1);
    }

    try {
        const pica = new Pica(process.env.PICA_SECRET_KEY, {
            connectors: ["*"], // Use all available connectors
        });

        const systemPrompt = await pica.generateSystemPrompt();

        const userMessage = "What connections am I connected to and what are all the available connectors in Pica?";

        const { textStream } = streamText({
            model: openai("gpt-4o"),
            system: systemPrompt,
            tools: { ...pica.oneTool },
            messages: convertToCoreMessages([{ role: "user", content: userMessage }]),
            maxSteps: 5,
        });

        for await (const textPart of textStream) {
            process.stdout.write(textPart);
        }
    } catch (error) {
        console.error("Error:", error);
    }
}

main();