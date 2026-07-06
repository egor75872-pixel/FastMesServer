/* ========================================================================= */
/* FastMes — клиент (Socket.io + WebRTC)                                     */
/* ========================================================================= */

const socket = io();

let myId = null;
let myName = null;
let myGhost = false;
let currentChatFriendId = null;
let currentChatMessages = [];

const navBar = document.getElementById('navBar');
const chatMenu = document.getElementById('chatMenu');
const requestsPanel = document.getElementById('requestsPanel');
const settingsPanel = document.getElementById('settingsPanel');
const profilePanel = document.getElementById('profilePanel');

/* ---------------------- Тема ---------------------- */

function toggleThemeMenu(event, menuId) {
    event.stopPropagation();
    const menu = document.getElementById(menuId);
    if (!menu) return;
    const isOpen = menu.style.display === 'block';
    closeAllPopups();
    menu.style.display = isOpen ? 'none' : 'block';
    if (menuId === 'appThemeMenu' && navBar) navBar.classList.toggle('locked', !isOpen);
}

function toggleRequestsPanel(event) {
    event.stopPropagation();
    const isOpen = requestsPanel.style.display === 'block';
    closeAllPopups();
    requestsPanel.style.display = isOpen ? 'none' : 'block';
    if (navBar) navBar.classList.toggle('locked', !isOpen);
}

function toggleSettingsPanel(event) {
    event.stopPropagation();
    const isOpen = settingsPanel.style.display === 'block';
    closeAllPopups();
    settingsPanel.style.display = isOpen ? 'none' : 'block';
    if (navBar) navBar.classList.toggle('locked', !isOpen);
}

function closeAllPopups() {
    document.querySelectorAll('.theme-menu, .requests-panel').forEach(m => m.style.display = 'none');
    if (profilePanel) profilePanel.style.display = 'none';
    if (navBar) navBar.classList.remove('locked');
}

/* ---------------------- Переключение табов (мобилка) ---------------------- */

function switchTab(tabName, event) {
    if (event) event.stopPropagation();
    
    const isMobile = window.innerWidth <= 768;
    if (!isMobile) return; // На ПК табы не переключают экраны

    // Активный таб в навигации
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');

    // Скрыть все экраны/панели + сбросить чат
    if (chatMenu) {
        chatMenu.classList.add('hidden');
        chatMenu.style.display = 'none';
    }
    if (requestsPanel) requestsPanel.style.display = 'none';
    if (settingsPanel) settingsPanel.style.display = 'none';
    if (profilePanel) profilePanel.style.display = 'none';
    
    const messages = document.getElementById('messages');
    if (messages) messages.classList.remove('open');
    
    const welcomeMsg = document.getElementById('welcomeMsg');
    if (welcomeMsg) welcomeMsg.style.display = 'block';

    const chatWindow = document.getElementById('chatWindow');
    if (chatWindow) chatWindow.style.display = 'none';

    // Показать выбранный таб
    if (tabName === 'chats' || tabName === 'contacts') {
        if (chatWindow) chatWindow.style.display = '';
        if (chatMenu) {
            chatMenu.classList.remove('hidden');
            chatMenu.style.display = 'block';
        }
    } else if (tabName === 'requests') {
        if (requestsPanel) {
            requestsPanel.style.display = 'block';
            loadRequests();
        }
    } else if (tabName === 'profile') {
        if (profilePanel) {
            profilePanel.style.display = 'block';
            updateProfileDisplay();
        }
    } else if (tabName === 'settings') {
        if (settingsPanel) settingsPanel.style.display = 'block';
    }
}

document.addEventListener('click', (e) => {
    const insideNav = navBar && navBar.contains(e.target);
    const insideDropdown = e.target.closest('.theme-dropdown-container');
    if (!insideNav && !insideDropdown) closeAllPopups();
});

function selectTheme(themeType) {
    const root = document.documentElement;
    const triggers = document.querySelectorAll('.theme-trigger-btn');
    let applied = themeType;
    if (themeType === 'system') {
        applied = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    root.setAttribute('data-theme', applied === 'light' ? 'light' : 'dark');
    const label = themeType === 'light' ? 'Тема ☀️' : themeType === 'dark' ? 'Тема 🌙' : 'Тема 💻';
    triggers.forEach(btn => { btn.innerText = label; });
    closeAllPopups();
}
selectTheme('dark');

/* ========================================================================= */
/* АВТОРИЗАЦИЯ                                                               */
/* ========================================================================= */

function showForm(targetSection) {
    showNotification('', 'hide');
    ['loginFormSection', 'registerFormSection', 'forgotPasswordSection'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (id === targetSection) ? 'block' : 'none';
    });
    const forgotLinkOuter = document.getElementById('forgotLinkOuter');
    const switchModeTextOuter = document.getElementById('switchModeTextOuter');

    if (targetSection === 'registerFormSection') {
        forgotLinkOuter.style.display = 'none';
        switchModeTextOuter.innerHTML = 'Уже есть аккаунт? <span class="action-link highlight" onclick="showForm(\'loginFormSection\')">Войдите!</span>';
    } else if (targetSection === 'loginFormSection') {
        forgotLinkOuter.style.display = 'block';
        switchModeTextOuter.innerHTML = 'Нет аккаунта? <span class="action-link highlight" onclick="showForm(\'registerFormSection\')">Зарегистрироваться</span>';
    } else if (targetSection === 'forgotPasswordSection') {
        forgotLinkOuter.style.display = 'none';
        switchModeTextOuter.innerHTML = 'Вспомнили пароль? <span class="action-link highlight" onclick="showForm(\'loginFormSection\')">Вернуться назад</span>';
    }
}

function showNotification(message, type = 'error') {
    const box = document.getElementById('statusNotification');
    if (!box) return;
    if (type === 'hide') { box.style.display = 'none'; return; }
    box.innerText = message;
    box.className = `notification-box ${type}`;
    box.style.display = 'block';
}

function processRegistration() {
    const name = document.getElementById('regName').value.trim();
    const login = document.getElementById('regLogin').value.trim();
    const pass = document.getElementById('regPassword').value;
    const passConfirm = document.getElementById('regPasswordConfirm').value;
    const hintWord = document.getElementById('regHintWord').value.trim();

    if (pass !== passConfirm) return showNotification('Пароли не совпадают!', 'error');

    socket.emit('register', { name, login, password: pass, hint: hintWord }, (res) => {
        if (!res.success) return showNotification(res.message, 'error');
        showNotification(`Успешно! Ваш ID для поиска: ${res.id}. Входить будете по логину.`, 'success');
        setTimeout(() => showForm('loginFormSection'), 2500);
    });
}

function processLogin() {
    const login = document.getElementById('loginLogin').value.trim();
    const pass = document.getElementById('loginPassword').value;
    const card = document.getElementById('authCard');

    socket.emit('login', { login, password: pass }, (res) => {
        if (!res.success) return showNotification(res.message, 'error');

        myId = login;
        myName = res.name;
        myGhost = res.ghost;

        showNotification('Вход...', 'success');
        card.classList.add('wave-exit-active');

        const outerLinks = document.getElementById('outerLinksHolder');
        if (outerLinks) outerLinks.style.display = 'none';

        setTimeout(() => {
            document.getElementById('authScreen').style.display = 'none';
            document.getElementById('loadingScreen').style.display = 'flex';
            setTimeout(enterMessenger, 700);
        }, 450);
    });
}

function processPasswordRecovery() {
    const login = document.getElementById('forgotLogin').value.trim();
    const hint = document.getElementById('forgotHintWord').value.trim();

    socket.emit('recoverPassword', { login, hint }, (res) => {
        if (!res.success) return showNotification(res.message, 'error');
        showNotification(`Ваш пароль: ${res.password}`, 'success');
    });
}

/* ========================================================================= */
/* МЕССЕНДЖЕР                                                                */
/* ========================================================================= */

function enterMessenger() {
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appScreen').style.display = 'flex';
    document.getElementById('ghostModeCheckbox').checked = myGhost;

    updateProfileDisplay();

    // На мобилке показываем первый таб "Чаты" при входе
    if (window.innerWidth <= 768) {
        switchTab('chats');
    }

    refreshFriends();
    refreshRequests();
}

function toggleGhostMode(checked) {
    myGhost = checked;
    socket.emit('setGhostMode', checked);
}

function updateProfileDisplay() {
    const nameEl = document.getElementById('profileName');
    const idEl = document.getElementById('profileId');
    if (nameEl) nameEl.textContent = myName || 'Неизвестно';
    if (idEl) idEl.textContent = myId || '—';
}

function copyId() {
    if (!myId) return;
    navigator.clipboard.writeText(myId).then(() => {
        const btn = document.querySelector('.copy-btn');
        const oldText = btn.textContent;
        btn.textContent = '✅';
        setTimeout(() => {
            btn.textContent = oldText;
        }, 1500);
    }).catch(err => {
        console.error('Ошибка копирования:', err);
        alert('Не удалось скопировать ID');
    });
}

function pairId(a, b) { return [a, b].sort().join('_'); }

/* ---------------------- Поиск и заявки ---------------------- */

function searchUser() {
    const query = document.getElementById('searchInput').value.trim();
    const resultBox = document.getElementById('searchResult');
    resultBox.innerHTML = '';
    if (!query) return;

    socket.emit('searchUser', query, (res) => {
        if (!res.found || res.login === myId) return;
        const div = document.createElement('div');
        div.className = 'search-result-item';
        div.innerHTML = `<span>${res.name} (ID: ${res.id})</span>`;
        const btn = document.createElement('button');
        btn.textContent = 'Отправить запрос в друзья';
        btn.onclick = () => {
            socket.emit('sendFriendRequest', res.login);
            resultBox.innerHTML = '<span style="opacity:0.7;">Запрос отправлен ✔</span>';
        };
        div.appendChild(btn);
        resultBox.appendChild(div);
    });
}

function refreshRequests() {
    socket.emit('getRequests', (list) => {
        const listEl = document.getElementById('requestsList');
        const badge = document.getElementById('requestsBadge');

        if (list.length === 0) {
            listEl.innerHTML = 'Пока нет новых заявок';
            badge.style.display = 'none';
            return;
        }
        badge.style.display = 'inline-block';
        badge.textContent = list.length;
        listEl.innerHTML = '';
        list.forEach(req => {
            const item = document.createElement('div');
            item.className = 'request-item';
            item.innerHTML = `
                <div>${req.fromName} хочет добавить вас в друзья</div>
                <div class="request-actions">
                    <button class="btn-accept">Принять</button>
                    <button class="btn-decline">Отклонить</button>
                </div>`;
            item.querySelector('.btn-accept').onclick = () => respondRequest(req.requestId, true);
            item.querySelector('.btn-decline').onclick = () => respondRequest(req.requestId, false);
            listEl.appendChild(item);
        });
    });
}

function respondRequest(requestId, accepted) {
    socket.emit('respondRequest', { requestId, accepted });
}

socket.on('requestsUpdated', refreshRequests);
socket.on('friendsUpdated', refreshFriends);

/* ---------------------- Список друзей ---------------------- */

function refreshFriends() {
    socket.emit('getFriends', (friends) => {
        const chatList = document.getElementById('chatList');
        chatList.innerHTML = '';
        friends.forEach(f => renderFriendRow(f));
    });
}

function renderFriendRow(profile) {
    const chatList = document.getElementById('chatList');
    const row = document.createElement('div');
    row.className = 'chat-item';
    row.id = 'friendRow_' + profile.login;
    row.onclick = () => openChat(profile.login);
    row.innerHTML = `
        <div class="chat-item-name"><span class="online-dot ${profile.online ? 'online' : ''}" id="dot_${profile.login}"></span><span id="name_${profile.login}">${profile.name}</span></div>
        <div class="chat-item-status" id="status_${profile.login}">${statusText(profile)}</div>`;
    chatList.appendChild(row);
}

function statusText(profile) {
    if (profile.ghost) return '';
    if (profile.online) return 'В сети';
    if (profile.lastSeen) return 'Был(а) ' + formatLastSeen(profile.lastSeen);
    return 'Не в сети';
}

function formatLastSeen(ts) {
    const diffMin = Math.floor((Date.now() - ts) / 60000);
    if (diffMin < 1) return 'только что';
    if (diffMin < 60) return `${diffMin} мин. назад`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} ч. назад`;
    return new Date(ts).toLocaleDateString('ru-RU');
}

socket.on('presenceUpdate', (profile) => {
    const dot = document.getElementById('dot_' + profile.login);
    const status = document.getElementById('status_' + profile.login);
    if (dot) dot.classList.toggle('online', profile.online);
    if (status) status.textContent = statusText(profile);
    if (currentChatFriendId === profile.login) updateChatSubtitle(profile);
});

function updateChatSubtitle(profile) {
    const subtitleEl = document.getElementById('chatSubtitle');
    if (subtitleEl) subtitleEl.textContent = statusText(profile);
}

/* ========================================================================= */
/* ЧАТ                                                                       */
/* ========================================================================= */

function openChat(friendId) {
    currentChatFriendId = friendId;

    socket.emit('getProfile', friendId, (profile) => {
        document.getElementById('chatTitle').textContent = profile ? profile.name : friendId;
        if (profile) updateChatSubtitle(profile);
    });

    navBar.classList.add('hidden');
    chatMenu.classList.add('hidden');
    closeAllPopups();

    document.getElementById('welcomeMsg').style.display = 'none';
    document.getElementById('messages').classList.add('open');

    socket.emit('getMessages', friendId, (msgs) => {
        currentChatMessages = msgs;
        renderMessages();
    });
}

function closeChat() {
    navBar.classList.remove('hidden');
    chatMenu.classList.remove('hidden');
    document.getElementById('messages').classList.remove('open');
    document.getElementById('welcomeMsg').style.display = 'block';
    currentChatFriendId = null;
    
    // На мобилке после закрытия чата вернуться на таб "Чаты"
    if (window.innerWidth <= 768) {
        switchTab('chats');
    }
}

function renderMessages() {
    const log = document.getElementById('msgLog');
    log.innerHTML = '';
    currentChatMessages.forEach(msg => {
        const isMine = msg.senderId === myId;
        const div = document.createElement('div');
        div.className = isMine ? 'my-msg' : 'their-msg';
        div.textContent = msg.text;
        if (isMine) {
            const statusSpan = document.createElement('span');
            statusSpan.className = 'msg-status' + (msg.status === 'read' ? ' read' : '');
            statusSpan.textContent = msg.status === 'sent' ? '✓' : '✓✓';
            div.appendChild(statusSpan);
        }
        log.appendChild(div);
    });
    log.scrollTop = log.scrollHeight;
}

function sendMessage() {
    const input = document.getElementById('msgInput');
    const text = input.value.trim();
    if (!text || !currentChatFriendId) return;
    socket.emit('sendMessage', { toId: currentChatFriendId, text });
    input.value = '';
}

socket.on('newMessage', ({ chatId, msg }) => {
    if (!myId) return;
    if (currentChatFriendId && chatId === pairId(myId, currentChatFriendId)) {
        currentChatMessages.push(msg);
        renderMessages();
        if (msg.senderId !== myId) {
            socket.emit('getMessages', currentChatFriendId, (msgs) => {
 currentChatMessages = msgs;
                renderMessages();
            });
        }
    }
});

socket.on('messagesStatusUpdated', (chatId) => {
    if (currentChatFriendId && chatId === pairId(myId, currentChatFriendId)) {
        socket.emit('getMessages', currentChatFriendId, (msgs) => {
            currentChatMessages = msgs;
            renderMessages();
        });
    }
});

/* ========================================================================= */
/* ЗВОНКИ (WebRTC)                                                           */
/* ========================================================================= */

const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let peerConnection = null;
let localStream = null;
let callPartnerId = null;
let isVideoCall = false;

async function startCall(type) {
    if (!currentChatFriendId) return;
    callPartnerId = currentChatFriendId;
    isVideoCall = type === 'video';

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideoCall });
    document.getElementById('localVideo').srcObject = localStream;
    document.getElementById('localVideo').style.display = isVideoCall ? 'block' : 'none';

    peerConnection = createPeerConnection();
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('callUser', { toId: callPartnerId, offer, callType: type });

    showActiveCallOverlay('Вызов...');
}

function createPeerConnection() {
    const pc = new RTCPeerConnection(rtcConfig);
    pc.onicecandidate = (event) => {
        if (event.candidate && callPartnerId) {
            socket.emit('iceCandidate', { toId: callPartnerId, candidate: event.candidate });
        }
    };
    pc.ontrack = (event) => {
        document.getElementById('remoteVideo').srcObject = event.streams[0];
        document.getElementById('callStatusText').textContent = 'Соединено';
    };
    return pc;
}

socket.on('incomingCall', ({ fromId, fromName, offer, callType }) => {
    callPartnerId = fromId;
    isVideoCall = callType === 'video';
    window.pendingOffer = offer;

    document.getElementById('incomingCallText').textContent =
        `${fromName} звонит вам (${isVideoCall ? 'видео' : 'голос'})`;
    document.getElementById('incomingCallOverlay').style.display = 'flex';
});

async function acceptCall() {
    document.getElementById('incomingCallOverlay').style.display = 'none';

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideoCall });
    document.getElementById('localVideo').srcObject = localStream;
    document.getElementById('localVideo').style.display = isVideoCall ? 'block' : 'none';

    peerConnection = createPeerConnection();
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    await peerConnection.setRemoteDescription(new RTCSessionDescription(window.pendingOffer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answerCall', { toId: callPartnerId, answer });

    showActiveCallOverlay('Соединение...');
}

function declineCall() {
    document.getElementById('incomingCallOverlay').style.display = 'none';
    socket.emit('rejectCall', { toId: callPartnerId });
    callPartnerId = null;
}

socket.on('callAnswered', async ({ answer }) => {
    if (peerConnection) await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('iceCandidate', async ({ candidate }) => {
    if (peerConnection) {
        try { await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { /* игнор */ }
    }
});

socket.on('callRejected', () => {
    showNotification('Звонок отклонён', 'error');
    endCallCleanup();
});

socket.on('callEnded', () => endCallCleanup());

function showActiveCallOverlay(statusText) {
    document.getElementById('callStatusText').textContent = statusText;
    document.getElementById('activeCallOverlay').style.display = 'flex';
}

function hangUp() {
    if (callPartnerId) socket.emit('endCall', { toId: callPartnerId });
    endCallCleanup();
}

function endCallCleanup() {
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    document.getElementById('activeCallOverlay').style.display = 'none';
    document.getElementById('incomingCallOverlay').style.display = 'none';
    document.getElementById('remoteVideo').srcObject = null;
    document.getElementById('localVideo').srcObject = null;
    callPartnerId = null;
}