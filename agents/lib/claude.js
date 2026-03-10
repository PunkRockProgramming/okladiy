/**
 * Shared Claude client for all agents
 */
import { config as dotenvConfig } from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load API key from wiz's .env (shared across workspace)
dotenvConfig({ path: join(__dirname, '../../.env'), quiet: true });
if (!process.env.ANTHROPIC_API_KEY) {
    dotenvConfig({ path: join(__dirname, '../../../wiz/.env'), quiet: true });
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const MODEL = 'claude-sonnet-4-6';

/**
 * Simple message call — returns the text response
 */
export async function ask(system, userMessage, { maxTokens = 4096 } = {}) {
    const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: userMessage }],
    });
    return response.content[0].text;
}

/**
 * Tool-use call — returns the tool use block
 */
export async function askWithTools(system, userMessage, tools, { maxTokens = 4096, toolChoice } = {}) {
    const params = {
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: userMessage }],
        tools,
    };
    if (toolChoice) params.tool_choice = toolChoice;
    const response = await anthropic.messages.create(params);
    return response;
}

export { anthropic };
