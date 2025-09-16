const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const userScores = {}; // Track scores per room
const roomDataMap = {}; // stores all questions, answers, scores per room

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Set();
const roomUsers = {}; // socket IDs per room
const userAnswers = {}; // answers given per room per question
let currentQuestionIndexMap = {}; // track question index per room

const questionsByCategory = {
  "Computer Science": [
  {
    question: "What does CPU stand for?",
    options: ["Central Processing Unit", "Computer Processing Unit", "Central Performance Unit", "Control Program Unit"],
    answer: "Central Processing Unit",
  },
  {
    question: "What is RAM used for?",
    options: ["Long-term storage", "Display", "Short-term memory", "Power supply"],
    answer: "Short-term memory",
  },
  
 
],
"General Knowledge": [
    {
      question: "What is the capital of India?",
      options: ["Mumbai", "Delhi", "Chennai", "Kolkata"],
      answer: "Delhi",
    },
    {
      question: "Who is the current Prime Minister of India?",
      options: ["Rahul Gandhi", "Narendra Modi", "Amit Shah", "Manmohan Singh"],
      answer: "Narendra Modi",
    },
   
    
],
"DSA": [
  {
    question: "Which data structure works on the principle of FIFO?",
    options: ["Stack", "Queue", "Tree", "Graph"],
    answer: "Queue",
  },
  {
    question: "Which data structure works on the principle of LIFO?",
    options: ["Stack", "Queue", "Heap", "Graph"],
    answer: "Stack",
  },
  
],"Output Prediction": [
  {
    question: "What will be the output of: console.log(2 + '2');",
    options: ["22", "4", "Error", "undefined"],
    answer: "22",
  },
  {
    question: "What will be the output of: console.log(typeof null);",
    options: ["null", "object", "undefined", "string"],
    answer: "object",
  },
  
],
"Syntactical Error": [
  {
    question: "Find the syntax error: console.log('Hello World)",
    options: ["Missing semicolon", "Missing closing quote", "Incorrect function name", "Extra bracket"],
    answer: "Missing closing quote",
  },
  {
    question: "Find the syntax error: if(x = 5) { console.log(x); }",
    options: ["Use of '=' instead of '==' or '==='", "Missing parenthesis", "Extra semicolon", "Invalid variable name"],
    answer: "Use of '=' instead of '==' or '==='",
  },
  
],
"Basic Programming": [
  {
    question: "Which symbol is used to end a statement in C, C++, and Java?",
    options: [";", ":", ".", ","],
    answer: ";",
  },
  {
    question: "Which keyword is used to define a function in Python?",
    options: ["function", "def", "fun", "define"],
    answer: "def",
  },
  
],



};

// API: Create a room
app.post('/api/create-room', (req, res) => {
  let roomCode;
  let attempts = 0;
  do {
    roomCode = Math.random().toString(36).substr(2, 6).toUpperCase();
    attempts++;
  } while (rooms.has(roomCode) && attempts < 5);

  if (rooms.has(roomCode)) {
    return res.status(500).json({ error: 'Room code collision. Try again.' });
  }

  rooms.add(roomCode);
  console.log('✅ Room created:', roomCode);
  res.json({ roomCode });
});

io.on('connection', (socket) => {
  console.log('⚡ User connected:', socket.id);

  // Legacy join-room
  socket.on('join-room', (roomCode) => {
    socket.join(roomCode);
    if (!roomUsers[roomCode]) {
      roomUsers[roomCode] = [];
    }
    if (!roomUsers[roomCode].includes(socket.id)) {
      roomUsers[roomCode].push(socket.id);
    }
    socket.to(roomCode).emit('user-joined', socket.id);

    if (roomUsers[roomCode].length === 2) {
      io.to(roomCode).emit('room-ready');
    }
  });

  // Join with username
  socket.on("joinRoom", ({ room, username }) => {
    socket.join(room);
    socket.username = username;

    if (!roomUsers[room]) {
      roomUsers[room] = [];
    }
    if (!roomUsers[room].includes(socket.id)) {
      roomUsers[room].push(socket.id);
    }

    socket.to(room).emit("userJoined", { joinedUsername: username });

    const clients = Array.from(io.sockets.adapter.rooms.get(room) || []);
    const usernames = clients.map((id) => {
      return io.sockets.sockets.get(id)?.username || "User";
    });

    io.to(room).emit("roomUsers", usernames);
  });

  // Start game
  socket.on("start-game", ({ roomCode, category }) => {
    const categoryName = category?.name || category;
    const questions = questionsByCategory[categoryName] || [];

    console.log(`🚀 Game starting in room ${roomCode} with category "${categoryName}"`);

    io.to(roomCode).emit("game-started", { roomCode, category: categoryName, questions });

    currentQuestionIndexMap[roomCode] = 0;
    userAnswers[roomCode] = {}; // Reset answers
    roomDataMap[roomCode] = {
      allAnswers: [],
      questions: questions,
      scores: {}
    };

    const totalQuestions = questions.length;

    const sendNextQuestion = () => {
      const currentQuestionIndex = currentQuestionIndexMap[roomCode];
      const question = questions[currentQuestionIndex];
      if (question) {
        userAnswers[roomCode][currentQuestionIndex] = [];

        io.to(roomCode).emit("next-question", {
          questionIndex: currentQuestionIndex,
          question,
          questionNumber: currentQuestionIndex + 1,
          totalQuestions
        });

        // Timer per question
        if (roomUsers[roomCode]?.length > 0) {
          setTimeout(() => {
            currentQuestionIndexMap[roomCode]++;
            if (currentQuestionIndexMap[roomCode] < questions.length) {
              sendNextQuestion();
            } else {
              sendFinalResults(roomCode, categoryName);
            }
          }, 30000);
        }
      } else {
        sendFinalResults(roomCode, categoryName);
      }
    };

    sendNextQuestion();
  });

  // Submit answer
  socket.on("submit-answer", ({ roomCode, questionIndex, username, selectedOption }) => {
    const currentQuestionIndex = currentQuestionIndexMap[roomCode];
    if (questionIndex !== currentQuestionIndex) return;

    const answersArray = userAnswers[roomCode]?.[questionIndex];
    if (!answersArray) return;

    const alreadyAnswered = answersArray.some(ans => ans.username === username);
    if (alreadyAnswered) return;

    // Get correct answer
    const question = roomDataMap[roomCode]?.questions[questionIndex];
    const correctAnswer = question?.answer;

    answersArray.push({ username, selectedOption });

    // Score update
    if (!userScores[roomCode]) userScores[roomCode] = {};
    if (!userScores[roomCode][username]) userScores[roomCode][username] = 0;

    if (selectedOption === correctAnswer) {
      userScores[roomCode][username] += 1;
    }

    
if (roomDataMap[roomCode]) {
  const players = (roomUsers[roomCode] || []).map(
    id => io.sockets.sockets.get(id)?.username || "User"
  );

  const ans1 = answersArray.find(a => a.username === players[0]);
  const ans2 = answersArray.find(a => a.username === players[1]);

  const existing = roomDataMap[roomCode].allAnswers.find(a => a.question === question.question);

  if (existing) {
    // Update existing entry
    existing.user1Answer = ans1 ? ans1.selectedOption : "";
    existing.user2Answer = ans2 ? ans2.selectedOption : "";
  } else {
    // Create new entry
    roomDataMap[roomCode].allAnswers.push({
      question: question.question,
      correctAnswer: question.answer,
      user1Answer: ans1 ? ans1.selectedOption : "",
      user2Answer: ans2 ? ans2.selectedOption : ""
    });
  }
}

    if (answersArray.length === 2) {
      currentQuestionIndexMap[roomCode]++;

      const nextIndex = currentQuestionIndexMap[roomCode];
      const questions = roomDataMap[roomCode]?.questions || [];

      if (nextIndex < questions.length) {
        userAnswers[roomCode][nextIndex] = [];

        io.to(roomCode).emit("next-question", {
          questionIndex: nextIndex,
          question: questions[nextIndex],
          questionNumber: nextIndex + 1,
          totalQuestions: questions.length
        });
      } else {
        sendFinalResults(roomCode);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
    for (const roomCode in roomUsers) {
      const index = roomUsers[roomCode].indexOf(socket.id);
      if (index !== -1) {
        roomUsers[roomCode].splice(index, 1);
        if (roomUsers[roomCode].length === 0) {
          delete roomUsers[roomCode];
          delete userAnswers[roomCode];
          delete currentQuestionIndexMap[roomCode];
        }
        break;
      }
    }
  });
});

// Helper: send final results
function sendFinalResults(roomCode) {
  io.to(roomCode).emit("quiz-ended", {
    scores: userScores[roomCode] || {},
    winner: getWinner(userScores[roomCode] || {}),
    allAnswers: roomDataMap[roomCode]?.allAnswers || [],
    players: (roomUsers[roomCode] || []).map(
      id => io.sockets.sockets.get(id)?.username || "User"
    ),
    questions: roomDataMap[roomCode]?.questions || []
  });

  delete roomDataMap[roomCode];
  delete userAnswers[roomCode];
  delete currentQuestionIndexMap[roomCode];
}

function getWinner(scoreObj) {
  const entries = Object.entries(scoreObj || {});
  if (entries.length < 2) return null;

  const [user1, score1] = entries[0];
  const [user2, score2] = entries[1];

  if (score1 > score2) return user1;
  else if (score2 > score1) return user2;
  else return "Draw";
}

// const PORT = 5000;
// server.listen(PORT, () => {
//   console.log(`🚀 Server running at http://localhost:${PORT}`);
// });
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
