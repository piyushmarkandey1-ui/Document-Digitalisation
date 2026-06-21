import { GoogleGenAI } from "@google/genai";

const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};

interface FilePayload {
  data: string;
  mimeType: string;
  name: string;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { files } = req.body as { files: FilePayload[] };

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files provided" });
    }

    const prompt = `You are a professional OCR (Optical Character Recognition) system specialised in reading handwritten documents, notes, letters, and forms.

TASK: Carefully read and transcribe ALL text visible in the provided document(s).

STRICT RULES:
1. Transcribe EVERY word exactly as written — preserve spelling even if incorrect
2. Preserve paragraph breaks, line breaks, bullet points, and numbering
3. If a word is genuinely illegible, write [illegible] in its place
4. Include both printed and handwritten text
5. Preserve numbers, dates, formulas, and special characters exactly
6. If multiple pages/documents, separate each with: --- Page X ---
7. Do NOT add any commentary, explanations, or corrections
8. Output ONLY the transcribed text — nothing else`;

    const response = await genAI.models.generateContent({
      model: "gemini-1.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            ...files.map((file) => ({
              inlineData: {
                data: file.data,
                mimeType: file.mimeType,
              },
            })),
          ],
        },
      ],
    });

    const text = response.text ?? "";
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    const charCount = text.length;

    res.json({ text, wordCount, charCount });
  } catch (error: any) {
    console.error("Text extraction error:", error);
    const status = error?.status || error?.code || 500;
    let message = error.message || "Failed to extract text";
    if (status === 429 || message.includes("RESOURCE_EXHAUSTED") || message.includes("quota")) {
      message = `Gemini API quota exceeded. (Raw error: ${error.message})`;
    } else if (message.includes("API_KEY_INVALID") || message.includes("API key not valid")) {
      message = `Invalid Gemini API key. (Raw error: ${error.message})`;
    } else {
      message = `${message} (Status: ${status})`;
    }
    res.status(typeof status === "number" ? status : 500).json({ error: message });
  }
}
