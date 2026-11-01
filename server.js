const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'domino.html'));
});

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