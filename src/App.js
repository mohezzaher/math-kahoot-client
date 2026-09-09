import React, { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import confetti from "canvas-confetti";
import MathText from "./MathText";

const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'https://aquizgame.bonto.run';

const socket = io(SERVER_URL, {
  transports: ['websocket', 'polling']
});
// مكون المحادثة الصوتية (WebRTC + Socket.io)
function VoiceChat({ pin, nickname }) {
  const [isMuted, setIsMuted] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const localStreamRef = useRef(null);
  const peersRef = useRef({}); // لتخزين الاتصالات مع باقي اللاعبين
  const audioElementsRef = useRef({});

  useEffect(() => {
    // 1. استقبال طلبات اتصال الصوت من سيرفر الـ Socket
    socket.on("user_joined_voice", async ({ socketId }) => {
      const peer = createPeer(socketId, socket.id, localStreamRef.current);
      peersRef.current[socketId] = peer;
    });

    socket.on("webrtc_offer", async ({ offer, from }) => {
      const peer = addPeer(offer, from, localStreamRef.current);
      peersRef.current[from] = peer;
    });

    socket.on("webrtc_answer", ({ answer, from }) => {
      peersRef.current[from]?.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on("webrtc_ice_candidate", ({ candidate, from }) => {
      peersRef.current[from]?.addIceCandidate(new RTCIceCandidate(candidate));
    });

    socket.on("user_left_voice", ({ socketId }) => {
      if (peersRef.current[socketId]) {
        peersRef.current[socketId].close();
        delete peersRef.current[socketId];
      }
      if (audioElementsRef.current[socketId]) {
        audioElementsRef.current[socketId].remove();
        delete audioElementsRef.current[socketId];
      }
    });

    return () => {
      socket.off("user_joined_voice");
      socket.off("webrtc_offer");
      socket.off("webrtc_answer");
      socket.off("webrtc_ice_candidate");
      socket.off("user_left_voice");
    };
  }, []);

  // تشغيل أو إيقاف المايك
  const toggleVoice = async () => {
    if (!isConnected) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localStreamRef.current = stream;
        setIsConnected(true);
        setIsMuted(false);

        // إعلام الغرفة بالانضمام للصوت
        socket.emit("join_voice", { pin });
      } catch (err) {
        alert("تعذر الوصول إلى الميكروفون. يرجى إعطاء الصلاحية من المتصفح.");
      }
    } else {
      const audioTrack = localStreamRef.current?.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = isMuted;
        setIsMuted(!isMuted);
      }
    }
  };

  // إنشاء اتصال WebRTC جديد (بادئ الاتصال)
  function createPeer(userToSignal, callerID, stream) {
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    if (stream) {
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    }

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("webrtc_ice_candidate", { candidate: event.candidate, to: userToSignal });
      }
    };

    peer.ontrack = (event) => {
      playRemoteStream(userToSignal, event.streams[0]);
    };

    peer.createOffer().then((offer) => {
      peer.setLocalDescription(offer);
      socket.emit("webrtc_offer", { offer, to: userToSignal });
    });

    return peer;
  }

  // قبول اتصال WebRTC من لاعب آخر
  function addPeer(incomingOffer, callerID, stream) {
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    if (stream) {
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    }

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("webrtc_ice_candidate", { candidate: event.candidate, to: callerID });
      }
    };

    peer.ontrack = (event) => {
      playRemoteStream(callerID, event.streams[0]);
    };

    peer.setRemoteDescription(new RTCSessionDescription(incomingOffer));
    peer.createAnswer().then((answer) => {
      peer.setLocalDescription(answer);
      socket.emit("webrtc_answer", { answer, to: callerID });
    });

    return peer;
  }

  // تشغيل صوت اللاعب الآخر
  function playRemoteStream(id, stream) {
    if (!audioElementsRef.current[id]) {
      const audio = new Audio();
      audio.srcObject = stream;
      audio.autoplay = true;
      audioElementsRef.current[id] = audio;
    }
  }

  return (
    <button
      onClick={toggleVoice}
      className={`fixed bottom-16 left-4 z-40 px-3 py-2 rounded-full font-bold text-xs shadow-lg flex items-center gap-1.5 transition ${
        !isConnected
          ? "bg-gray-700 hover:bg-gray-800 text-white"
          : isMuted
          ? "bg-red-600 hover:bg-red-700 text-white"
          : "bg-green-600 hover:bg-green-700 text-white animate-pulse"
      }`}
    >
      {!isConnected ? "🎙️ تشغيل الصوت" : isMuted ? "🔇 المايك مكتوم" : "🎙️ المايك يعمل"}
    </button>
  );
}
// مكون نافذة المحادثة المحدث
function ChatWindow({ pin, nickname }) {
  const [messages, setMessages] = useState([]);
  const [inputMsg, setInputMsg] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    socket.on("receive_message", (data) => {
      setMessages((prev) => [...prev, data]);
    });

    return () => {
      socket.off("receive_message");
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (inputMsg.trim()) {
      socket.emit("send_message", { pin, message: inputMsg.trim() });
      setInputMsg("");
    }
  };

  return (
    <>
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="chat-toggle-btn bg-purple-600 hover:bg-purple-700 text-white px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2 font-bold transition transform hover:scale-105 text-sm"
        >
          💬 الدردشة ({messages.length})
        </button>
      ) : (
        <div className="chat-centered-modal bg-white text-gray-900 rounded-2xl border-2 border-purple-600 overflow-hidden">
          <div className="bg-purple-700 text-white p-3 flex justify-between items-center font-bold text-sm">
            <span>💬 محادثة الغرفة</span>
            <button
              onClick={() => setIsOpen(false)}
              className="text-white hover:text-gray-300 font-bold text-lg px-2"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 p-3 overflow-y-auto space-y-2 bg-gray-50 dir-rtl">
            {messages.length === 0 ? (
              <p className="text-center text-gray-400 text-sm mt-8">
                لا توجد رسائل بعد... كن أول من يتحدث!
              </p>
            ) : (
              messages.map((msg, idx) => {
                const isMe = msg.sender === nickname;
                return (
                  <div
                    key={idx}
                    className={`flex flex-col ${isMe ? "items-start" : "items-end"}`}
                  >
                    <div
                      className={`max-w-[80%] p-2 rounded-xl text-sm ${
                        isMe
                          ? "bg-purple-600 text-white rounded-tr-none"
                          : "bg-gray-200 text-gray-800 rounded-tl-none"
                      }`}
                    >
                      <div className="text-[10px] font-bold opacity-80 mb-0.5">
                        {msg.sender} • {msg.time}
                      </div>
                      <p className="break-words font-medium">{msg.message}</p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          <form
            onSubmit={handleSendMessage}
            className="p-2 bg-gray-100 border-t flex gap-2"
          >
            <input
              type="text"
              placeholder="اكتب رسالة..."
              value={inputMsg}
              onChange={(e) => setInputMsg(e.target.value)}
              className="flex-1 p-2 border rounded-xl text-sm focus:outline-none focus:border-purple-600"
            />
            <button
              type="submit"
              className="bg-purple-600 text-white px-3 py-2 rounded-xl text-sm font-bold hover:bg-purple-700 transition"
            >
              إرسال
            </button>
          </form>
        </div>
      )}
    </>
  );
}

function App() {
  const [gameState, setGameState] = useState("join");
  const [pin, setPin] = useState("");
  const [nickname, setNickname] = useState("");
  const [players, setPlayers] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [questionMeta, setQuestionMeta] = useState({ current: 1, total: 10 });
  const [questionCount, setQuestionCount] = useState(10);
  const [timer, setTimer] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [directInputText, setDirectInputText] = useState("");
  const [answerFeedback, setAnswerFeedback] = useState(null);
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const soundCorrect = useRef(
    new Audio("https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3")
  );
  const soundWrong = useRef(
    new Audio("https://assets.mixkit.co/active_storage/sfx/2018/2018-preview.mp3")
  );
  const soundTick = useRef(
    new Audio("https://assets.mixkit.co/active_storage/sfx/2578/2578-preview.mp3")
  );

  const triggerStarsAnimation = () => {
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 },
      shapes: ["star"],
      colors: ["#FFD700", "#FFA500", "#FF4500", "#00E5FF"],
    });
  };

  useEffect(() => {
    socket.on("join_success", () => {
      setErrorMessage("");
      setGameState("waiting");
    });

    socket.on("error_message", (msg) => setErrorMessage(msg));

    socket.on("update_players", (updatedPlayers) => setPlayers(updatedPlayers));

    socket.on("new_question", ({ question, questionNumber, totalQuestions }) => {
      setCurrentQuestion(question);
      setQuestionMeta({ current: questionNumber, total: totalQuestions });
      setSelectedAnswer(null);
      setDirectInputText("");
      setAnswerFeedback(null);
      setGameState("quiz");
    });

    socket.on("timer_tick", (timeLeft) => {
      setTimer(timeLeft);
      if (timeLeft <= 5 && timeLeft > 0)
        soundTick.current.play().catch(() => {});
    });

    socket.on("answer_result", (result) => {
      setAnswerFeedback(result);
      if (result.isCorrect) {
        soundCorrect.current.play().catch(() => {});
        if (result.streak > 1) triggerStarsAnimation();
      } else {
        soundWrong.current.play().catch(() => {});
      }
    });

    socket.on("show_results", ({ players }) => {
      setPlayers(players);
      setGameState("results");
      triggerStarsAnimation();
    });

    return () => {
      socket.off("join_success");
      socket.off("error_message");
      socket.off("update_players");
      socket.off("new_question");
      socket.off("timer_tick");
      socket.off("answer_result");
      socket.off("show_results");
    };
  }, []);

  const handleJoin = (e) => {
    e.preventDefault();
    if (pin && nickname) {
      setErrorMessage("");
      socket.emit("join_room", { pin, nickname });
    }
  };

  const handleStartGame = () =>
    socket.emit("start_game", { pin, questionCount });

  // دعم إرسال الإجابة بناءً على النوع
  const handleSendAnswerValue = (val) => {
    if (selectedAnswer !== null) return;
    setSelectedAnswer(val);
    socket.emit("send_answer", {
      pin,
      answer: val,
      timeRemaining: timer,
    });
  };

  const handleInvite = () => {
    const inviteText = `انضم معي في لعبة Math Kahoot!\nرمز اللعبة (PIN): ${pin}\nالرابط: ${window.location.origin}`;
    if (navigator.share) {
      navigator.share({
        title: "دعوة Math Kahoot",
        text: inviteText,
        url: window.location.origin,
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(inviteText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getPlayerBadge = (player) => {
    if (player.isCorrect === true) {
      return {
        bg: "bg-green-600 border-2 border-green-300 text-white",
        statusText: `✅ المركز ${player.answerOrder}`,
        pointsText: `+${player.lastAddedPoints} نقطة`,
      };
    }
    if (player.isCorrect === false) {
      return {
        bg: "bg-red-600 border-2 border-red-300 text-white",
        statusText: `❌ المركز ${player.answerOrder}`,
        pointsText: `+0 نقطة`,
      };
    }
    return {
      bg: "bg-purple-950/60 text-purple-300 border border-purple-800",
      statusText: "⏳ يفكر...",
      pointsText: null,
    };
  };

  const timerPercentage = currentQuestion
    ? (timer / (currentQuestion.timeLimit || 15)) * 100
    : 0;

  const qType = currentQuestion?.type || "mcq";

  return (
    <div className="min-h-screen bg-purple-900 text-white flex flex-col items-center justify-center p-4 dir-rtl relative">
      {gameState !== "join" && (
  <>
    <ChatWindow pin={pin} nickname={nickname} />
    <VoiceChat pin={pin} nickname={nickname} />
  </>
)}

      {/* 1. شاشة الانضمام */}
      {gameState === "join" && (
        <div className="bg-white text-gray-800 p-8 rounded-2xl shadow-2xl w-full max-w-md text-center">
          <h1 className="text-4xl font-extrabold text-purple-700 mb-6">
            Math Kahoot!
          </h1>

          {errorMessage && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm font-bold">
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleJoin} className="space-y-4">
            <input
              type="text"
              placeholder="رمز اللعبة (Game PIN)"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="w-full p-3 border-2 border-gray-300 rounded-lg text-center text-xl font-bold focus:outline-none focus:border-purple-600"
            />
            <input
              type="text"
              placeholder="اسمك"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full p-3 border-2 border-gray-300 rounded-lg text-center text-xl font-bold focus:outline-none focus:border-purple-600"
            />
            <button
              type="submit"
              className="w-full bg-purple-600 text-white py-3 rounded-lg font-bold text-lg hover:bg-purple-700 transition"
            >
              دخول اللعبة
            </button>
          </form>
        </div>
      )}

      {/* 2. شاشة الانتظار */}
      {gameState === "waiting" && (
        <div className="bg-purple-800 p-8 rounded-2xl text-center max-w-md w-full shadow-xl">
          <h2 className="text-2xl font-bold mb-2">أهلاً بك {nickname}! 👋</h2>

          <div className="bg-purple-900 p-4 rounded-xl my-4 border border-purple-700 flex flex-col items-center justify-between gap-3">
            <div>
              <span className="text-xs text-purple-300 block">رمز الغرفة (PIN)</span>
              <span className="text-3xl font-black tracking-widest text-yellow-400">
                {pin}
              </span>
            </div>
            <button
              onClick={handleInvite}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg font-bold text-sm transition shadow"
            >
              🔗 {copied ? "تم نسخ بيانات الدعوة!" : "دعوة أصدقاء (نسخ الرابط والـ PIN)"}
            </button>
          </div>

          <div className="my-6 text-right bg-purple-700 p-4 rounded-xl">
            <label className="block text-sm font-bold mb-2 text-purple-200">
              اختر عدد الأسئلة للجولة:
            </label>
            <select
              value={questionCount}
              onChange={(e) => setQuestionCount(Number(e.target.value))}
              className="w-full p-3 bg-white text-gray-900 font-bold rounded-lg text-center text-lg"
            >
              <option value={10}>10 أسئلة</option>
              <option value={20}>20 سؤالاً</option>
              <option value={30}>30 سؤالاً</option>
            </select>
          </div>

          <div className="mb-6">
            <h3 className="font-bold mb-2">
              اللاعبون المتصلون ({players.length}):
            </h3>
            <div className="flex flex-wrap gap-2 justify-center">
              {players.map((p, i) => (
                <span
                  key={i}
                  className="bg-purple-600 px-3 py-1 rounded-full text-sm font-bold shadow animate-pulse"
                >
                  👤 {p.nickname}
                </span>
              ))}
            </div>
          </div>

          <button
            onClick={handleStartGame}
            className="w-full bg-green-500 py-3 rounded-lg font-bold text-lg hover:bg-green-600 shadow-md"
          >
            ابدأ اللعبة للجميع 🚀
          </button>
        </div>
      )}

      {/* 3. شاشة السؤال */}
      {gameState === "quiz" && currentQuestion && (
        <div className="w-full max-w-4xl flex flex-col items-center">
          <div className="w-full bg-purple-950 rounded-full h-4 mb-4 overflow-hidden border border-purple-700">
            <div
              className={`h-full transition-all duration-1000 ease-linear ${timer <= 5 ? "bg-red-500" : "bg-yellow-400"}`}
              style={{ width: `${timerPercentage}%` }}
            />
          </div>

          <div className="w-full flex justify-between items-center mb-4 bg-purple-800 p-4 rounded-xl shadow-md">
            <span className="text-xl font-bold">👤 {nickname}</span>
            <span className="text-lg font-bold bg-purple-700 px-4 py-1 rounded-full">
              سؤال {questionMeta.current} من {questionMeta.total}
            </span>
            <span
              className={`text-2xl font-black px-4 py-1 rounded-full shadow ${timer <= 5 ? "bg-red-600 text-white animate-ping" : "bg-yellow-400 text-gray-900"}`}
            >
              ⏱ {timer}
            </span>
          </div>

          <div className="w-full bg-purple-950/70 p-4 rounded-xl mb-6 border border-purple-700">
            <h3 className="text-sm font-bold text-purple-300 mb-3 text-center">
              حالة ونقاط اللاعبين المباشرة:
            </h3>
            <div className="flex flex-wrap gap-3 justify-center">
              {players.map((p, idx) => {
                const badge = getPlayerBadge(p);
                return (
                  <div
                    key={idx}
                    className={`${badge.bg} px-4 py-2 rounded-xl flex items-center gap-3 shadow-lg transition-all duration-500 transform ${p.answerOrder ? "scale-105" : ""}`}
                  >
                    <div className="flex flex-col text-right">
                      <span className="font-extrabold text-base">
                        👤 {p.nickname}
                      </span>
                      <span className="text-xs font-semibold opacity-90">
                        المجموع: {p.score}
                      </span>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-black/20">
                        {badge.statusText}
                      </span>
                      {badge.pointsText && (
                        <span className="text-xs font-extrabold px-2 py-0.5 rounded-md bg-yellow-400 text-gray-900 animate-bounce">
                          {badge.pointsText}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white text-gray-900 w-full p-8 rounded-2xl text-center shadow-lg mb-6">
            <h2 className="text-3xl font-bold">
              <MathText text={currentQuestion.question} />
            </h2>
          </div>

          {/* نوع الخيارات المتعددة (MCQ) */}
          {qType === "mcq" && currentQuestion.options && (
            <div className="grid grid-cols-2 gap-4 w-full">
              {currentQuestion.options.map((option, index) => {
                const baseColors = [
                  "bg-red-500",
                  "bg-blue-500",
                  "bg-yellow-500",
                  "bg-green-500",
                ];
                let stateStyles = `${baseColors[index % baseColors.length]} hover:opacity-90`;

                if (answerFeedback) {
                  const correctIdx = currentQuestion.correct !== undefined ? currentQuestion.correct : currentQuestion.correctIndex;
                  if (index === correctIdx) {
                    stateStyles = "bg-green-600 ring-4 ring-green-300 scale-105";
                  } else if (index === selectedAnswer) {
                    stateStyles = "bg-red-700 opacity-60";
                  } else {
                    stateStyles = "bg-gray-500 opacity-30";
                  }
                }

                return (
                  <button
                    key={index}
                    disabled={selectedAnswer !== null}
                    onClick={() => handleSendAnswerValue(index)}
                    className={`${stateStyles} text-white p-6 rounded-xl text-2xl font-bold shadow-md transition-all duration-300 flex items-center justify-center gap-2`}
                  >
                    <MathText text={option} />
                  </button>
                );
              })}
            </div>
          )}

          {/* نوع صح أو خطأ (True / False) */}
          {qType === "true_false" && (
            <div className="grid grid-cols-2 gap-6 w-full">
              <button
                disabled={selectedAnswer !== null}
                onClick={() => handleSendAnswerValue("صح")}
                className={`p-8 rounded-2xl text-3xl font-black text-white shadow-xl transition-all ${
                  answerFeedback
                    ? String(answerFeedback.correctAnswer).trim().toLowerCase() === "صح"
                      ? "bg-green-600 ring-4 ring-green-300 scale-105"
                      : "bg-gray-500 opacity-30"
                    : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                👍 صح
              </button>
              <button
                disabled={selectedAnswer !== null}
                onClick={() => handleSendAnswerValue("خطأ")}
                className={`p-8 rounded-2xl text-3xl font-black text-white shadow-xl transition-all ${
                  answerFeedback
                    ? String(answerFeedback.correctAnswer).trim().toLowerCase() === "خطأ"
                      ? "bg-green-600 ring-4 ring-green-300 scale-105"
                      : "bg-gray-500 opacity-30"
                    : "bg-red-600 hover:bg-red-700"
                }`}
              >
                👎 خطأ
              </button>
            </div>
          )}

          {/* نوع الإدخال المباشر (Direct Input) */}
          {qType === "direct_input" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (directInputText.trim()) handleSendAnswerValue(directInputText.trim());
              }}
              className="w-full max-w-lg flex flex-col gap-4"
            >
              <input
                type="text"
                disabled={selectedAnswer !== null}
                placeholder="اكتب إجابتك هنا..."
                value={directInputText}
                onChange={(e) => setDirectInputText(e.target.value)}
                className="w-full p-4 rounded-xl text-center text-2xl font-bold text-gray-900 shadow-inner focus:outline-none focus:ring-4 focus:ring-purple-400"
              />
              <button
                type="submit"
                disabled={selectedAnswer !== null || !directInputText.trim()}
                className="w-full bg-green-500 hover:bg-green-600 disabled:bg-gray-500 text-white font-black text-xl py-4 rounded-xl shadow-lg transition"
              >
                إرسال الإجابة 🚀
              </button>
            </form>
          )}

          {/* عرض نتيجة الإجابة */}
          {answerFeedback && (
            <div className="mt-6 w-full max-w-2xl text-center font-bold text-xl">
              {answerFeedback.isCorrect ? (
                <div className="bg-green-500 text-white p-4 rounded-xl shadow-lg animate-bounce flex flex-col items-center gap-1">
                  <span>
                    ✨ إجابة صحيحة! (+{answerFeedback.addedPoints} نقطة)
                  </span>
                  {answerFeedback.streak > 1 && (
                    <span className="bg-yellow-400 text-gray-900 px-4 py-1.5 rounded-full text-base font-extrabold shadow-md mt-1 animate-pulse">
                      ⭐ مضاعفة النقاط! سلسلة {answerFeedback.streak} إجابات! ⭐
                    </span>
                  )}
                </div>
              ) : (
                <div className="bg-red-600 text-white p-4 rounded-xl shadow-lg flex flex-col gap-1">
                  <span>❌ إجابة خاطئة!</span>
                  <span className="text-sm font-normal text-red-100">
                    الإجابة الصحيحة هي: {String(answerFeedback.correctAnswer)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 4. النتائج النهائية */}
      {gameState === "results" && (
        <div className="bg-white text-gray-900 p-8 rounded-2xl w-full max-w-lg text-center shadow-2xl">
          <h2 className="text-3xl font-extrabold mb-6 text-purple-700">
            🏆 لوحة الصدارة
          </h2>
          <div className="space-y-3">
            {players
              .sort((a, b) => b.score - a.score)
              .map((p, i) => (
                <div
                  key={i}
                  className={`flex justify-between items-center p-4 rounded-xl font-bold ${
                    i === 0
                      ? "bg-yellow-100 border-2 border-yellow-400 text-yellow-900 text-xl"
                      : "bg-purple-50"
                  }`}
                >
                  <span>
                    {i === 0
                      ? "🥇"
                      : i === 1
                        ? "🥈"
                        : i === 2
                          ? "🥉"
                          : `${i + 1}.`}{" "}
                    {p.nickname}
                  </span>
                  <span className="text-purple-600">{p.score} نقطة</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
