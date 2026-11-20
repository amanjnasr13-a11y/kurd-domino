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
// --- بەشی شیکارکردنی پرسیاری قوتابیان (AI) ---
// ==========================================
async function callOpenRouter(apiKey, model, messages) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://kurd-domino-production.up.railway.app',
      'X-Title': 'Kurd AI Student Helper',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      temperature: 0.3,
      max_tokens: 2048
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenRouter HTTP ${response.status}`);
  }
  const answer = data.choices?.[0]?.message?.content;
  if (!answer) {
    throw new Error('وەڵامەکە بە بەتاڵی گەڕایەوە.');
  }
  return answer;
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

// بەشی چاتکردنی گشتی بە هەرسێ زمان (کوردی، عەرەبی، ئینگلیزی) + شیکردنەوەی وێنە
app.post('/api/chat', async (req, res) => {
  try {
    const { history, imageBase64, lang } = req.body;
    if ((!history || history.length === 0) && !imageBase64) {
      return res.status(400).json({ error: 'تکایە پرسیارەکەت بنووسە یان وێنەیەک دابنێ.' });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'کلیلی OPENROUTER_API_KEY لە سێرڤەر دانەنراوە!' });
    }

    const langInstruction = `بەکارهێنەر دەتوانێت بە هەرسێ زمانی کوردی، عەرەبی، یان ئینگلیزی پرسیار بکات.
یاسای زێڕین: هەمیشە سەیری زمانی دوایین پرسیاری بەکارهێنەر بکە:
- ئەگەر بە عەرەبی نووسی (وەک "مرحبا" یان "اريد اسال شي")، ئەوا تەواوی وەڵامەکە تەنها بە عەرەبی بنووسە و هیچ وشەیەکی کوردی تێکەڵ مەکە.
- ئەگەر بە ئینگلیزی نووسی، ئەوا تەواوی وەڵامەکە تەنها بە ئینگلیزی بنووسە.
- ئەگەر بە کوردی نووسی (یان تەنها وێنەی نارد بەبێ نووسین کاتێک زمانی چاتەکە کوردییە)، بە کوردیی سۆرانیی پاراو وەڵام بدەرەوە. (زمانی هەڵبژێردراوی چاتەکە ئێستا: ${lang || 'ku'}).`;

    const systemMsg = {
      role: 'system',
      content: `تۆ (Kurd AI - کورد ئەی ئای)ـیت، زیرەکترین یاریدەدەری دیجیتاڵی هاوشێوەی Google Gemini و ChatGPT.
تۆ شارەزاییت لە هەموو بوارێکدا هەیە (زانست، تەکنەلۆژیا، مێژوو، تەندروستی، ئابووری، وەرگێڕان، و شیکردنەوەی وێنە).
${langInstruction}
یاساکانی وەڵامدانەوە:
1. ئەگەر بەکارهێنەر وێنەیەکی نارد، بە وردی هەموو شتێکی ناو وێنەکەی بۆ باس بکە و زانیاریی تەواوی لەسەر بدە.
2. وەڵامەکانت بە شێوەی خاڵبەندی و ڕێکخراو بنووسە تا خوێندنەوەیان لەسەر مۆبایل زۆر ئاسان بێت.
3. هێما تێکەڵەکانی LaTeX وەک ($ یان $$) بەکارمەهێنە تا نووسینەکە تێکنەچێت.`
    };

    const recentHistory = (history || []).slice(-10);
    const messages = [systemMsg, ...recentHistory];

    if (imageBase64) {
      const lastMsg = messages[messages.length - 1];
      const defaultImagePrompt = lang === 'ar'
        ? 'اشرح لي كل شيء في هذه الصورة بالتفصيل.'
        : lang === 'en'
        ? 'Explain everything in this image in detail.'
        : 'ئەم وێنەیەم بە وردی بۆ باس بکە و هەموو زانیارییەکی گرنگی تێدا ڕوون بکەرەوە.';

      const userPrompt = (lastMsg && lastMsg.role === 'user' && lastMsg.content)
        ? lastMsg.content
        : defaultImagePrompt;

      const contentParts = [
        { type: 'text', text: userPrompt },
        { type: 'image_url', image_url: { url: imageBase64 } }
      ];

      if (lastMsg && lastMsg.role === 'user') {
        lastMsg.content = contentParts;
      } else {
        messages.push({ role: 'user', content: contentParts });
      }
    }

    const models = [
      'google/gemini-2.5-flash',
      'google/gemini-2.0-flash-001'
    ];

    let lastError = null;
    for (const model of models) {
      try {
        const answer = await callOpenRouter(apiKey, model, messages);
        return res.json({ answer });
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('وەڵام نەهاتەوە');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/solve-question', async (req, res) => {
  try {
    const { questionText, imageBase64, subject } = req.body;

    if (!questionText && !imageBase64) {
      return res.status(400).json({ error: 'تکایە پرسیار یان وێنە بنێرە.' });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'کلیلی OPENROUTER_API_KEY لە Railway دانەنراوە!' });
    }

    const userContent = [];
    if (questionText && imageBase64) {
      userContent.push({
        type: 'text',
        text: `بابەت: ${subject || 'گشتی'}\nتێبینی قوتابی: ${questionText}\nتکایە وێنەکە بخوێنەرەوە و بە پێی تێبینی قوتابییەکە بە زمانی کوردی (سۆرانی) هەنگاو بە هەنگاو شیکاری بکە.`
      });
    } else if (questionText) {
      userContent.push({
        type: 'text',
        text: `بابەت: ${subject || 'گشتی'}\nپرسیار: ${questionText}\nتکایە بە زمانی کوردی (سۆرانی) و بە هەنگاوی ڕوون و زانستی وەڵام بدەرەوە.`
      });
    } else {
      userContent.push({
        type: 'text',
        text: `بابەت: ${subject || 'گشتی'}\nتکایە نووسین یان هاوکێشەی ناو ئەم وێنەیە بە وردی بخوێنەرەوە و بە زمانی کوردی (سۆرانی) هەنگاو بە هەنگاو شیکاری بکە.`
      });
    }

    if (imageBase64) {
      userContent.push({
        type: 'image_url',
        image_url: { url: imageBase64 }
      });
    }

    const messages = [
      {
        role: 'system',
        content: `تۆ مامۆستایەکی زیرەکی پسپۆڕیت لە هەرێمی کوردستان کە بە تەواوی شارەزای هەرسێ زمانی (کوردی، عەرەبی، و ئینگلیزی)ـیت لە بیرکاری، فیزیا، کیمیا، و هەموو وانەکاندا.

یاسا زۆر گرنگەکان بۆ شیکارکردنی وێنە و نووسین:
١. ناسینەوەی هەرسێ زمانەکە بە وردی:
   - ئەگەر هاوکێشەکە بە کوردی یان عەرەبی نووسرابوو (بە پیتەکانی: س، ص، ع، یان ژمارە عەرەبی/هیندییەکانی: ٠، ١، ٢، ٣، ٤، ٥، ٦، ٧، ٨، ٩)، بۆ نموونە: (٧ = ٥ + س٢) یان (٢س + ٥ = ٧)، بە تەواوی وەک هاوکێشەی بیرکاری بیخوێنەرەوە و شیکاری بکە (هەرگیز وەک پیتی یۆنانی یان ئۆمێگا مەیخوێنەرەوە).
   - ئەگەر هاوکێشەکە بە ئینگلیزی نووسرابوو (بە پیتەکانی: x, y, z, a, b و ژمارە ئینگلیزییەکانی: 0, 1, 2, 3...)، بۆ نموونە: (2x + 5 = 7)، بە ڕێبازی ئینگلیزی شیکاری بکە.
   - ئەگەر پرسیارەکە وانەی زمانەوانی (کوردی، عەرەبی، یان ئینگلیزی) بوو، بە پێی یاساکانی ئەو زمانە وەڵامی بدەرەوە.

٢. شێوازی نووسینی وەڵام:
   - هەموو ڕوونکردنەوە و هەنگاوەکان بە زمانی کوردیی سۆرانییەکی پاراو و سادە بنووسە تا قوتابی بە ئاسانی لێی تێبگات.
   - بە هیچ شێوەیەک هێما تێکەڵەکانی LaTeX وەک ($ یان $$ یان \\omega یان \\times یان \\frac) بەکارمەهێنە؛ لە جیاتی ئەوانە نیشانەی ئاسایی وەک (× ، ÷ ، + ، - ، =) بنووسە تا لە شاشەی مۆبایل بە جوانی و بێ تێکچوون دەربکەوێت.`
      },
      { role: 'user', content: userContent }
    ];

    // مۆدێلی سەرەکی و مۆدێلی یەدەگ بۆ دڵنیابوون لەوەی هەرگیز نەوەستێت
    const models = [
      'google/gemini-2.5-flash',
      'google/gemini-2.0-flash-001'
    ];

    let lastError = null;
    for (const model of models) {
      try {
        console.log(`🤖 ناردنی پرسیار بۆ مۆدێلی: ${model}`);
        const answer = await callOpenRouter(apiKey, model, messages);
        return res.json({ answer });
      } catch (err) {
        console.error(`❌ هەڵە لە مۆدێلی ${model}:`, err.message);
        lastError = err;
      }
    }

    res.status(500).json({ error: lastError ? lastError.message : 'هەڵە لە پەیوەندی بە AI ڕوویدا' });
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

// ١. وەرگرتنی تەنها ئەو کاڵایانەی لەلایەن ئەدمینەوە پەسەند کراون (بۆ خەڵک)
app.get('/api/marketplace/items', (req, res) => {
  const items = getMarketItems();
  const approvedItems = items.filter(item => item.status === 'approved');
  res.json(approvedItems);
});

// ٢. پۆستکردنی کاڵای نوێ لەلایەن خەڵکەوە (خۆکارانە دەبێتە pending)
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

// ٣. وەرگرتنی هەموو کاڵاکان بۆ تابلۆی ئەدمین
app.get('/api/admin/marketplace/items', (req, res) => {
  const items = getMarketItems();
  res.json(items);
});

// ٤. قبووڵکردنی کاڵا لەلایەن ئەدمینەوە
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

// ٥. ڕەتکردنەوە یان سڕینەوەی کاڵا لەلایەن ئەدمینەوە
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

function setupRound(room) {
  const fullDeck = generateFullDeck();
  room.board = [];
  room.deck = [];
  room.consecutivePasses = 0;
  clearTimeout(room.botTimeout);

  room.players.forEach((p, idx) => {
    p.hand = fullDeck.slice(idx * 7, (idx + 1) * 7);
  });

  if (room.mode === 2) {
    room.deck = fullDeck.slice(room.players.length * 7);
  } else {
    room.deck = [];
  }

  const isFirstEverRound = (room.starterSeat === null || room.starterSeat === undefined);

  if (!isFirstEverRound) {
    room.turnIdx = room.players.findIndex(p => p.seat === room.starterSeat);
    if (room.turnIdx === -1) room.turnIdx = 0;
  } else {
    let foundIdx = 0;
    room.players.forEach((p, pIdx) => {
      const hasDoubleSix = p.hand.some(t => {
        const a = Number(t.a !== undefined ? t.a : (t.left !== undefined ? t.left : t[0]));
        const b = Number(t.b !== undefined ? t.b : (t.right !== undefined ? t.right : t[1]));
        return (a === 6 && b === 6);
      });
      if (hasDoubleSix) foundIdx = pIdx;
    });
    room.turnIdx = foundIdx;
  }

  const currentP = room.players[room.turnIdx];

  const handCounts = {};
  room.players.forEach(p => {
    handCounts[p.seat] = p.hand.length;
  });

  console.log(`\n🎲 گەڕی نوێ دەستیپێکرد | دەستپێکەر: [${currentP.name}]`);

  room.players.forEach(p => {
    if (!p.isBot) {
      io.to(p.id).emit('game_live', {
        roomId: room.id,
        mySeat: p.seat,
        myHand: p.hand,
        turnSeat: currentP.seat,
        turnSocketId: currentP.id,
        turnName: currentP.name,
        boneyardCount: room.deck.length,
        handCounts: handCounts,
        board: room.board,
        teamScores: room.teamScores,
        mode: room.mode,
        isFirstEverRound: isFirstEverRound
      });
    }
  });

  if (currentP.isBot) {
    room.botTimeout = setTimeout(() => checkIfBotTurn(room), 1500);
  }
}

function advanceTurn(room, playedSeat = null) {
  if (!room || !room.players || room.players.length === 0) return;
  clearTimeout(room.botTimeout);

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
      const isFirstEverRound = (room.starterSeat === null || room.starterSeat === undefined);
      let targetIdx = 0;
      if (isFirstEverRound) {
        let d6Idx = currentP.hand.findIndex(t => {
          const a = Number(t.a !== undefined ? t.a : (t.left !== undefined ? t.left : t[0]));
          const b = Number(t.b !== undefined ? t.b : (t.right !== undefined ? t.right : t[1]));
          return a === 6 && b === 6;
        });
        if (d6Idx !== -1) targetIdx = d6Idx;
      }

      const t = currentP.hand[targetIdx];
      const a = Number(t.a !== undefined ? t.a : (t.left !== undefined ? t.left : t[0]));
      const b = Number(t.b !== undefined ? t.b : (t.right !== undefined ? t.right : t[1]));
      playableMove = { index: targetIdx, tile: t, end: 'right', placeLeft: a, placeRight: b };
    }

    if (playableMove) {
      currentP.hand.splice(playableMove.index, 1);
      room.consecutivePasses = 0;

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

      console.log(`🤖 بۆت [${currentP.name}] بەردی دانا: [${newTileObj.left}|${newTileObj.right}]`);

      if (currentP.hand.length === 0) {
        handleRoundWin(room, currentP, false);
        return;
      }

      advanceTurn(room, currentP.seat);
    } else {
      if (room.mode === 2 && room.deck && room.deck.length > 0) {
        const pulled = room.deck.pop();
        currentP.hand.push(pulled);
        room.botTimeout = setTimeout(() => checkIfBotTurn(room), 1000);
        return;
      }

      console.log(`🤖 بۆت [${currentP.name}] پاسی لێدا (نییە)`);
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
  // ==========================================
  // سیستەمی ئۆنلاینی دامەی کوردی (ژوور و جووڵەکان)
  // ==========================================
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

  socket.on('join_game', ({ name, mode, roomType, customCode }) => {
    const selectedMode = (mode === 2) ? 2 : 4;
    const finalPlayerName = (name && name.trim()) ? name.trim() : 'یاریزان';

    let roomId = (roomType === 'private' && customCode) 
      ? ('priv_' + customCode) 
      : ('pub_' + selectedMode + '_' + Math.random().toString(36).substring(2, 7).toUpperCase());

    let room = rooms[roomId];

    if (!room) {
      room = {
        id: roomId,
        mode: selectedMode,
        players: [],
        board: [],
        deck: [],
        turnIdx: 0,
        teamScores: { teamA: 0, teamB: 0 },
        starterSeat: null,
        consecutivePasses: 0,
        botTimeout: null
      };

      room.players.push({
        id: socket.id,
        name: finalPlayerName,
        seat: 0,
        team: 'teamA',
        isBot: false,
        hand: []
      });

      if (roomType === 'public') {
        if (selectedMode === 4) {
          room.players.push({ id: 'bot_1', name: 'وەستا حەمە', seat: 1, team: 'teamB', isBot: true, hand: [] });
          room.players.push({ id: 'bot_2', name: 'وەستا سەردار (شەریک)', seat: 2, team: 'teamA', isBot: true, hand: [] });
          room.players.push({ id: 'bot_3', name: 'وەستا ڕێبوار', seat: 3, team: 'teamB', isBot: true, hand: [] });
        } else {
          room.players.push({ id: 'bot_1', name: 'وەستا حەمە', seat: 1, team: 'teamB', isBot: true, hand: [] });
        }
      }

      rooms[roomId] = room;
      socket.roomId = roomId;
      socket.join(roomId);

      setupRound(room);
    } else {
      const nextSeat = room.players.length;
      if (nextSeat < room.mode) {
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
          setupRound(room);
        }
      }
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

    room.consecutivePasses = 0;

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

    console.log(`👤 [${player.name}] بەردی دانا: [${tile ? (tile.a ?? tile[0]) : ''}|${tile ? (tile.b ?? tile[1]) : ''}]`);

    if (player.hand && player.hand.length === 0) {
      handleRoundWin(room, player, false);
      return;
    }

    advanceTurn(room, player.seat);
  });

  socket.on('player_pass', () => {
    const room = rooms[socket.roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    handlePass(room, player);
  });

  socket.on('request_pull', () => {
    const room = rooms[socket.roomId];
    if (!room || !room.deck || room.deck.length === 0) return;

    const currentP = room.players[room.turnIdx];
    if (currentP.id !== socket.id) return;

    const pulled = room.deck.pop();
    currentP.hand.push(pulled);

    socket.emit('receive_pulled', { pulled, boneyardCount: room.deck.length });
    io.to(room.id).emit('deck_update', {
      boneyardCount: room.deck.length,
      handCounts: { [currentP.seat]: currentP.hand.length }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 سێرڤەر ئامادەیە لەسەر پۆرتی: ${PORT}`);
});