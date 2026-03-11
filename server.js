import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Claude proxy running on port ${PORT}`));