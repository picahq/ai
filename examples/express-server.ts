import express, { RequestHandler } from "express";
import { Pica } from "../src/pica";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import * as dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 7422;

app.use(express.json());

let pica: Pica;

async function initializePica() {
    if (!process.env.PICA_SECRET_KEY) {
        console.error("Error: PICA_SECRET_KEY not set. Create a .env file with PICA_SECRET_KEY=your_api_key_here");
        process.exit(1);
    }

    pica = new Pica(process.env.PICA_SECRET_KEY, {
        connectors: ["*"], // Use all available connectors
    });

    console.log("✅ Pica initialized successfully");
}

app.post("/api/ai", (async (req, res) => {
    const { message } = req.body;

    if (!message) {
        return res.status(400).json({
            error: "Message is required"
        });
    }

    const systemPrompt = await pica.generateSystemPrompt();

    try {
        const { text } = await generateText({
            model: openai("gpt-4o"),
            system: systemPrompt,
            tools: { ...pica.oneTool },
            prompt: message,
            maxSteps: 5,
        });

        res.status(200).json({ text });
    } catch (error) {
        console.error("Error processing AI request:", error);
        if (!res.headersSent) {
            res.status(500).json({
                error: "Internal server error"
            });
        }
    }
}) as RequestHandler);

initializePica().then(() => {
    app.listen(port, () => {
        console.log(`✅ Server running at http://localhost:${port}`);
        console.log('\nTest with curl:\n');
        console.log(`curl -X POST http://localhost:${port}/api/ai \\
    -H "Content-Type: application/json" \\
    -d '{"message":"What connections do I have access to?"}'`);
    });
});
