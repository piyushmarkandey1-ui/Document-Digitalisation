import "dotenv/config";
import express from "express";
import path from "path";
import multer from "multer";
import { GoogleGenAI, Type } from "@google/genai";
import ExcelJS from "exceljs";
import cors from "cors";

// Initialize Core Extraction Engine
const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Configure Multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// AI Processing Endpoint
app.post("/api/process", upload.array("files"), async (req: any, res: any) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const files = req.files as any[];

    const prompt = `You are a precision multilingual data extraction engine. Analyze the attached document parts (multiple pages or files).
    
    TASK:
    1. Extract ALL tabular data, line items, and headers.
    2. SYNTHESIZE: If documents are multiple pages of one file, merge them into a SINGLE logical structured dataset.
    3. MULTILINGUAL: Detect and translate key headers to English if helpful, but preserve original text for specific item names/values.
    4. ACCURACY: Be extremely precise with numbers and dates.
    
    Output JSON strictly following the schema.`;

    const response = await genAI.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            ...files.map((file) => ({
              inlineData: {
                data: file.buffer.toString("base64"),
                mimeType: file.mimetype,
              },
            })),
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            columns: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            rows: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                additionalProperties: { type: Type.STRING },
              },
            },
          },
          required: ["columns", "rows"],
        },
      },
    });

    const outputText = response.text ?? '{"columns":[], "rows":[]}';
    const extraction = JSON.parse(outputText);
    res.json(extraction);
  } catch (error: any) {
    console.error("Extraction error:", error);
    res
      .status(500)
      .json({ error: error.message || "Failed to process document" });
  }
});

// Smart Analysis Endpoint
app.post("/api/analyze", async (req, res) => {
  try {
    const { data } = req.body;

    const analysisPrompt = `You are a senior business analyst. Analyze this extracted tabular data.
    Provide:
    1. A concise professional executive summary (2-3 sentences).
    2. 3-4 key business metrics (label and value, and optional trend description).
    3. Up to 6 categorized data points for a chart (name and numeric value).
    Data: ${JSON.stringify(data)}`;

    const response = await genAI.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [{ text: analysisPrompt }],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            metrics: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  value: { type: Type.STRING },
                  trend: { type: Type.STRING },
                },
                required: ["label", "value"],
              },
            },
            chartData: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  value: { type: Type.NUMBER },
                },
                required: ["name", "value"],
              },
            },
          },
          required: ["summary", "metrics", "chartData"],
        },
      },
    });

    const outputText = response.text ?? "{}";
    res.json(JSON.parse(outputText));
  } catch (error: any) {
    console.error("Analysis error:", error);
    res.status(500).json({ error: "Failed to analyze data" });
  }
});

// Excel Export Endpoint
app.post("/api/export", async (req, res) => {
  try {
    const { data, filename } = req.body;
    const { columns, rows } = data;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Extracted Data");

    // Add headers
    const headerRow = worksheet.addRow(columns);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4F46E5" }, // Indigo-600
    };
    headerRow.alignment = { horizontal: "center" };

    // Add data rows
    rows.forEach((row: any) => {
      const values = columns.map((col: string) => row[col] || "");
      worksheet.addRow(values);
    });

    // Auto-fit columns
    worksheet.columns.forEach((column) => {
      let maxLength = 0;
      column.eachCell?.({ includeEmpty: true }, (cell) => {
        const columnLength = cell.value ? cell.value.toString().length : 10;
        if (columnLength > maxLength) {
          maxLength = columnLength;
        }
      });
      column.width = maxLength < 12 ? 12 : maxLength + 2;
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${filename || "export.xlsx"}`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error: any) {
    console.error("Export error:", error);
    res.status(500).json({ error: "Failed to generate Excel file" });
  }
});

// Export app for Vercel serverless deployment
export { app };

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Dynamic import so vite is never loaded in the Vercel serverless runtime
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Only start listening if not running in a serverless environment (like Vercel)
  if (process.env.VERCEL !== "1") {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Sheetify server running at http://localhost:${PORT}`);
    });
  }
}

startServer();
