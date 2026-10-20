/**
 * Vision Service for eLeagueBot
 * Powered by Google AI Studio (Gemini Multimodal Vision API)
 * 
 * Extracts match participants and final scores directly from post-match eFootball screenshots.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Recommended model for fast, accurate vision reasoning
const GEMINI_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';

const VisionService = {
  /**
   * Checks if Google AI Studio Vision is configured
   */
  isEnabled() {
    return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
  },

  /**
   * Analyzes an eFootball match screen using Google AI Studio Gemini API
   * 
   * @param {string} base64Data - Raw base64 string of the image
   * @param {string} mimeType - e.g. 'image/jpeg', 'image/png'
   * @returns {Promise<{ home: string, away: string, home_score: number, away_score: number, confidence: string }>}
   */
  async parseMatchScreenshot(base64Data, mimeType = 'image/jpeg') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('Google AI Studio API Key is not configured. Add GEMINI_API_KEY to your .env file.');
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const prompt = `
You are an expert eFootball / PES league score parser.
Examine this post-match screenshot carefully.
Extract:
1. The Home player or team name
2. The Away player or team name
3. The Home final score
4. The Away final score

Respond strictly with valid JSON conforming to this schema:
{
  "home": "Home player or club name",
  "away": "Away player or club name",
  "home_score": 0,
  "away_score": 0,
  "confidence": "high" | "medium" | "low"
}
`;

    const requestBody = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        response_mime_type: 'application/json',
        temperature: 0.1,
      },
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Google AI Studio API error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidate) {
      throw new Error('No readable match data could be extracted from the screenshot.');
    }

    try {
      const parsed = JSON.parse(candidate);
      return {
        home: parsed.home,
        away: parsed.away,
        home_score: parseInt(parsed.home_score, 10),
        away_score: parseInt(parsed.away_score, 10),
        confidence: parsed.confidence || 'high',
      };
    } catch (parseErr) {
      throw new Error(`Failed to parse AI vision response: ${candidate}`);
    }
  },
};

module.exports = VisionService;
