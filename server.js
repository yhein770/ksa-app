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
    form.set('model', 'whisper-1');
    form.set('temperature', '0');
    if (req.body.language) form.set('language', req.body.language);
    if (req.body.prompt) {
      // Repeating the prompt doubles the vocabulary bias toward the expected text
      const p = req.body.prompt;
      form.set('prompt', req.body.language === 'he' ? `${p} ${p}` : p);
    }
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

app.post('/api/soniox-he', upload.single('audio'), async (req, res) => {
  try {
    const { FormData: NodeFormData } = await import('formdata-node');
    const { Blob } = await import('buffer');
    const form = new NodeFormData();
    const blob = new Blob([req.file.buffer], { type: 'audio/webm' });
    form.set('file', blob, 'audio.webm');

    // Step 1: Upload
    const uploadRes = await fetch('https://api.soniox.com/v1/files', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.SONIOX_API_KEY}` },
      body: form
    });
    const uploadData = await uploadRes.json();
    console.log("Soniox upload:", JSON.stringify(uploadData).slice(0, 200));
    const fileId = uploadData.id;
    if (!fileId) throw new Error("Soniox file upload failed: " + JSON.stringify(uploadData));

    // Step 2: Create transcription
    const transcriptRes = await fetch('https://api.soniox.com/v1/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SONIOX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file_id: fileId,
        model: 'stt-async-v4',
        language_hints: ['he'],
      })
    });
    const transcriptData = await transcriptRes.json();
    console.log("Soniox transcript created:", JSON.stringify(transcriptData).slice(0, 200));
    const transcriptId = transcriptData.id;
    if (!transcriptId) throw new Error("Soniox transcription failed: " + JSON.stringify(transcriptData));

    // Step 3: Poll until complete
    let result = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(`https://api.soniox.com/v1/transcriptions/${transcriptId}`, {
        headers: { 'Authorization': `Bearer ${process.env.SONIOX_API_KEY}` }
      });
      const pollData = await pollRes.json();
      console.log("Soniox poll status:", pollData.status);
     if (pollData.status === 'completed') {
  const textRes = await fetch(`https://api.soniox.com/v1/transcriptions/${transcriptId}/transcript`, {
    headers: { 'Authorization': `Bearer ${process.env.SONIOX_API_KEY}` }
  });
  const textData = await textRes.json();
  console.log("Soniox transcript fetch:", JSON.stringify(textData).slice(0, 500));
  result = textData;
  break;
}
      if (pollData.status === 'failed') throw new Error("Soniox transcription failed");
    }

    console.log("Soniox result keys:", Object.keys(result || {}));
    const text = result?.text || result?.transcript || result?.words?.map(w => w.text).join(' ') || '';
    console.log("Soniox final text:", text.slice(0, 200));
    res.json({ text });
  } catch (err) {
    console.error("Soniox error:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));