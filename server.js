import express from 'express';
import cors from 'cors';
import multer from 'multer';
import FormData from 'form-data';

const app = express();
const upload = multer();

app.use(cors({ origin: "*" }));
app.use(express.json());

app.post('/api/claude', async (req, res) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.VITE_ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(req.body)
      });
      const data = await response.json();
      console.log("Anthropic status:", response.status);
      return res.json(data);
    } catch (err) {
      console.error(`Attempt ${attempt} failed:`, err.message);
      if (attempt === 3) return res.status(500).json({ error: err.message });
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
});

app.post('/api/whisper', upload.single('audio'), async (req, res) => {
  try {
    const FormDataNode = (await import('formdata-node')).FormData;
    const { Blob } = await import('buffer');
    const form = new FormDataNode();
    const blob = new Blob([req.file.buffer], { type: 'audio/webm' });
    form.set('file', blob, 'audio.webm');
    // Model is now controlled by the client; defaults to whisper-1 so existing
    // app calls behave exactly as before. The test bench sends gpt-4o-mini-transcribe.
    form.set('model', req.body.model || 'whisper-1');
    form.set('temperature', '0');
    if (req.body.language) form.set('language', req.body.language);
    // Prompt forwarded as-is. The old Hebrew prompt-doubling is removed: it
    // amplified prompt-echo (Whisper "transcribing" reference text that was
    // never spoken), which inflated kriah scores unpredictably.
    if (req.body.prompt) form.set('prompt', req.body.prompt);
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Whisper error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/gemini-audio', upload.single('audio'), async (req, res) => {
  try {
    const audioB64 = req.file.buffer.toString('base64');
    const model = req.body.model || 'gemini-3.5-flash';
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + process.env.GEMINI_API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { inlineData: { mimeType: req.file.mimetype || 'audio/webm', data: audioB64 } },
          { text: req.body.prompt || 'Transcribe this audio.' }
        ]}],
        generationConfig: { temperature: 0 }
      })
    });
    const d = await r.json();
    const text = d.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    if (!text) console.error('Gemini empty response:', JSON.stringify(d).slice(0, 300));
    res.json({ text });
  } catch (err) {
    console.error('Gemini audio error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
