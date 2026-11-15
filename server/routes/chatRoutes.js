
const express = require('express');
const router = express.Router();

const { GoogleGenAI } = require('@google/genai');

// Initialize Gemini
const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

// POST /api/chat
router.post('/', async (req, res) => {
    try {
        const { message } = req.body;

        // Validate message
        if (
            typeof message !== 'string' ||
            !message.trim()
        ) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a message.'
            });
        }

        if (message.length > 2000) {
            return res.status(400).json({
                success: false,
                message: 'Message cannot exceed 2000 characters.'
            });
        }

        // Check API key configuration
        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({
                success: false,
                message: 'Gemini API key is not configured.'
            });
        }

        // Generate AI response
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: message.trim(),
            config: {
                systemInstruction: `
                    You are Rain Buddy, the AI assistant
                    of RainMap Chennai.

                    Your responsibilities:
                    - Answer weather-related questions.
                    - Explain rainfall safety precautions.
                    - Help users understand RainMap features.
                    - Assist with journey and route planning.

                    Be friendly, helpful and concise.

                    IMPORTANT:
                    You do not currently have access to live
                    weather data, community reports or route data.

                    Never invent rainfall readings, weather
                    conditions, waterlogging reports or route
                    information.

                    If a user asks for live information,
                    explain that the relevant RainMap data
                    integration is not yet available.
                `,
                maxOutputTokens: 500
            }
        });

        const reply = response.text;

        if (!reply) {
            return res.status(502).json({
                success: false,
                message: 'Rain Buddy could not generate a response.'
            });
        }

        return res.status(200).json({
            success: true,
            reply
        });

    } catch (error) {
        console.error('Rain Buddy Gemini error:', error);

        return res.status(500).json({
            success: false,
            message: 'Rain Buddy is temporarily unavailable. Please try again.'
        });
    }
});

module.exports = router;
