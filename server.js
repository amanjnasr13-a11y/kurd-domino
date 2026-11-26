const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ڕێگەپێدان بە CORS بۆ ئەپی مۆبایل (Capacitor) و وێب
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// ڕێگەپێدان بە وەرگرتنی وێنەی قەبارە گەورە و فایلە ستاتیکەکان
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'www')));
app.use('/materials', express.static(path.join(__dirname, 'www', 'materials')));

// لاپەڕە سەرەکییەکان
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'www', 'index.html'));
});

app.get('/marketplace', (req, res) => {
  res.sendFile(path.join(__dirname, 'www', 'marketplace.html'));
});

app.get('/admin', (req, res) => {
  const wwwAdmin = path.join(__dirname, 'www', 'admin.html');
  if (fs.existsSync(wwwAdmin)) {
    return res.sendFile(wwwAdmin);
  }
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ==========================================
// --- بەشی زیرەکی دەستکرد (Google Gemini AI) ---
// ==========================================
function parseBase64Image(dataUrl) {
  if (!dataUrl) return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], data: match[2] };
  }
  return { mimeType: 'image/jpeg', data: dataUrl };
}

async function callGemini(apiKey, systemInstruction, contents, useGoogleSearch = false) {
  const models = ['gemini-3.8-flash', 'gemini-flash-latest'];
  let lastError = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const bodyData = {
        contents: contents,
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 8192
        }
      };

      // مۆدێلی gemma پشتگیری systemInstruction ناکات، بۆیە تەنها بۆ gemini دایدەنێین
      if (!model.includes('gemma')) {
        bodyData.systemInstruction = { parts: [{ text: systemInstruction }] };
        if (useGoogleSearch) {
          bodyData.tools = [{ googleSearch: {} }];
        }
      } else {
        // بۆ gemma ڕێنماییەکە دەخەینە سەرەتای پرسیارەکە
        bodyData.contents = [
          { role: 'user', parts: [{ text: `ڕێنمایی سیستەم:\n${systemInstruction}\n\n` }] },
          ...contents
        ];
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || `Gemini HTTP ${response.status}`);
      }

      const parts = data.candidates?.[0]?.content?.parts || [];
      const answer = parts.map(p => p.text || '').join('').trim();
      if (!answer) {
        throw new Error('وەڵامەکە بە بەتاڵی گەڕایەوە.');
      }
      return answer;
    } catch (err) {
      console.error(`❌ هەڵە لە مۆدێلی ${model}:`, err.message);
      lastError = err;
    }
  }

  // ئەگەر هەموو مۆدێلەکانی گۆگڵ قەرەباڵغ بوون، یەکسەر دەچێتە سەر OpenRouter وەک یەدەگ
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    const orModels = ['google/gemma-3-27b-it:free', 'deepseek/deepseek-chat-v3-0324:free', 'mistralai/mistral-small-3.1-24b-instruct:free'];
    const orMessages = [{ role: 'system', content: systemInstruction }];
    for (const c of contents) {
      const txt = c.parts?.map(p => p.text || '').join(' ').trim();
      if (txt) orMessages.push({ role: c.role === 'model' ? 'assistant' : 'user', content: txt });
    }

    for (const orModel of orModels) {
      try {
        const resOr = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ model: orModel, messages: orMessages, max_tokens: 4096 })
        });
        const dataOr = await resOr.json();
        const ansOr = dataOr.choices?.[0]?.message?.content;
        if (resOr.ok && ansOr) return ansOr;
        throw new Error(dataOr.error?.message || `HTTP ${resOr.status}`);
      } catch (e) { console.error('❌ هەڵەی OpenRouter:', orModel, e.message); }
    }
  }

  throw lastError || new Error('هەڵە لە پەیوەندی بە AI ڕوویدا');
}

// بەشی کتێب و مەلزەمەکان (PDF)
const materialsDir = path.join(__dirname, 'materials');
if (!fs.existsSync(materialsDir)) {
  fs.mkdirSync(materialsDir, { recursive: true });
}
app.use('/materials', express.static(materialsDir));

app.get('/api/materials-list', (req, res) => {
  fs.readdir(materialsDir, (err, files) => {
    if (err) return res.json([]);
    const pdfs = files.filter(f => f.toLowerCase().endsWith('.pdf'));
    res.json(pdfs);
  });
});

// بەشی چاتکردنی گشتی (Kurd AI) بە Google Gemini + گەڕانی زیندووی گۆگڵ + کات + کەشوهەوا + هەرسێ زمان + وێنە
app.post('/api/chat', async (req, res) => {
  try {
    const { history, imageBase64, lang } = req.body;
    if ((!history || history.length === 0) && !imageBase64) {
      return res.status(400).json({ error: 'تکایە پرسیارەکەت بنووسە یان وێنەیەک دابنێ.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'کلیلی GEMINI_API_KEY لە سێرڤەری Railway دانەنراوە!' });
    }

    const kurdistanTime = new Date().toLocaleString('en-US', {
      timeZone: 'Asia/Baghdad',
      dateStyle: 'full',
      timeStyle: 'short'
    });

    const recentHistory = (history || []).slice(-12);
    const rawUserText = (recentHistory[recentHistory.length - 1]?.content || '');
    const normalizedText = rawUserText.replace(/ك/g, 'ک').replace(/ي/g, 'ی').trim();

    // هێنانی کەشوهەوای ڕاستەوخۆی شارەکانی کوردستان
    let liveWeatherInfo = '';
    if (/کەش|هەوا|گەرما|باران|ساردی|پلەی|طقس|حرارة|weather|temp/i.test(normalizedText)) {
      try {
        const cities = [
          { name: 'هەولێر (Erbil)', q: 'Erbil' },
          { name: 'سلێمانی (Sulaymaniyah)', q: 'Sulaymaniyah' },
          { name: 'دهۆک (Duhok)', q: 'Duhok' },
          { name: 'کەرکووک (Kirkuk)', q: 'Kirkuk' },
          { name: 'هەڵەبجە (Halabja)', q: 'Halabja' }
        ];
        const results = await Promise.all(cities.map(async c => {
          const r = await fetch(`https://wttr.in/${c.q}?format=%C+%t`);
          const txt = await r.text();
          return `${c.name}: ${txt.trim()}`;
        }));
        liveWeatherInfo = `\nکەشوهەوای ڕاستەقینەی ئێستای شارەکانی کوردستان:\n${results.join('\n')}`;
      } catch (e) {}
    }

    const langInstruction = `بەکارهێنەر دەتوانێت بە هەرسێ زمانی کوردی، عەرەبی، یان ئینگلیزی پرسیار بکات.
یاسای زێڕین: هەمیشە سەیری زمانی دوایین پرسیاری بەکارهێنەر بکە:
- ئەگەر بە عەرەبی نووسی، تەواوی وەڵامەکە تەنها بە عەرەبی بنووسە و هیچ وشەیەکی کوردی تێکەڵ مەکە.
- ئەگەر بە ئینگلیزی نووسی، تەواوی وەڵامەکە تەنها بە ئینگلیزی بنووسە.
- ئەگەر بە کوردی نووسی (یان تەنها وێنەی نارد کاتێک زمانی چاتەکە کوردییە)، بە کوردیی سۆرانیی پاراو، تەواو و ورد وەڵام بدەرەوە. (زمانی هەڵبژێردراوی چاتەکە: ${lang || 'ku'}).`;

    const systemInstruction = `تۆ (Kurd AI - کورد ئەی ئای)ـیت، زیرەکترین یاریدەدەری دیجیتاڵی هاوشێوەی Google Gemini.
تۆ بە گەڕانی زیندووی گۆگڵ (Google Search)ـەوە بەستراویتەتەوە و زانیاریی زیندووی ئەمڕۆت لەبەردەستە (نرخی دۆلار و دراوەکان لە هەرێمی کوردستان و عێراق، نرخی زێڕ، کەشوهەوا، هەواڵەکان، ئەنجامی یارییەکان، و هەموو زانیارییەکی جیهانی).
قەدەغەیە بە هیچ شێوەیەک بڵێیت "من مۆدێلێکی زمانم و دەستم بە زانیاریی ڕاستەوخۆ ناگات" یان "ناتوانم نرخی دراو و کەشوهەوا بزانم"!
کات و بەرواری ڕاستەقینەی ئێستا لە کوردستان و عێراق: ${kurdistanTime}.${liveWeatherInfo}
${langInstruction}
یاساکانی وەڵامدانەوە:
1. وەڵامەکانت با تەواو، ڕێکخراو، ورد و پڕ زانیاری بن و هەرگیز لە نیوەدا مەیانبڕە.
2. ئەگەر بەکارهێنەر تەنها سڵاوی کرد (وەک "سڵاو" یان "مرحبا" یان "Hello")، وەک هاوڕێیەکی زیرەک بە گەرمی سڵاوی لێ بکەرەوە و بڵێ چۆن دەتوانیت یارمەتی بدەیت.
3. بۆ هەموو پرسیارێکی تر (نرخی ١٠٠ دۆلار بە دینار لە بازاڕی هەولێر و سلێمانی، نرخی مسقاڵی زێڕ، کەشوهەوا، هەواڵ، یان هەر زانیارییەکی تر)، گەڕانی گۆگڵ بەکاربهێنە و وەڵامێکی ورد و ڕوون بدەرەوە.
4. ئەگەر وێنەیەکی نارد، بە وردی هەموو شتێکی ناو وێنەکەی بۆ باس بکە.
5. هێما تێکەڵەکانی LaTeX وەک ($ یان $$) و لینکی درێژی ئینتەرنێت (http یان https) مەنووسە.`;

    const contents = [];
    for (const msg of recentHistory) {
      const role = msg.role === 'assistant' ? 'model' : 'user';
      const text = typeof msg.content === 'string' ? msg.content : '';
      if (text) {
        contents.push({ role, parts: [{ text }] });
      }
    }

    if (imageBase64) {
      const parsedImg = parseBase64Image(imageBase64);
      const defaultImagePrompt = lang === 'ar'
        ? 'اشرح لي كل شيء في هذه الصورة بالتفصيل.'
        : lang === 'en'
        ? 'Explain everything in this image in detail.'
        : 'ئەم وێنەیەم بە وردی بۆ باس بکە و هەموو زانیارییەکی گرنگی تێدا ڕوون بکەرەوە.';

      const lastContent = contents[contents.length - 1];
      if (lastContent && lastContent.role === 'user') {
        if (!lastContent.parts[0]?.text) {
          lastContent.parts[0] = { text: defaultImagePrompt };
        }
        lastContent.parts.push({
          inlineData: { mimeType: parsedImg.mimeType, data: parsedImg.data }
        });
      } else {
        contents.push({
          role: 'user',
          parts: [
            { text: defaultImagePrompt },
            { inlineData: { mimeType: parsedImg.mimeType, data: parsedImg.data } }
          ]
        });
      }
    }

    const isGreetingOnly = !imageBase64 && /^(سڵاو|سلاو|چۆنیت|باشیت|مرحبا|هلا|السلام عليكم|hi|hello|hey)[\s!؟?]*$/i.test(normalizedText);
    const useGoogleSearch = !isGreetingOnly;

    let answer;
    try {
      answer = await callGemini(apiKey, systemInstruction, contents, useGoogleSearch);
    } catch (err) {
      if (useGoogleSearch) {
        answer = await callGemini(apiKey, systemInstruction, contents, false);
      } else {
        throw err;
      }
    }

    answer = answer
      .replace(/\[([^\]]+)\]\(https?:\/\/[^\)]+\)/g, '$1')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\[[^\]]+\.(com|org|net|io|co|iq)\]/gi, '');

    return res.json({ answer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// بەشی قوتابیان (شیکارکردنی پرسیار و وێنە بە Google Gemini)
app.post('/api/solve-question', async (req, res) => {
  try {
    const { questionText, imageBase64, subject } = req.body;

    if (!questionText && !imageBase64) {
      return res.status(400).json({ error: 'تکایە پرسیار یان وێنە بنێرە.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'کلیلی GEMINI_API_KEY لە Railway دانەنراوە!' });
    }

    const parts = [];
    if (questionText && imageBase64) {
      parts.push({
        text: `بابەت: ${subject || 'گشتی'}\nتێبینی قوتابی: ${questionText}\nتکایە وێنەکە بخوێنەرەوە و بە پێی تێبینی قوتابییەکە بە زمانی کوردی (سۆرانی) هەنگاو بە هەنگاو شیکاری بکە.`
      });
    } else if (questionText) {
      parts.push({
        text: `بابەت: ${subject || 'گشتی'}\nپرسیار: ${questionText}\nتکایە بە زمانی کوردی (سۆرانی) و بە هەنگاوی ڕوون و زانستی وەڵام بدەرەوە.`
      });
    } else {
      parts.push({
        text: `بابەت: ${subject || 'گشتی'}\nتکایە نووسین یان هاوکێشەی ناو ئەم وێنەیە بە وردی بخوێنەرەوە و بە زمانی کوردی (سۆرانی) هەنگاو بە هەنگاو شیکاری بکە.`
      });
    }

    if (imageBase64) {
      const parsedImg = parseBase64Image(imageBase64);
      parts.push({
        inlineData: { mimeType: parsedImg.mimeType, data: parsedImg.data }
      });
    }

    const systemInstruction = `تۆ مامۆستایەکی زیرەکی پسپۆڕیت لە هەرێمی کوردستان کە بە تەواوی شارەزای هەرسێ زمانی (کوردی، عەرەبی، و ئینگلیزی)ـیت لە بیرکاری، فیزیا، کیمیا، و هەموو وانەکاندا.

یاسا زۆر گرنگەکان بۆ شیکارکردنی وێنە و نووسین:
١. ناسینەوەی هەرسێ زمانەکە بە وردی:
- ئەگەر هاوکێشەکە بە کوردی یان عەرەبی نووسرابوو (بە پیتەکانی: س، ص، ع، یان ژمارە عەرەبی/هیندییەکانی: ٠، ١، ٢، ٣، ٤، ٥، ٦، ٧، ٨، ٩)، بۆ نموونە: (٧ = ٥ + س٢) یان (٢س + ٥ = ٧)، بە تەواوی وەک هاوکێشەی بیرکاری بیخوێنەرەوە و شیکاری بکە (هەرگیز وەک پیتی یۆنانی یان ئۆمێگا مەیخوێنەرەوە).
- ئەگەر هاوکێشەکە بە ئینگلیزی نووسرابوو (بە پیتەکانی: x, y, z, a, b و ژمارە ئینگلیزییەکانی: 0, 1, 2, 3...)، بۆ نموونە: (2x + 5 = 7)، بە ڕێبازی ئینگلیزی شیکاری بکە.
- ئەگەر پرسیارەکە وانەی زمانەوانی (کوردی، عەرەبی، یان ئینگلیزی) بوو، بە پێی یاساکانی ئەو زمانە وەڵامی بدەرەوە.

٢. شێوازی نووسینی وەڵام:
- هەموو ڕوونکردنەوە و هەنگاوەکان بە زمانی کوردیی سۆرانییەکی پاراو، تەواو و سادە بنووسە تا قوتابی بە ئاسانی لێی تێبگات.
- بە هیچ شێوەیەک هێما تێکەڵەکانی LaTeX وەک ($ یان $$ یان \\omega یان \\times یان \\frac) بەکارمەهێنە؛ لە جیاتی ئەوانە نیشانەی ئاسایی وەک (× ، ÷ ، + ، - ، =) بنووسە تا لە شاشەی مۆبایل بە جوانی و بێ تێکچوون دەربکەوێت.`;

    const contents = [{ role: 'user', parts }];
    const answer = await callGemini(apiKey, systemInstruction, contents, false);
    return res.json({ answer });
  } catch (err) {
    console.error('❌ هەڵەی گشتی لە /api/solve-question:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// --- بەشی بازاڕ و پەسەندکردنی ئەدمین ---
// ==========================================
const MARKET_FILE = path.join(__dirname, 'items.json');

function getMarketItems() {
  if (!fs.existsSync(MARKET_FILE)) return [];
  try {
    const data = fs.readFileSync(MARKET_FILE, 'utf-8');
    return JSON.parse(data || '[]');
  } catch (err) {
    return [];
  }
}

function saveMarketItems(items) {
  fs.writeFileSync(MARKET_FILE, JSON.stringify(items, null, 2), 'utf-8');
}

app.get('/api/marketplace/items', (req, res) => {
  const items = getMarketItems();
  const approvedItems = items.filter(item => item.status === 'approved');
  res.json(approvedItems);
});

app.post('/api/marketplace/items', (req, res) => {
  try {
    const items = getMarketItems();
    const newItem = {
      id: Date.now(),
      status: 'pending',
      createdAt: new Date().toISOString(),
      ...req.body
    };
    items.unshift(newItem);
    saveMarketItems(items);
    res.json({ success: true, message: 'کاڵاکەت نێردرا و پاش پەسەندکردنی ئەدمین بڵاودەبێتەوە.' });
  } catch (err) {
    res.status(500).json({ error: 'پاشەکەوت نەکرا' });
  }
});

app.get('/api/admin/marketplace/items', (req, res) => {
  const items = getMarketItems();
  res.json(items);
});

app.post('/api/admin/marketplace/approve/:id', (req, res) => {
  const id = Number(req.params.id);
  const items = getMarketItems();
  const item = items.find(i => i.id === id);
  if (item) {
    item.status = 'approved';
    saveMarketItems(items);
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'کاڵاکە نەدۆزرایەوە' });
});

app.delete('/api/admin/marketplace/reject/:id', (req, res) => {
  const id = Number(req.params.id);
  let items = getMarketItems();
  items = items.filter(i => i.id !== id);
  saveMarketItems(items);
  res.json({ success: true });
});

// ==========================================
// --- بەشی یاریی دۆمینە (Domino Game Logic) ---
// ==========================================
const rooms = {};

function generateFullDeck() {
  const deck = [];
  let id = 0;
  for (let i = 0; i <= 6; i++) {
    for (let j = i; j <= 6; j++) {
      deck.push({ id: id++, left: i, right: j, a: i, b: j });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

function getHandSum(hand) {
  if (!hand || !Array.isArray(hand)) return 0;
  return hand.reduce((sum, t) => {
    const a = Number(t.a !== undefined ? t.a : (t.left !== undefined ? t.left : t[0])) || 0;
    const b = Number(t.b !== undefined ? t.b : (t.right !== undefined ? t.right : t[1])) || 0;
    return sum + a + b;
  }, 0);
}

// دۆزینەوەی خاوەنی گەورەترین جووت (لە 6-6 بۆ 0-0) یان گەورەترین پوول لە یەکەم گەڕدا
function findFirstRoundStarter(players) {
  for (let d = 6; d >= 0; d--) {
    for (let pIdx = 0; pIdx < players.length; pIdx++) {
      const hasDouble = players[pIdx].hand.some(t => {
        const a = Number(t.a !== undefined ? t.a : (t.left !== undefined ? t.left : t[0]));
        const b = Number(t.b !== undefined ? t.b : (t.right !== undefined ? t.right : t[1]));
        return a === d && b === d;
      });
      if (hasDouble) {
        return { starterIdx: pIdx, requiredTile: { a: d, b: d } };
      }
    }
  }

  // ئەگەر هیچ یاریزانێک جووتی نەبوو (لە ٢ نەفەریدا دەگونجێت)، گەورەترین پوول دەست پێدەکات
  let bestIdx = 0;
  let maxSum = -1;
  let bestTile = null;
  players.forEach((p, pIdx) => {
    p.hand.forEach(t => {
      const a = Number(t.a !== undefined ? t.a : (t.left !== undefined ? t.left : t[0]));
      const b = Number(t.b !== undefined ? t.b : (t.right !== undefined ? t.right : t[1]));
      if (a + b > maxSum) {
        maxSum = a + b;
        bestIdx = pIdx;
        bestTile = { a, b };
      }
    });
  });
  return { starterIdx: bestIdx, requiredTile: bestTile };
}

function startServerTurnGuard(room) {
  clearTimeout(room.serverGuardTimeout);
  if (!room || !room.players || room.players.length === 0) return;
  const currentP = room.players[room.turnIdx];
  if (!currentP || currentP.isBot) return;

  room.serverGuardTimeout = setTimeout(() => {
    if (!room || !room.players) return;
    const p = room.players[room.turnIdx];
    if (!p || p.id !== currentP.id) return;

    p.isBot = true;
    checkIfBotTurn(room);
    p.isBot = false;
  }, 18000);
}

function fillRoomWithBotsAndStart(room) {
  if (!room || room.started) return;
  clearInterval(room.waitInterval);
  room.started = true;

  const botNames = ['وەستا حەمە', 'وەستا سەردار', 'وەستا ڕێبوار'];
  let botCounter = 0;

  while (room.players.length < room.mode) {
    const seat = room.players.length;
    const team = (seat % 2 === 0) ? 'teamA' : 'teamB';
    let bName = botNames[botCounter++] || `بۆت ${seat}`;
    if (room.mode === 4 && seat === 2) bName += ' (شەریک)';

    room.players.push({
      id: 'bot_' + seat + '_' + Date.now(),
      name: bName,
      seat: seat,
      team: team,
      isBot: true,
      hand: []
    });
  }

  setupRound(room);
}

function setupRound(room) {
  const fullDeck = generateFullDeck();
  room.board = [];
  room.deck = [];
  room.consecutivePasses = 0;
  clearTimeout(room.botTimeout);
  clearTimeout(room.serverGuardTimeout);

  room.players.forEach((p, idx) => {
    p.hand = fullDeck.slice(idx * 7, (idx + 1) * 7);
  });

  if (room.mode === 2) {
    room.deck = fullDeck.slice(room.players.length * 7);
  } else {
    room.deck = [];
  }

  const isFirstEverRound = (room.starterSeat === null || room.starterSeat === undefined);
  let requiredFirstTile = null;

  if (!isFirstEverRound) {
    room.turnIdx = room.players.findIndex(p => p.seat === room.starterSeat);
    if (room.turnIdx === -1) room.turnIdx = 0;
  } else {
    const starterInfo = findFirstRoundStarter(room.players);
    room.turnIdx = starterInfo.starterIdx;
    requiredFirstTile = starterInfo.requiredTile;
  }

  room.requiredFirstTile = requiredFirstTile;
  const currentP = room.players[room.turnIdx];

  const handCounts = {};
  const playerNames = [];
  room.players.forEach(p => {
    handCounts[p.seat] = p.hand.length;
    playerNames[p.seat] = p.name;
  });

  console.log(`\n🎲 گەڕی نوێ دەستیپێکرد لە [${room.id}] | دەستپێکەر: [${currentP.name}]`);

  room.players.forEach(p => {
    if (!p.isBot) {
      io.to(p.id).emit('game_live', {
        roomId: room.id,
        mySeat: p.seat,
        myHand: p.hand,
        playerNames: playerNames,
        turnSeat: currentP.seat,
        turnSocketId: currentP.id,
        turnName: currentP.name,
        boneyardCount: room.deck.length,
        handCounts: handCounts,
        board: room.board,
        teamScores: room.teamScores,
        mode: room.mode,
        isFirstEverRound: isFirstEverRound,
        requiredFirstTile: requiredFirstTile
      });
    }
  });

  if (currentP.isBot) {
    room.botTimeout = setTimeout(() => checkIfBotTurn(room), 1500);
  } else {
    startServerTurnGuard(room);
  }
}

function advanceTurn(room, playedSeat = null) {
  if (!room || !room.players || room.players.length === 0) return;
  clearTimeout(room.botTimeout);
  clearTimeout(room.serverGuardTimeout);

  room.turnIdx = (room.turnIdx + 1) % room.players.length;
  const currentP = room.players[room.turnIdx];

  const handCounts = {};
  room.players.forEach(p => {
    handCounts[p.seat] = (p.hand && Array.isArray(p.hand)) ? p.hand.length : 0;
  });

  io.to(room.id).emit('turn_advanced', {
    board: room.board,
    boneyardCount: room.deck.length,
    currentTurnSocketId: currentP.id,
    currentTurnSeat: currentP.seat,
    turnName: currentP.name,
    playedSeat: playedSeat,
    teamScores: room.teamScores,
    handCounts: handCounts
  });

  if (currentP.isBot) {
    room.botTimeout = setTimeout(() => checkIfBotTurn(room), 1500);
  } else {
    startServerTurnGuard(room);
  }
}

function checkIfBotTurn(room) {
  if (!room || !room.players) return;
  const currentP = room.players[room.turnIdx];
  if (!currentP || !currentP.isBot) return;

  try {
    if (!currentP.hand || currentP.hand.length === 0) {
      handleRoundWin(room, currentP, false);
      return;
    }

    let playableMove = null;

    if (room.board && room.board.length > 0) {
      const firstTile = room.board[0];
      const lastTile = room.board[room.board.length - 1];

      const leftEnd = Number(firstTile.left);
      const rightEnd = Number(lastTile.right);

      for (let i = 0; i < currentP.hand.length; i++) {
        const t = currentP.hand[i];
        if (!t) continue;
        const a = Number(t.a !== undefined ? t.a : (t.left !== undefined ? t.left : t[0]));
        const b = Number(t.b !== undefined ? t.b : (t.right !== undefined ? t.right : t[1]));

        if (b === leftEnd) {
          playableMove = { index: i, tile: t, end: 'left', placeLeft: a, placeRight: b };
          break;
        } else if (a === leftEnd) {
          playableMove = { index: i, tile: t, end: 'left', placeLeft: b, placeRight: a };
          break;
        } else if (a === rightEnd) {
          playableMove = { index: i, tile: t, end: 'right', placeLeft: a, placeRight: b };
          break;
        } else if (b === rightEnd) {
          playableMove = { index: i, tile: t, end: 'right', placeLeft: b, placeRight: a };
          break;
        }
      }
    } else {
      let targetIdx = 0;
      if (room.requiredFirstTile) {
        const reqIdx = currentP.hand.findIndex(t => {
          const a = Number(t.a !== undefined ? t.a : (t.left !== undefined ? t.left : t[0]));
          const b = Number(t.b !== undefined ? t.b : (t.right !== undefined ? t.right : t[1]));
          return (a === room.requiredFirstTile.a && b === room.requiredFirstTile.b) ||
                 (a === room.requiredFirstTile.b && b === room.requiredFirstTile.a);
        });
        if (reqIdx !== -1) targetIdx = reqIdx;
      }

      const t = currentP.hand[targetIdx];
      const a = Number(t.a !== undefined ? t.a : (t.left !== undefined ? t.left : t[0]));
      const b = Number(t.b !== undefined ? t.b : (t.right !== undefined ? t.right : t[1]));
      playableMove = { index: targetIdx, tile: t, end: 'right', placeLeft: a, placeRight: b };
    }

    if (playableMove) {
      currentP.hand.splice(playableMove.index, 1);
      room.consecutivePasses = 0;
      room.requiredFirstTile = null;

      const newTileObj = {
        left: playableMove.placeLeft,
        right: playableMove.placeRight,
        a: playableMove.placeLeft,
        b: playableMove.placeRight
      };

      if (!room.board || room.board.length === 0) {
        room.board = [newTileObj];
      } else if (playableMove.end === 'left') {
        room.board.unshift(newTileObj);
      } else {
        room.board.push(newTileObj);
      }

      if (currentP.hand.length === 0) {
        handleRoundWin(room, currentP, false);
        return;
      }

      advanceTurn(room, currentP.seat);
    } else {
      if (room.mode === 2 && room.deck && room.deck.length > 0) {
        const pulled = room.deck.pop();
        currentP.hand.push(pulled);
        io.to(room.id).emit('deck_update', {
          boneyardCount: room.deck.length,
          handCounts: { [currentP.seat]: currentP.hand.length }
        });
        room.botTimeout = setTimeout(() => checkIfBotTurn(room), 1000);
        return;
      }

      handlePass(room, currentP);
    }
  } catch (err) {
    console.error('هەڵە لە بۆت:', err);
    advanceTurn(room, null);
  }
}

function handlePass(room, player) {
  room.consecutivePasses = (room.consecutivePasses || 0) + 1;
  io.to(room.id).emit('player_said_pass', { name: player ? player.name : '' });

  if (room.consecutivePasses >= room.players.length) {
    handleLockedGame(room);
    return;
  }
  advanceTurn(room, null);
}

function handleLockedGame(room) {
  let minPoints = Infinity;
  let winner = null;

  room.players.forEach(p => {
    const sum = getHandSum(p.hand);
    if (sum < minPoints) {
      minPoints = sum;
      winner = p;
    }
  });

  handleRoundWin(room, winner, true);
}

function handleRoundWin(room, winner, isLock) {
  clearTimeout(room.botTimeout);
  clearTimeout(room.serverGuardTimeout);
  room.starterSeat = winner.seat;
  let totalScoreGained = 0;

  const opponentTeam = (winner.team === 'teamA') ? 'teamB' : 'teamA';
  room.players.forEach(p => {
    if (p.team === opponentTeam) {
      totalScoreGained += getHandSum(p.hand);
    }
  });

  room.teamScores[winner.team] += totalScoreGained;
  const isMatchOver = (room.teamScores.teamA >= 101 || room.teamScores.teamB >= 101);
  const winningTeam = room.teamScores.teamA >= 101 ? 'teamA' : (room.teamScores.teamB >= 101 ? 'teamB' : null);

  io.to(room.id).emit('round_finished', {
    winnerName: winner.name,
    winnerSeat: winner.seat,
    gainedPoints: totalScoreGained,
    teamScores: room.teamScores,
    isLock: isLock,
    isMatchOver: isMatchOver,
    winningTeam: winningTeam
  });

  if (isMatchOver) return;

  setTimeout(() => {
    setupRound(room);
  }, 4000);
}

io.on('connection', (socket) => {
  // سیستەمی ئۆنلاینی دامەی کوردی
  socket.on('dama_create_room', () => {
    const roomId = 'DAMA-' + Math.floor(1000 + Math.random() * 9000);
    socket.join(roomId);
    socket.damaRoom = roomId;
    socket.damaSide = 1;
    socket.emit('dama_room_created', { roomId, side: 1 });
  });

  socket.on('dama_join_room', (roomId) => {
    const room = io.sockets.adapter.rooms.get(roomId);
    if (!room) {
      socket.emit('dama_error', 'ئەم ژوورە بوونی نییە! دڵنیابەرەوە لە کۆدەکە.');
      return;
    }
    if (room.size >= 2) {
      socket.emit('dama_error', 'ئەم ژوورە پڕ بووە لە یاریزان!');
      return;
    }
    socket.join(roomId);
    socket.damaRoom = roomId;
    socket.damaSide = -1;
    io.to(roomId).emit('dama_game_start', { roomId });
  });

  socket.on('dama_make_move', (data) => {
    if (data && data.roomId) {
      socket.to(data.roomId).emit('dama_receive_move', data.move);
    }
  });

  // سیستەمی یاریی دۆمینە (ئۆنلاین + چاوەڕوانیی بێسنوور بۆ هاوڕێ + بۆت)
  socket.on('join_game', ({ name, mode, roomType, customCode }) => {
    const selectedMode = (mode === 2) ? 2 : 4;
    const finalPlayerName = (name && name.trim()) ? name.trim() : 'یاریزان';
    const isPrivateRoom = (roomType === 'private');

    let room = null;
    let roomId = '';

    if (isPrivateRoom && customCode) {
      roomId = customCode.trim().toUpperCase();
      room = rooms[roomId];
    } else {
      // گەڕان بە دوای ژوورێکی گشتیی کراوە کە هێشتا چاوەڕێی یاریزانی ئۆنلاینە
      room = Object.values(rooms).find(r => r.isPublic && r.mode === selectedMode && !r.started && r.players.length < r.mode);
      if (room) {
        roomId = room.id;
      } else {
        roomId = 'KURD-' + Math.floor(1000 + Math.random() * 9000);
      }
    }

    if (!room) {
      room = {
        id: roomId,
        isPublic: !isPrivateRoom,
        mode: selectedMode,
        started: false,
        players: [],
        board: [],
        deck: [],
        turnIdx: 0,
        teamScores: { teamA: 0, teamB: 0 },
        starterSeat: null,
        consecutivePasses: 0,
        botTimeout: null,
        serverGuardTimeout: null,
        waitInterval: null,
        secondsLeft: isPrivateRoom ? -1 : 30
      };

      room.players.push({
        id: socket.id,
        name: finalPlayerName,
        seat: 0,
        team: 'teamA',
        isBot: false,
        hand: []
      });

      rooms[roomId] = room;
      socket.roomId = roomId;
      socket.join(roomId);

      io.to(roomId).emit('waiting_players', {
        roomId: room.id,
        secondsLeft: room.secondsLeft,
        currentCount: room.players.length,
        maxPlayers: room.mode,
        isPrivate: isPrivateRoom
      });

      // تەنها بۆ ژووری گشتی دوای ٣٠ چرکە ڕۆبۆت دادەنێت؛ ژووری تایبەت چاوەڕێی هاوڕێکانت دەکات
      if (!isPrivateRoom) {
        room.waitInterval = setInterval(() => {
          if (room.started) {
            clearInterval(room.waitInterval);
            return;
          }
          room.secondsLeft--;
          if (room.secondsLeft <= 0) {
            fillRoomWithBotsAndStart(room);
          } else {
            io.to(room.id).emit('waiting_players', {
              roomId: room.id,
              secondsLeft: room.secondsLeft,
              currentCount: room.players.length,
              maxPlayers: room.mode,
              isPrivate: false
            });
          }
        }, 1000);
      }
    } else if (!room.started && room.players.length < room.mode) {
      const nextSeat = room.players.length;
      const team = (nextSeat % 2 === 0) ? 'teamA' : 'teamB';
      room.players.push({
        id: socket.id,
        name: finalPlayerName,
        seat: nextSeat,
        team: team,
        isBot: false,
        hand: []
      });
      socket.roomId = roomId;
      socket.join(roomId);

      if (room.players.length === room.mode) {
        clearInterval(room.waitInterval);
        room.started = true;
        setupRound(room);
      } else {
        io.to(roomId).emit('waiting_players', {
          roomId: room.id,
          secondsLeft: room.secondsLeft,
          currentCount: room.players.length,
          maxPlayers: room.mode,
          isPrivate: !room.isPublic
        });
      }
    }
  });

  // ئەگەر یاریزانەکە دوگمەی (یەکسەر دەستپێبکە لەگەڵ ڕۆبۆت)ی داگرت
  socket.on('force_fill_bots', () => {
    const room = rooms[socket.roomId];
    if (room && !room.started) {
      fillRoomWithBotsAndStart(room);
    }
  });

  socket.on('voice_joined', () => {
    socket.to(socket.roomId).emit('voice_user_joined', { socketId: socket.id });
  });

  socket.on('voice_signal', ({ to, sdp, candidate }) => {
    io.to(to).emit('voice_signal', { from: socket.id, sdp, candidate });
  });

  socket.on('submit_move', ({ boardChain, remainingHand, playedSeat, tile }) => {
    const room = rooms[socket.roomId];
    if (!room) return;

    let player = room.players.find(p => p.id === socket.id);
    if (!player) player = room.players[room.turnIdx];
    if (room.players[room.turnIdx] && room.players[room.turnIdx].id !== player.id) return;

    room.consecutivePasses = 0;
    room.requiredFirstTile = null;

    if (boardChain && Array.isArray(boardChain)) {
      room.board = boardChain.map(t => {
        const leftVal = Number(t.left !== undefined ? t.left : (t.a !== undefined ? t.a : t[0]));
        const rightVal = Number(t.right !== undefined ? t.right : (t.b !== undefined ? t.b : t[1]));
        return { left: leftVal, right: rightVal, a: leftVal, b: rightVal };
      });
    }

    if (remainingHand && Array.isArray(remainingHand)) {
      player.hand = remainingHand;
    }

    if (player.hand && player.hand.length === 0) {
      handleRoundWin(room, player, false);
      return;
    }

    advanceTurn(room, player.seat);
  });

  socket.on('player_pass', () => {
    const room = rooms[socket.roomId];
    if (!room) return;
    if (room.mode === 2 && room.deck && room.deck.length > 0) {
      return;
    }
    const player = room.players.find(p => p.id === socket.id);
    if (!player || room.players[room.turnIdx]?.id !== player.id) return;
    handlePass(room, player);
  });

  socket.on('request_pull', () => {
    const room = rooms[socket.roomId];
    if (!room) return;

    const currentP = room.players[room.turnIdx];
    if (!currentP || currentP.id !== socket.id) return;

    if (!room.deck || room.deck.length === 0) {
      socket.emit('receive_pulled', { pulled: null, boneyardCount: 0 });
      return;
    }

    const pulled = room.deck.pop();
    currentP.hand.push(pulled);

    // نوێکردنەوەی پاسەوانیی سێرڤەر لە دوای هەر سەحبکردنێک
    startServerTurnGuard(room);

    socket.emit('receive_pulled', { pulled, boneyardCount: room.deck.length });
    io.to(room.id).emit('deck_update', {
      boneyardCount: room.deck.length,
      handCounts: { [currentP.seat]: currentP.hand.length }
    });
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.roomId];
    if (!room || !room.started) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.isBot = true;
      if (room.players[room.turnIdx]?.id === socket.id) {
        clearTimeout(room.serverGuardTimeout);
        room.botTimeout = setTimeout(() => checkIfBotTurn(room), 1000);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 سێرڤەر ئامادەیە لەسەر پۆرتی: ${PORT}`);
});