import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Set up large payload limits for photo uploads
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));

// Initialize Google GenAI
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;

if (apiKey) {
  ai = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
} else {
  console.warn("GEMINI_API_KEY environment variable is not defined. Gemini features will fail.");
}

// Health Check API
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", geminiConfigured: !!ai });
});

// Timetable Photo Parsing API
app.post("/api/gemini/parse-timetable", async (req, res) => {
  try {
    if (!ai) {
      return res.status(500).json({ 
        error: "Gemini API client is not configured. Please ensure your GEMINI_API_KEY is set in Settings > Secrets." 
      });
    }

    const { image, mimeType } = req.body;
    if (!image || !mimeType) {
      return res.status(400).json({ error: "Missing base64 image data or mimeType." });
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

    const promptString = `Analyze this physical or printed schedule timetable. 
Identify all weekly/recurring tasks, classes, work shifts, or school classes.
For each event found, extract:
1. Title (e.g. "Math 101", "Work Shift", "Chemistry Lab")
2. Days of the week (must be full day names like "Monday", "Tuesday", etc.)
3. Start time (must be in HH:MM format like "09:30" or "14:15")
4. End time (must be in HH:MM format like "11:00" or "15:45")
5. Category (e.g. Study, Work, Personal, Business, Health)
6. Notes (any room number, instructor, or location details)

Ensure the extracted start/end times are estimated accurately from the row/column structure. 
Return the output strictly in the requested JSON format.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Data,
          }
        },
        promptString
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: "Class or shift title" },
              days: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Full day names e.g. Monday, Wednesday"
              },
              startTime: { type: Type.STRING, description: "Start time in HH:MM format" },
              endTime: { type: Type.STRING, description: "End time in HH:MM format" },
              category: { type: Type.STRING, description: "Study, Work, Personal, Business, Health, etc." },
              notes: { type: Type.STRING, description: "Room, location, or instructor details" }
            },
            required: ["title", "days", "startTime", "endTime", "category"]
          }
        }
      }
    });

    const parsedText = response.text || "[]";
    const data = JSON.parse(parsedText);
    res.json({ events: data });
  } catch (error: any) {
    console.error("Gemini API error parsing timetable:", error);
    res.status(500).json({ 
      error: "Failed to parse timetable photo using Gemini. " + (error.message || String(error)) 
    });
  }
});

// AI Mindful Coaching API
app.post("/api/gemini/coach", async (req, res) => {
  try {
    if (!ai) {
      return res.status(500).json({ 
        error: "Gemini API client is not configured. Please ensure your GEMINI_API_KEY is set in Secrets." 
      });
    }

    const { tasks, habits, habitLogs, selectedDate } = req.body;

    const promptString = `You are Crown Planner's mindful AI Mentor & Performance Coach. 
Analyze the user's focus schedule for today (${selectedDate}).
Here is their scheduled data:
- Scheduled Tasks: ${JSON.stringify(tasks)}
- Habits to track: ${JSON.stringify(habits)}
- Habit logs: ${JSON.stringify(habitLogs)}

Provide structured, high-value coaching advice. 
CRITICAL ANTI-HALLUCINATION GUARDRAILS:
- Do NOT invent, assume, or hallucinate any tasks, habits, classes, locations, or items that are not explicitly provided in the user's scheduled data lists above.
- Only refer to the exact items passed in the lists. If the lists are empty, warmly encourage them to plan their day or establish habits, but do not fabricate any imaginary scheduled items.
- Keep all advice directly tethered to the actual items provided.

Return your response strictly as a JSON object with these keys:
1. "summary": A warm, encouraging 2-sentence greeting reflecting strictly on their actual logged item load.
2. "actionTips": An array of exactly 3 highly specific, actionable advice/tips tailored strictly to their scheduled items.
3. "focusPrompt": A beautiful, short, mindful focal intention (e.g., "Anchor your attention on completion rather than perfection.")

Keep the tone expert, elegant, calm, and supportive. Avoid any mechanical prefixes or comments in the JSON.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: promptString,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            actionTips: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            focusPrompt: { type: Type.STRING }
          },
          required: ["summary", "actionTips", "focusPrompt"]
        }
      }
    });

    const parsedText = response.text || "{}";
    res.json(JSON.parse(parsedText));
  } catch (error: any) {
    console.error("Gemini API error generating coaching advice:", error);
    res.status(500).json({ 
      error: "Failed to generate coaching advice. " + (error.message || String(error)) 
    });
  }
});

// JSON Error Handler Middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Express server caught error:", err);
  res.status(err.status || 500).json({
    error: err.message || "An unexpected server-side error occurred."
  });
});

// Start full-stack or serve Vite static assets
async function start() {
  if (process.env.NODE_ENV !== "production") {
    // Development Mode: Mount Vite's HMR middleware
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production Mode: Serve static files built by vite
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Fullstack Server] Running on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start the Express server:", err);
});
