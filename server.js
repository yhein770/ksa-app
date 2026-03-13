import express from 'express';
import cors from 'cors';
import multer from 'multer';
import FormData from 'form-data';

const app = express();
const upload = multer();

app.use(cors({ origin: "*" }));
app.use(express.json());

app.post('/api/claude', async (req, res) => {
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
    console.log("Anthropic response:", JSON.stringify(data).slice(0, 200));
    res.json(data);
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/whisper', upload.single('audio'), async (req, res) => {
  try {
    const FormDataNode = (await import('formdata-node')).FormData;
    const { Blob } = await import('buffer');
    
    const form = new FormDataNode();
    const blob = new Blob([req.file.buffer], { type: 'audio/webm' });
    form.set('file', blob, 'audio.webm');
    form.set('model', 'whisper-1');
    if (req.body.language) form.set('language', req.body.language);

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: form
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Whisper error:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));