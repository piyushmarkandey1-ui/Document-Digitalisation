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
    const files = (req.body.files || []) as any[];

    if (files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const prompt = `You are a world-class Optical Character Recognition (OCR) expert. Transcribe the text from the following images/documents with extreme precision.

CRITICAL INSTRUCTIONS:
1. Transcribe the text EXACTLY as written.
2. Preserve all original line breaks, paragraphs, and punctuation.
3. If handwriting is illegible, make your best guess based on context, but do not hallucinate words.
4. DO NOT add any markdown formatting (like bolding, italics, or headers) unless it is explicitly written in the document.
5. DO NOT add any introductory or concluding text (e.g. do not say "Here is the transcription:").
6. If the document is blank, output nothing.
7. Merge all pages seamlessly.
8. Output ONLY the transcribed text — nothing else`;

    const parts = [
      { text: prompt },
      ...files.map((file) => ({
        inline_data: {
          data: file.data,
          mime_type: file.mimeType,
        },
      }))
    ];

    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
      })
    });

    const responseData = await response.json();

    if (!response.ok) {
      throw responseData.error || new Error("Failed to extract text");
    }

    const outputText = responseData.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    
    res.json({
      text: outputText.trim(),
      wordCount: outputText.split(/\s+/).filter((w: string) => w.length > 0).length,
      charCount: outputText.length
    });
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
