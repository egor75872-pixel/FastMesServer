/* ========================================================================= */
/* FastMes — сервер (Express + Socket.io)                                    */
/* ========================================================================= */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------------- Push-уведомления (звонки в фоне) ---------------------- */
// Ключи можно (и лучше) вынести в переменные окружения Render (Environment),
// но для учебного проекта можно оставить и так — просто фиксированная пара ключей.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BFiSFHb0bzQj9s1yk5GLAclFPej5YEcPU_RaeIKWJlSRe0ZJSmO9MblpxwwoiM6AHjAhxiGuIQzWix6sMZunIvg';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'AROeYwHZyJyk0l5K6haymNHiNkP7KUV4bwJ-FZBF6vk';

webpush.setVapidDetails('mailto:fastmes@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

app.get('/vapidPublicKey', (req, res) => res.send(VAPID_PUBLIC_KEY));

/* ---------------------- Хранилище данных (простой JSON-файл) ---------------------- */

const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { /* повреждённый файл — начинаем заново */ }
    }
    return { users: {}, idIndex: {}, friendRequests: {}, friendships: {}, messages: {}, pushSubs: {}, pendingCalls: {} };
}

let data = loadData();
if (!data.idIndex) data.idIndex = {}; // на случай старого data.json без индекса
if (!data.pushSubs) data.pushSubs = {};
if (!data.pendingCalls) data.pendingCalls = {};

let saveScheduled = false;
function saveData() {
    if (saveScheduled) return;
    saveScheduled = true;
    setTimeout(() => {
        fs.writeFile(DATA_FILE, JSON.stringify(data), err => { if (err) console.error('Ошибка сохранения:', err); });
        saveScheduled = false;
    }, 200);
}

function pairId(a, b) { return [a, b].sort().join('_'); }

function sendCallPush(toLogin, fromName, callType) {
    const sub = data.pushSubs[toLogin];
    if (!sub) return;
    const payload = JSON.stringify({
        title: `📞 Звонит ${fromName}`,
        body: callType === 'video' ? 'Видеозвонок...' : 'Голосовой звонок...',
        callType, fromId: null // заполняется на месте вызова
    });
    webpush.sendNotification(sub, payload).catch(err => {
        // Подписка протухла/невалидна — удаляем, чтобы не пытаться снова
        if (err.statusCode === 404 || err.statusCode === 410) {
            delete data.pushSubs[toLogin];
            saveData();
        } else {
            console.error('Ошибка push-уведомления:', err.message);
        }
    });
}

// profile строится по ЛОГИНУ (внутренний ключ), но содержит публичный числовой id
function publicProfile(login) {
    const u = data.users[login];
    if (!u) return null;
    return { login: u.login, id: u.id, name: u.name, online: u.ghost ? false : !!u.online, lastSeen: u.lastSeen, ghost: !!u.ghost };
}

function broadcastPresence(login) {
    Object.values(data.friendships)
        .filter(f => f.members.includes(login))
        .forEach(f => {
            const otherLogin = f.members.find(m => m !== login);
            io.to(otherLogin).emit('presenceUpdate', publicProfile(login));
        });
}

/* ---------------------- Socket.io ---------------------- */

function generateUniqueId() {
    let id;
    do {
        // 99.99% шанс — обычное 7-значное число
        // 0.01% шанс — красивое число (все одинаковые цифры: 1111111, 2222222, и т.д.)
        if (Math.random() < 0.0001) {
            const digit = Math.floor(Math.random() * 9) + 1; // 1-9
            id = String(digit).repeat(7); // 1111111, 2222222, ..., 9999999
        } else {
            id = String(Math.floor(1000000 + Math.random() * 9000000)); // 1000000-9999999
        }
    } while (data.idIndex[id]);
    return id;
}

io.on('connection', (socket) => {
    let myLogin = null;

    socket.on('register', ({ name, login, password, hint }, cb) => {
        name = (name || '').trim();
        login = (login || '').trim().toLowerCase();
        hint = (hint || '').trim();

        if (!name || !login || !password || !hint) return cb({ success: false, message: 'Заполните все поля!' });
        if (data.users[login]) return cb({ success: false, message: 'Этот логин уже занят!' });
        if (password.length < 6 || password.length > 30) return cb({ success: false, message: 'Длина пароля от 6 до 30 символов!' });
        if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return cb({ success: false, message: 'Нужна хотя бы 1 буква англ. и 1 цифра!' });

        const id = generateUniqueId();
        data.users[login] = { login, id, name, password, hint: hint.toLowerCase(), ghost: false, online: false, lastSeen: Date.now() };
        data.idIndex[id] = login;
        saveData();
        cb({ success: true, id });
    });

    socket.on('login', ({ login, password }, cb) => {
        login = (login || '').trim().toLowerCase();
        const user = data.users[login];
        if (!user || user.password !== password) return cb({ success: false, message: 'Неверный логин или пароль!' });

        myLogin = user.login;
        socket.join(myLogin);
        user.online = true;
        user.lastSeen = Date.now();
        saveData();
        broadcastPresence(myLogin);

        cb({ success: true, name: user.name, ghost: user.ghost, id: user.id });
    });

    socket.on('recoverPassword', ({ login, hint }, cb) => {
        login = (login || '').trim().toLowerCase();
        const user = data.users[login];
        if (!user) return cb({ success: false, message: 'Логин не найден!' });
        if (user.hint !== (hint || '').trim().toLowerCase()) return cb({ success: false, message: 'Неверное слово-подсказка!' });
        cb({ success: true, password: user.password });
    });

    socket.on('setGhostMode', (ghost) => {
        if (!myLogin) return;
        data.users[myLogin].ghost = !!ghost;
        saveData();
        broadcastPresence(myLogin);
    });

    // Поиск — по числовому ID
    socket.on('searchUser', (query, cb) => {
        const login = data.idIndex[(query || '').trim()];
        const user = login ? data.users[login] : null;
        if (!user) return cb({ found: false });
        cb({ found: true, login: user.login, id: user.id, name: user.name });
    });

    socket.on('sendFriendRequest', (toLogin) => {
        if (!myLogin || !data.users[toLogin] || toLogin === myLogin) return;
        const reqId = pairId(myLogin, toLogin);
        if (data.friendships[reqId]) return; // уже друзья
        data.friendRequests[reqId] = {
            fromLogin: myLogin, fromName: data.users[myLogin].name,
            toLogin, toName: data.users[toLogin].name, status: 'pending'
        };
        saveData();
        io.to(toLogin).emit('requestsUpdated');
    });

    socket.on('getRequests', (cb) => {
        if (!myLogin) return cb([]);
        const list = Object.entries(data.friendRequests)
            .filter(([, r]) => r.toLogin === myLogin && r.status === 'pending')
            .map(([reqId, r]) => ({ requestId: reqId, ...r }));
        cb(list);
    });

    socket.on('respondRequest', ({ requestId, accepted }) => {
        const req = data.friendRequests[requestId];
        if (!req || req.toLogin !== myLogin) return;

        if (accepted) {
            data.friendships[pairId(req.fromLogin, req.toLogin)] = { members: [req.fromLogin, req.toLogin] };
            req.status = 'accepted';
            io.to(req.fromLogin).emit('friendsUpdated');
            io.to(req.toLogin).emit('friendsUpdated');
        } else {
            req.status = 'declined';
        }
        saveData();
        io.to(myLogin).emit('requestsUpdated');
    });

    socket.on('getFriends', (cb) => {
        if (!myLogin) return cb([]);
        const friendLogins = Object.values(data.friendships)
            .filter(f => f.members.includes(myLogin))
            .map(f => f.members.find(m => m !== myLogin));
        cb(friendLogins.map(publicProfile).filter(Boolean));
    });

    socket.on('getProfile', (login, cb) => cb(publicProfile(login)));

    socket.on('getMessages', (friendLogin, cb) => {
        if (!myLogin) return cb([]);
        const chatId = pairId(myLogin, friendLogin);
        const msgs = data.messages[chatId] || [];
        let changed = false;

        msgs.forEach(m => {
            if (m.senderId !== myLogin) {
                if (m.status === 'sent') { m.status = 'delivered'; changed = true; }
                if (m.status !== 'read' && !data.users[myLogin].ghost) { m.status = 'read'; changed = true; }
            }
        });

        if (changed) {
            saveData();
            io.to(friendLogin).emit('messagesStatusUpdated', chatId);
        }
        cb(msgs);
    });

    socket.on('sendMessage', ({ toId, text }) => {
        if (!myLogin || !text || !text.trim() || !data.users[toId]) return;
        const chatId = pairId(myLogin, toId);
        if (!data.messages[chatId]) data.messages[chatId] = [];

        const msg = {
            id: Date.now() + '_' + Math.random().toString(36).slice(2),
            senderId: myLogin, text: text.trim(), status: 'sent', timestamp: Date.now()
        };
        data.messages[chatId].push(msg);
        saveData();

        io.to(toId).emit('newMessage', { chatId, msg });
        io.to(myLogin).emit('newMessage', { chatId, msg });
    });

    /* ---------------------- Звонки: сигнализация WebRTC ---------------------- */

    socket.on('callUser', ({ toId, offer, callType }) => {
        if (!myLogin) return;
        io.to(toId).emit('incomingCall', { fromId: myLogin, fromName: data.users[myLogin].name, offer, callType });
    });

    socket.on('answerCall', ({ toId, answer }) => {
        io.to(toId).emit('callAnswered', { answer });
    });

    socket.on('iceCandidate', ({ toId, candidate }) => {
        io.to(toId).emit('iceCandidate', { candidate });
    });

    socket.on('rejectCall', ({ toId }) => {
        io.to(toId).emit('callRejected');
    });

    socket.on('endCall', ({ toId }) => {
        io.to(toId).emit('callEnded');
    });

    /* ---------------------- Отключение ---------------------- */

    socket.on('disconnect', () => {
        if (myLogin && data.users[myLogin]) {
            data.users[myLogin].online = false;
            data.users[myLogin].lastSeen = Date.now();
            saveData();
            broadcastPresence(myLogin);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('FastMes сервер запущен на порту ' + PORT));
