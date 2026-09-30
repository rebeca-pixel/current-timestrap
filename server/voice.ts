import type { Express } from "express";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() });

export function registerVoiceRoutes(app: Express) {

  // ── Greeting text generator ──────────────────────────
  app.post("/api/aria/greet", async (req, res) => {
    try {
      const { employeeName, dueTaskCount, timeOfDay } = req.body;

      const greetingMap: Record<string, string> = {
        morning: `Good morning ${employeeName}! How can I help you today?`,
        afternoon: `Good afternoon ${employeeName}! How can I help you today?`,
        evening: `Good evening ${employeeName}! How can I help you today?`
      };

      const text = greetingMap[timeOfDay] ?? greetingMap.morning;
      res.json({ text });
    } catch {
      res.status(500).json({ error: "Greeting failed" });
    }
  });

  // ── Voice → Text (transcribe) ────────────────────────
  app.post("/api/aria/transcribe", upload.single("audio"), async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No audio received" });

      const formData = new FormData();
      const audioBlob = new Blob([file.buffer], { type: "audio/webm" });
      formData.append("file", audioBlob, "audio.webm");
      formData.append("model", "gpt-4o-mini-transcribe");
      formData.append("language", "en");

      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: formData
      });

      const data = await response.json() as { text: string };
      res.json({ text: data.text });
    } catch {
      res.status(500).json({ error: "Transcription failed" });
    }
  });

  // ── Text → Voice (speak) ─────────────────────────────
  app.post("/api/aria/speak", async (req, res) => {
    try {
      const { text } = req.body as { text: string };
      if (!text) return res.status(400).json({ error: "No text provided" });

      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          input: text,
          voice: "alloy"
        })
      });

      const audioBuffer = await response.arrayBuffer();
      res.set("Content-Type", "audio/mpeg");
      res.send(Buffer.from(audioBuffer));
    } catch {
      res.status(500).json({ error: "Speech failed" });
    }
  });
}
