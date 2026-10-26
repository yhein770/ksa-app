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

// Sends one audio file to OpenAI's transcription API.
// opts: { model, language, prompt } (all optional)
async function transcribeAudio(buffer, type, filename, opts = {}) {
  const FormDataNode = (await import('formdata-node')).FormData;
  const { Blob } = await import('buffer');
  const form = new FormDataNode();
  form.set('file', new Blob([buffer], { type }), filename);
  // Model is controlled by the client; defaults to whisper-1 so existing
  // app calls behave exactly as before. The test bench sends gpt-4o-mini-transcribe.
  form.set('model', opts.model || 'whisper-1');
  form.set('temperature', '0');
  if (opts.language) form.set('language', opts.language);
  // Prompt forwarded as-is. The old Hebrew prompt-doubling is removed: it
  // amplified prompt-echo (Whisper "transcribing" reference text that was
  // never spoken), which inflated kriah scores unpredictably.
  if (opts.prompt) form.set('prompt', opts.prompt);
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form
  });
  return response.json();
}

// The file's real type and name are passed through, so iPhone recordings
// (audio/mp4, .m4a) transcribe too. The KSA app sends recording.webm, so it
// behaves exactly as before.
app.post('/api/whisper', upload.single('audio'), async (req, res) => {
  try {
    const type = req.file.mimetype || 'audio/webm';
    const name = req.file.originalname || 'audio.webm';
    res.json(await transcribeAudio(req.file.buffer, type, name, req.body));
  } catch (err) {
    console.error("Whisper error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Homework site: transcribe a recording that's already in Firebase Storage.
// The proxy downloads it itself, so the browser never has to (no bucket CORS setup needed).
// Only files in this project's homework-audio folder are accepted.
const HOMEWORK_AUDIO_PREFIX =
  'https://firebasestorage.googleapis.com/v0/b/kitzur-app1.firebasestorage.app/o/homework-audio%2F';

app.post('/api/whisper-from-url', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (typeof url !== 'string' || !url.startsWith(HOMEWORK_AUDIO_PREFIX)) {
      return res.status(400).json({ error: 'Not a homework recording link.' });
    }
    const file = await fetch(url);
    if (!file.ok) return res.status(502).json({ error: `Couldn't download the recording (${file.status}).` });
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > 25 * 1024 * 1024) return res.status(413).json({ error: 'Recording is too large.' });
    const type = (file.headers.get('content-type') || 'audio/webm').split(';')[0];
    const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
    res.json(await transcribeAudio(buffer, type, `memo.${ext}`, req.body));
  } catch (err) {
    console.error("Whisper-from-url error:", err);
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
