const firebaseConfig = {
    apiKey: "AIzaSyB6uKGFMQEUCR9IQot1wdgjDmhAXioJOUo",
    authDomain: "school-dis.firebaseapp.com",
    databaseURL: "https://school-dis-default-rtdb.firebaseio.com",
    projectId: "school-dis",
    storageBucket: "school-dis.firebasestorage.app",
    messagingSenderId: "53033292390",
    appId: "1:53033292390:web:f9991ea57386a1ab5f13a7",
    measurementId: "G-XLLRWR6KM4"
};

firebase.initializeApp(firebaseConfig);
const database = firebase.database();

console.log('Firebase initialized');
console.log('Database:', database ? 'Connected' : 'Not connected');

database.ref('.info/connected').on('value', (snapshot) => {
    if (snapshot.val() === true) {
        console.log('✅ Firebase database connected successfully');
    } else {
        console.log('❌ Firebase database not connected');
    }
});

let currentUser = null, currentChannel = 'homework help', currentChannelTopic = '';
let isOwner = false, isAdmin = false, isModerator = false, isBanned = false, isPrimeMember = false;
let isSignupMode = true, banListener = null, maintenanceListener = null;
let blockedUsers = [], customChannels = {}, reports = {};
let isMaintenanceMode = false;
let vipRooms = {};
let userVipAccess = {};
let privateRooms = {};
let userPrivateAccess = {};
let primeMembers = {};
const OWNER_EMAILS = ['redstoneb3@gmail.com', 'haventeam3@gmail.com'];
const ADMIN_EMAILS = ['31christianhwang@usd266.com'];
const MAINTENANCE_PASSWORD = 'owner123';
const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const BANNED_CHANNEL_WORDS = ['fuck', 'shit', 'bitch', 'ass', 'damn', 'nigger', 'nigga', 'nazi', 'hitler', 'porn', 'sex', 'nsfw'];

let users = JSON.parse(localStorage.getItem('users') || '{}');
let userStrikes = JSON.parse(localStorage.getItem('userStrikes') || '{}');
let bannedWords = ['fuck', 'shit', 'damn', 'hell', 'ass', 'bitch', 'bastard', 'crap'];
const racistSlurs = ['nigger', 'nigga', 'chink', 'spic', 'kike', 'wetback', 'raghead'];

// ─── DM SYSTEM ────────────────────────────────────────────────────────────────

function openDmModal(targetEmail, targetUsername, reportContext) {
    if (!isOwner) return;
    document.getElementById('dmTargetEmail').value = targetEmail;
    document.getElementById('dmTargetName').textContent = targetUsername || targetEmail.split('@')[0];
    document.getElementById('dmMessageInput').value = '';
    document.getElementById('dmReportContext').textContent = reportContext
        ? `Re: "${reportContext.substring(0, 80)}${reportContext.length > 80 ? '...' : ''}"`
        : '';
    document.getElementById('dmError').classList.add('hidden');
    document.getElementById('dmModal').classList.add('show');
    setTimeout(() => document.getElementById('dmMessageInput').focus(), 100);
}

function closeDmModal() {
    document.getElementById('dmModal').classList.remove('show');
}

function sendDm() {
    if (!isOwner) return;
    const targetEmail = document.getElementById('dmTargetEmail').value;
    const message = document.getElementById('dmMessageInput').value.trim();
    const errorEl = document.getElementById('dmError');

    if (!message) {
        errorEl.textContent = 'Please enter a message.';
        errorEl.classList.remove('hidden');
        return;
    }
    if (!targetEmail) {
        errorEl.textContent = 'No recipient found.';
        errorEl.classList.remove('hidden');
        return;
    }

    const senderName = users[currentUser]?.username || currentUser.split('@')[0];
    const targetKey = targetEmail.replace(/\./g, '_');

    database.ref('dms/' + targetKey).push({
        from: senderName,
        fromEmail: currentUser,
        message,
        timestamp: Date.now(),
        read: false
    }).then(() => {
        closeDmModal();
        alert(`✅ Message sent to ${document.getElementById('dmTargetName').textContent}!`);
    }).catch(err => {
        errorEl.textContent = 'Failed to send: ' + err.message;
        errorEl.classList.remove('hidden');
    });
}

// DM Inbox for regular users
let dmListener = null;

function loadDmInbox() {
    if (!currentUser || isOwner || isAdmin) return;
    const userKey = currentUser.replace(/\./g, '_');

    dmListener = database.ref('dms/' + userKey);
    dmListener.on('value', (snapshot) => {
        const dms = snapshot.exists() ? snapshot.val() : {};
        const dmArray = Object.keys(dms).map(k => ({ id: k, ...dms[k] }));
        const unread = dmArray.filter(d => !d.read).length;

        const badge = document.getElementById('dmInboxBadge');
        const btn = document.getElementById('dmInboxBtn');
        if (btn) {
            btn.style.display = 'block';
            if (unread > 0) {
                badge.textContent = unread;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    });
}

function openDmInbox() {
    const userKey = currentUser.replace(/\./g, '_');
    document.getElementById('dmInboxModal').classList.add('show');
    const list = document.getElementById('dmInboxList');
    list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">Loading...</div>';

    database.ref('dms/' + userKey).once('value').then(snapshot => {
        const dms = snapshot.exists() ? snapshot.val() : {};
        const dmArray = Object.keys(dms).map(k => ({ id: k, ...dms[k] }));

        if (dmArray.length === 0) {
            list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:30px;font-style:italic;">No messages yet</div>';
            return;
        }

        list.innerHTML = '';
        dmArray.sort((a, b) => b.timestamp - a.timestamp).forEach(dm => {
            const date = new Date(dm.timestamp);
            const timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const item = document.createElement('div');
            item.className = 'dm-item' + (dm.read ? '' : ' dm-unread');
            item.innerHTML = `
                <div class="dm-item-header">
                    <span class="dm-from">👑 ${escapeHtml(dm.from)}</span>
                    <span class="dm-time">${timeStr}</span>
                    ${!dm.read ? '<span class="dm-new-badge">NEW</span>' : ''}
                </div>
                <div class="dm-message">${escapeHtml(dm.message)}</div>
            `;
            list.appendChild(item);

            // Mark as read
            if (!dm.read) {
                database.ref('dms/' + userKey + '/' + dm.id + '/read').set(true);
            }
        });
    });
}

function closeDmInbox() {
    document.getElementById('dmInboxModal').classList.remove('show');
}

// ─── PRIME MEMBERS ────────────────────────────────────────────────────────────

function loadPrimeMembers() {
    database.ref('primeMembers').on('value', (snapshot) => {
        primeMembers = snapshot.exists() ? snapshot.val() : {};
        if (currentUser) {
            const key = currentUser.replace(/\./g, '_');
            isPrimeMember = primeMembers[key] === true;
        }
        // Re-render visible messages to update badges
        if (currentChannel) {
            const existing = document.querySelectorAll('.message [data-prime-pending]');
            existing.forEach(el => el.removeAttribute('data-prime-pending'));
        }
    });
}

function isPrimeMemberAccount(email) {
    if (!email) return false;
    const key = email.replace(/\./g, '_');
    return primeMembers[key] === true;
}

function togglePrimeMember(email) {
    if (!isOwner) { alert('Only owners can manage Prime Members!'); return; }
    if (isProtectedAccount(email)) { alert('Cannot assign Prime to owner accounts!'); return; }
    const key = email.replace(/\./g, '_');
    const username = users[email]?.username || email.split('@')[0];
    if (primeMembers[key]) {
        if (confirm(`Remove ⭐ Prime Member status from ${username}?`)) {
            database.ref('primeMembers/' + key).remove().then(() => loadAdminPanel());
        }
    } else {
        if (confirm(`Grant ⭐ Prime Member status to ${username}?`)) {
            database.ref('primeMembers/' + key).set(true).then(() => loadAdminPanel());
        }
    }
}

// ─── EMAIL VALIDATION ─────────────────────────────────────────────────────────

async function validateEmail(email) {
    const formatRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    if (!formatRegex.test(email)) return { valid: false, reason: 'Invalid email format' };
    const domain = email.split('@')[1].toLowerCase();
    const fakeDomains = ['test.com', 'example.com', 'fake.com', 'nomail.com', 'noemail.com', 'mailinator.com', 'guerrillamail.com', 'throwam.com', 'yopmail.com', 'sharklasers.com', 'trashmail.com', 'dispostable.com', 'tempr.email', 'temp-mail.org', 'getnada.com', 'maildrop.cc', 'spamgourmet.com'];
    if (fakeDomains.includes(domain)) return { valid: false, reason: 'Please use a real email address' };
    try {
        const res = await fetch(`https://api.disify.com/api/email/${encodeURIComponent(email)}`);
        if (res.ok) {
            const data = await res.json();
            if (data.disposable) return { valid: false, reason: 'Disposable email addresses are not allowed' };
            if (!data.dns) return { valid: false, reason: 'Email domain does not exist' };
        }
    } catch (e) {
        console.warn('Email validation API unreachable, skipping domain check');
    }
    return { valid: true };
}

function isProtectedAccount(email) {
    return OWNER_EMAILS.includes(email);
}

function isAdminAccount(email) {
    return ADMIN_EMAILS.includes(email);
}

function ensureProtectedAccountNotBanned(email) {
    return new Promise((resolve, reject) => {
        if (!isProtectedAccount(email)) { resolve(); return; }
        const userKey = email.replace(/\./g, '_');
        database.ref('banned/' + userKey).remove()
            .then(() => {
                if (userStrikes[email]) {
                    delete userStrikes[email];
                    localStorage.setItem('userStrikes', JSON.stringify(userStrikes));
                }
                if (currentUser === email) isBanned = false;
                resolve();
            })
            .catch(() => resolve());
    });
}

function checkUserRole(email) {
    if (isProtectedAccount(email)) { ensureProtectedAccountNotBanned(email); return 'owner'; }
    else if (isAdminAccount(email)) return 'admin';
    return 'user';
}

function getUserInitial(email) {
    const username = users[email]?.username || email.split('@')[0];
    return username.charAt(0).toUpperCase();
}

function getUserRoleClass(email) {
    if (isProtectedAccount(email)) return 'owner';
    if (isAdminAccount(email)) return 'admin';
    return '';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function toggleCollapsible(contentId) {
    const content = document.getElementById(contentId);
    const header = event.currentTarget;
    content.classList.toggle('collapsed');
    header.classList.toggle('collapsed');
}

// ─── REPORTS ──────────────────────────────────────────────────────────────────

function loadReports() {
    database.ref('reports').on('value', (snapshot) => {
        reports = snapshot.exists() ? snapshot.val() : {};
        displayReports();
    });
}

function displayReports() {
    const reportsList = document.getElementById('reportsList');
    const reportsBadge = document.getElementById('reportsBadge');
    const reportsArray = Object.keys(reports).map(key => ({ id: key, ...reports[key] }));

    if (reportsArray.length === 0) {
        reportsList.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px; font-style:italic;">No reports</div>';
        reportsBadge.classList.add('hidden');
        return;
    }

    reportsBadge.textContent = reportsArray.length;
    reportsBadge.classList.remove('hidden');
    reportsList.innerHTML = '';

    reportsArray.sort((a, b) => b.timestamp - a.timestamp).forEach(report => {
        const date = new Date(report.timestamp);
        const timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        const reporterEmail = report.reporterEmail || '';
        const reporterName = report.reporter || 'Unknown';
        const reportDiv = document.createElement('div');
        reportDiv.className = 'report-item';
        reportDiv.innerHTML = `
            <div class="report-header">
                <span class="report-type">HELP REQUEST</span>
                <span class="report-time">${timeStr}</span>
            </div>
            <div class="report-content"><strong>${escapeHtml(reporterName)}</strong>: ${escapeHtml(report.message)}</div>
            <div style="display:flex;gap:8px;margin-top:10px;">
                ${isOwner && reporterEmail ? `<button class="report-dm-btn" onclick="openDmModal('${reporterEmail}', '${escapeHtml(reporterName)}', '${escapeHtml(report.message).replace(/'/g, "\\'")}')">💬 DM User</button>` : ''}
                <button class="report-dismiss" style="flex:1;" onclick="dismissReport('${report.id}')">✓ Dismiss</button>
            </div>
        `;
        reportsList.appendChild(reportDiv);
    });
}

function dismissReport(reportId) {
    if (isOwner || isAdmin) database.ref('reports/' + reportId).remove();
}

// ─── SETTINGS & CHANNELS ──────────────────────────────────────────────────────

function loadCustomSettings() {
    database.ref('settings/bannedWords').once('value', (snapshot) => {
        if (snapshot.exists()) bannedWords = snapshot.val();
        if (isOwner || isAdmin) loadBannedWordsList();
    });
    database.ref('customChannels').on('value', (snapshot) => {
        customChannels = snapshot.exists() ? snapshot.val() : {};
        loadCustomChannels();
    });
}

function loadCustomChannels() {
    const list = document.getElementById('customChannelsList');
    const section = document.getElementById('customChannelsSection');
    list.innerHTML = '';
    if (Object.keys(customChannels).length === 0) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    Object.keys(customChannels).forEach(name => {
        const channel = customChannels[name];
        const div = document.createElement('div');
        div.className = 'channel';
        div.onclick = () => switchChannel(name, channel.topic);
        const canDelete = isAdmin || isOwner || isModerator;
        div.innerHTML = `
            <span class="channel-name">${name}</span>
            ${canDelete ? `<button class="delete-channel-btn" onclick="deleteChannel(event, '${name}')">×</button>` : ''}
        `;
        list.appendChild(div);
    });
}

function openCreateChannelModal() {
    document.getElementById('createChannelModal').classList.add('show');
    document.getElementById('newChannelName').value = '';
    document.getElementById('newChannelTopic').value = '';
    document.getElementById('channelError').classList.add('hidden');
}

function closeCreateChannelModal() {
    document.getElementById('createChannelModal').classList.remove('show');
}

function createNewChannel() {
    const name = document.getElementById('newChannelName').value.trim().toLowerCase();
    const topic = document.getElementById('newChannelTopic').value.trim();
    const errorEl = document.getElementById('channelError');
    if (!name) { errorEl.textContent = 'Please enter a channel name'; errorEl.classList.remove('hidden'); return; }
    if (!/^[a-z0-9_-]+$/.test(name)) { errorEl.textContent = 'Only letters, numbers, hyphens, and underscores allowed'; errorEl.classList.remove('hidden'); return; }
    if (BANNED_CHANNEL_WORDS.some(word => name.includes(word))) { errorEl.textContent = 'Channel name contains inappropriate content'; errorEl.classList.remove('hidden'); return; }
    const defaults = ['homework-help', 'teacher-complaints', 'study-hall', 'science-lab'];
    if (defaults.includes(name) || customChannels[name]) { errorEl.textContent = 'Channel already exists'; errorEl.classList.remove('hidden'); return; }
    database.ref('customChannels/' + name).set({ name, topic: topic || '', createdBy: currentUser, createdAt: Date.now() }).then(() => closeCreateChannelModal());
}

function deleteChannel(event, name) {
    event.stopPropagation();
    if (!isAdmin && !isOwner && !isModerator) return;
    if (confirm(`Delete #${name}? All messages will be lost.`)) {
        database.ref('customChannels/' + name).remove();
        database.ref('messages/' + name).remove();
        if (currentChannel === name) switchChannel('homework help', '');
    }
}

// ─── VIP ROOMS ────────────────────────────────────────────────────────────────

function loadVipRooms() {
    if (!currentUser) return;
    database.ref('vipRooms').on('value', (snapshot) => { vipRooms = snapshot.exists() ? snapshot.val() : {}; loadVipChannels(); });
    const userKey = currentUser.replace(/\./g, '_');
    database.ref('vipAccess/' + userKey).on('value', (snapshot) => { userVipAccess = snapshot.exists() ? snapshot.val() : {}; loadVipChannels(); });
    database.ref('privateRooms').on('value', (snapshot) => { privateRooms = snapshot.exists() ? snapshot.val() : {}; loadPrivateChannels(); });
    database.ref('privateAccess/' + userKey).on('value', (snapshot) => { userPrivateAccess = snapshot.exists() ? snapshot.val() : {}; loadPrivateChannels(); });
}

function loadVipChannels() {
    const list = document.getElementById('vipChannelsList');
    const section = document.getElementById('vipChannelsSection');
    const addBtn = document.getElementById('addVipRoomBtn');
    if (!list || !section) return;
    list.innerHTML = '';
    if (isOwner && addBtn) addBtn.style.display = 'block';
    let visibleVipRooms = isOwner ? Object.keys(vipRooms) : Object.keys(vipRooms).filter(roomName => userVipAccess[roomName] === true);
    if (visibleVipRooms.length === 0) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    visibleVipRooms.forEach(roomName => {
        const room = vipRooms[roomName];
        const div = document.createElement('div');
        div.className = 'channel vip-channel';
        div.onclick = () => switchChannel(roomName, room.topic);
        div.innerHTML = `<span class="channel-name">${roomName}</span>${isOwner ? `<button class="delete-channel-btn" onclick="deleteVipRoom(event, '${roomName}')">×</button>` : ''}`;
        list.appendChild(div);
    });
}

function openCreateVipRoomModal() {
    if (!isOwner) return;
    document.getElementById('createVipRoomModal').classList.add('show');
    document.getElementById('vipRoomName').value = '';
    document.getElementById('vipRoomTopic').value = '';
    document.getElementById('vipRoomError').classList.add('hidden');
    loadUsersForVipAccess();
}

function closeCreateVipRoomModal() { document.getElementById('createVipRoomModal').classList.remove('show'); }

async function loadUsersForVipAccess() {
    const usersList = document.getElementById('vipUsersList');
    usersList.innerHTML = '';
    const allEmails = new Set([...Object.keys(users)]);
    try {
        const snapshot = await database.ref('users').once('value');
        const firebaseUsers = snapshot.val() || {};
        Object.keys(firebaseUsers).forEach(key => allEmails.add(key.replace(/_/g, '.')));
    } catch (e) { console.warn('Cannot read /users for VIP access list.'); }
    allEmails.forEach(email => {
        if (isProtectedAccount(email)) return;
        const displayName = users[email]?.username || email.split('@')[0];
        const checkbox = document.createElement('div');
        checkbox.className = 'vip-user-checkbox';
        checkbox.innerHTML = `<label><input type="checkbox" value="${email}" class="vip-user-select"><span>${displayName}</span></label>`;
        usersList.appendChild(checkbox);
    });
    if (usersList.children.length === 0) usersList.innerHTML = '<div style="color:var(--text-muted); font-size:13px; padding:10px;">No users found.</div>';
}

function createVipRoom() {
    if (!isOwner) return;
    const name = document.getElementById('vipRoomName').value.trim();
    const topic = document.getElementById('vipRoomTopic').value.trim();
    const errorEl = document.getElementById('vipRoomError');
    if (!name) { errorEl.textContent = 'Please enter a room name'; errorEl.classList.remove('hidden'); return; }
    if (vipRooms[name]) { errorEl.textContent = 'VIP room already exists'; errorEl.classList.remove('hidden'); return; }
    const checkboxes = document.querySelectorAll('.vip-user-select:checked');
    const selectedUsers = Array.from(checkboxes).map(cb => cb.value);
    if (selectedUsers.length === 0) { errorEl.textContent = 'Please select at least one user'; errorEl.classList.remove('hidden'); return; }
    database.ref('vipRooms/' + name).set({ name, topic: topic || '', createdBy: currentUser, createdAt: Date.now() }).then(() => {
        const promises = selectedUsers.map(email => database.ref('vipAccess/' + email.replace(/\./g, '_') + '/' + name).set(true));
        return Promise.all(promises);
    }).then(() => { closeCreateVipRoomModal(); alert('VIP room created successfully!'); });
}

function deleteVipRoom(event, name) {
    event.stopPropagation();
    if (!isOwner) return;
    if (confirm(`Delete VIP room "${name}"? All messages and access will be lost.`)) {
        database.ref('vipRooms/' + name).remove();
        database.ref('messages/' + name).remove();
        database.ref('vipAccess').once('value', (snapshot) => {
            if (snapshot.exists()) {
                const allAccess = snapshot.val();
                Object.keys(allAccess).forEach(userKey => { if (allAccess[userKey][name]) database.ref('vipAccess/' + userKey + '/' + name).remove(); });
            }
        });
        if (currentChannel === name) switchChannel('homework help', '');
    }
}

// ─── PRIVATE ROOMS ────────────────────────────────────────────────────────────

function loadPrivateChannels() {
    const list = document.getElementById('privateChannelsList');
    const section = document.getElementById('privateChannelsSection');
    const addBtn = document.getElementById('addPrivateRoomBtn');
    if (!list || !section) return;
    list.innerHTML = '';
    section.classList.remove('hidden');
    if (isOwner && addBtn) addBtn.style.display = 'block';
    let visiblePrivateRooms = isOwner ? Object.keys(privateRooms) : Object.keys(privateRooms).filter(roomName => {
        const userKey = currentUser.replace(/\./g, '_');
        return privateRooms[roomName].members && privateRooms[roomName].members[userKey] === true;
    });
    if (visiblePrivateRooms.length === 0 && !isOwner) {
        list.innerHTML = '<div style="padding: 12px; color: var(--text-muted); font-size: 13px; font-style: italic; text-align: center;">No private rooms<br/>Click 🔑 to join</div>';
        return;
    }
    visiblePrivateRooms.forEach(roomName => {
        const room = privateRooms[roomName];
        const div = document.createElement('div');
        div.className = 'channel private-channel';
        div.onclick = () => switchChannel(roomName, room.topic);
        div.innerHTML = `<span class="channel-name">${roomName}</span>${isOwner ? `<button class="delete-channel-btn" onclick="deletePrivateRoom(event, '${roomName}')">×</button>` : ''}`;
        list.appendChild(div);
    });
}

function openCreatePrivateRoomModal() {
    if (!isOwner) return;
    document.getElementById('createPrivateRoomModal').classList.add('show');
    document.getElementById('privateRoomName').value = '';
    document.getElementById('privateRoomTopic').value = '';
    document.getElementById('privateRoomCode').value = '';
    document.getElementById('privateRoomError').classList.add('hidden');
}

function closeCreatePrivateRoomModal() { document.getElementById('createPrivateRoomModal').classList.remove('show'); }

function createPrivateRoom() {
    if (!isOwner) return;
    const name = document.getElementById('privateRoomName').value.trim();
    const topic = document.getElementById('privateRoomTopic').value.trim();
    const accessCode = document.getElementById('privateRoomCode').value.trim();
    const errorEl = document.getElementById('privateRoomError');
    if (!name) { errorEl.textContent = 'Please enter a room name'; errorEl.classList.remove('hidden'); return; }
    if (!accessCode) { errorEl.textContent = 'Please enter an access code'; errorEl.classList.remove('hidden'); return; }
    if (accessCode.length < 4) { errorEl.textContent = 'Access code must be at least 4 characters'; errorEl.classList.remove('hidden'); return; }
    if (privateRooms[name]) { errorEl.textContent = 'Private room already exists'; errorEl.classList.remove('hidden'); return; }
    const ownerKey = currentUser.replace(/\./g, '_');
    const members = {};
    members[ownerKey] = true;
    database.ref('privateRooms/' + name).set({ name, topic: topic || '', accessCode, createdBy: currentUser, createdAt: Date.now(), members }).then(() => {
        closeCreatePrivateRoomModal();
        alert(`Private room "${name}" created!\nAccess Code: ${accessCode}\n\nShare this code with users who should have access.`);
    });
}

function deletePrivateRoom(event, name) {
    event.stopPropagation();
    if (!isOwner) return;
    if (confirm(`Delete private room "${name}"? All messages and access will be lost.`)) {
        database.ref('privateRooms/' + name).remove();
        database.ref('messages/' + name).remove();
        if (currentChannel === name) switchChannel('homework help', '');
    }
}

function openJoinPrivateRoomModal() {
    document.getElementById('joinPrivateRoomModal').classList.add('show');
    document.getElementById('joinPrivateRoomCode').value = '';
    document.getElementById('joinPrivateRoomError').classList.add('hidden');
}

function closeJoinPrivateRoomModal() { document.getElementById('joinPrivateRoomModal').classList.remove('show'); }

function joinPrivateRoom() {
    const code = document.getElementById('joinPrivateRoomCode').value.trim();
    const errorEl = document.getElementById('joinPrivateRoomError');
    if (!code) { errorEl.textContent = 'Please enter an access code'; errorEl.classList.remove('hidden'); return; }
    let foundRoom = null;
    for (const roomName in privateRooms) {
        if (privateRooms[roomName].accessCode === code) { foundRoom = roomName; break; }
    }
    if (!foundRoom) { errorEl.textContent = 'Invalid access code'; errorEl.classList.remove('hidden'); return; }
    const userKey = currentUser.replace(/\./g, '_');
    if (privateRooms[foundRoom].members && privateRooms[foundRoom].members[userKey]) {
        errorEl.textContent = 'You already have access to this room!';
        errorEl.classList.remove('hidden');
        closeJoinPrivateRoomModal();
        return;
    }
    database.ref('privateRooms/' + foundRoom + '/members/' + userKey).set(true).then(() => {
        closeJoinPrivateRoomModal();
        alert(`Access granted to "${foundRoom}"!`);
    });
}

// ─── CHANNEL SWITCHING & MESSAGES ─────────────────────────────────────────────

function switchChannel(channel, topic) {
    currentChannel = channel;
    currentChannelTopic = topic || '';
    document.getElementById('chatHeader').textContent = channel;
    document.getElementById('chatTopic').textContent = topic || '';
    document.getElementById('messageInput').placeholder = `Message #${channel}`;
    document.querySelectorAll('.channel').forEach(ch => ch.classList.remove('active'));
    if (event && event.target) {
        const channelEl = event.target.closest('.channel');
        if (channelEl) channelEl.classList.add('active');
    }
    loadMessages();
}

function loadBannedWordsList() {
    const list = document.getElementById('bannedWordsList');
    list.innerHTML = '';
    bannedWords.forEach(word => {
        const item = document.createElement('div');
        item.className = 'banned-word-item';
        item.innerHTML = `<span>${word}</span><button class="remove-word-btn" onclick="removeBannedWord('${word}')">Remove</button>`;
        list.appendChild(item);
    });
}

function addBannedWord() {
    if (!isOwner && !isAdmin) return;
    const word = document.getElementById('newBannedWord').value.trim().toLowerCase();
    if (!word) return;
    if (bannedWords.includes(word)) { alert('Word already banned'); return; }
    bannedWords.push(word);
    database.ref('settings/bannedWords').set(bannedWords).then(() => {
        document.getElementById('newBannedWord').value = '';
        loadBannedWordsList();
    });
}

function removeBannedWord(word) {
    if (!isOwner && !isAdmin) return;
    if (confirm(`Remove "${word}"?`)) {
        bannedWords = bannedWords.filter(w => w !== word);
        database.ref('settings/bannedWords').set(bannedWords).then(() => loadBannedWordsList());
    }
}

// ─── MAINTENANCE ──────────────────────────────────────────────────────────────

function setupMaintenanceListener() {
    maintenanceListener = database.ref('maintenance');
    maintenanceListener.on('value', (snapshot) => {
        const maintenanceActive = snapshot.exists() && snapshot.val() === true;
        isMaintenanceMode = maintenanceActive;
        updateMaintenanceUI(maintenanceActive);
        if (maintenanceActive && !isOwner && !isAdmin) showMaintenanceScreen();
    });
}

function updateMaintenanceUI(active) {
    const banner = document.getElementById('maintenanceActiveBanner');
    const toggleBtn = document.getElementById('maintenanceToggleBtn');
    if (active) {
        if (isOwner || isAdmin) banner.classList.add('show');
        if (toggleBtn) { toggleBtn.textContent = '✅ Disable Maintenance'; toggleBtn.classList.add('active'); }
    } else {
        banner.classList.remove('show');
        if (toggleBtn) { toggleBtn.textContent = '🔧 Enable Maintenance'; toggleBtn.classList.remove('active'); }
    }
}

function toggleMaintenanceMode() {
    if (!isOwner) return;
    database.ref('maintenance').once('value', (snapshot) => {
        const currentState = snapshot.exists() && snapshot.val() === true;
        if (currentState) {
            if (confirm('Disable maintenance mode? All users will be able to access the chat.')) {
                database.ref('maintenance').set(false).then(() => alert('Maintenance mode disabled!'));
            }
        } else {
            openMaintenanceModal();
        }
    });
}

function openMaintenanceModal() {
    document.getElementById('maintenanceModal').classList.add('show');
    document.getElementById('maintenancePassword').value = '';
    document.getElementById('maintenanceError').classList.add('hidden');
}

function closeMaintenanceModal() { document.getElementById('maintenanceModal').classList.remove('show'); }

function activateMaintenanceMode() {
    const password = document.getElementById('maintenancePassword').value;
    if (password === MAINTENANCE_PASSWORD) {
        database.ref('maintenance').set(true).then(() => {
            closeMaintenanceModal();
            alert('Maintenance mode activated! Regular users will be kicked out.');
        });
    } else {
        document.getElementById('maintenanceError').textContent = 'Incorrect password!';
        document.getElementById('maintenanceError').classList.remove('hidden');
    }
}

function showMaintenanceScreen() {
    if (maintenanceListener) maintenanceListener.off();
    if (banListener) banListener.off();
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('chatContainer').style.display = 'none';
    document.getElementById('bannedScreen').classList.remove('show');
    document.getElementById('maintenanceScreen').classList.add('show');
}

function openUnbanTool() {
    if (!isOwner) return;
    window.open('unban.html', '_blank');
}

function toggleMobileMenu() {
    document.getElementById('sidebar').classList.toggle('mobile-open');
}

// ─── APP INIT ─────────────────────────────────────────────────────────────────

window.onload = function() {
    const savedUser = localStorage.getItem('loggedInUser');
    if (!savedUser) { updateAuthUI(); loadCustomSettings(); return; }
    if (checkLoginExpiration()) {
        localStorage.removeItem('loggedInUser');
        localStorage.removeItem('lastLoginTime');
        updateAuthUI();
        loadCustomSettings();
        return;
    }
    currentUser = savedUser;
    const role = checkUserRole(currentUser);
    isOwner = (role === 'owner');
    isAdmin = (role === 'owner' || role === 'admin');
    ensureProtectedAccountNotBanned(currentUser)
        .then(() => checkBanStatus())
        .then(() => {
            if (isBanned) { showBannedScreen(); return Promise.reject('User is banned'); }
            return database.ref('maintenance').once('value');
        })
        .then((snapshot) => {
            const maintenanceActive = snapshot.exists() && snapshot.val() === true;
            isMaintenanceMode = maintenanceActive;
            if (maintenanceActive && !isOwner && !isAdmin) { showMaintenanceScreen(); return Promise.reject('Maintenance mode active'); }
            updateLastActivity();
            showChat();
            setupMaintenanceListener();
        })
        .catch((error) => {
            if (error && error.code === 'PERMISSION_DENIED') { updateLastActivity(); showChat(); return; }
            if (error !== 'User is banned' && error !== 'Maintenance mode active') {
                if (error && error.message && error.message.includes('permission')) { updateLastActivity(); showChat(); }
            }
        });
    loadCustomSettings();
    loadVipRooms();
};

function toggleAuthMode() { isSignupMode = !isSignupMode; updateAuthUI(); clearAuthMessages(); }

function updateAuthUI() {
    const title = document.getElementById('authTitle');
    const subtitle = document.getElementById('authSubtitle');
    const button = document.getElementById('authButton');
    const toggleText = document.getElementById('authToggleText');
    const toggleLink = document.getElementById('authToggleLink');
    const usernameField = document.getElementById('usernameField');
    const confirmField = document.getElementById('confirmPasswordField');
    if (isSignupMode) {
        title.textContent = 'Create an account';
        subtitle.textContent = "We're so excited to see you!";
        button.textContent = 'Continue';
        toggleText.textContent = 'Already have an account?';
        toggleLink.textContent = 'Login';
        usernameField.classList.remove('hidden');
        confirmField.classList.remove('hidden');
    } else {
        title.textContent = 'Welcome back!';
        subtitle.textContent = "We're so excited to see you again!";
        button.textContent = 'Log In';
        toggleText.textContent = "Need an account?";
        toggleLink.textContent = 'Register';
        usernameField.classList.add('hidden');
        confirmField.classList.add('hidden');
    }
}

function handleAuth() { isSignupMode ? signup() : login(); }

async function signup() {
    const username = document.getElementById('usernameInput').value.trim();
    const email = document.getElementById('emailInput').value.trim();
    const password = document.getElementById('passwordInput').value;
    const confirmPassword = document.getElementById('confirmPasswordInput').value;
    if (!username || !email || !password || !confirmPassword) { showError('Please fill in all fields'); return; }
    if (password !== confirmPassword) { showError('Passwords do not match'); return; }
    if (password.length < 6) { showError('Password must be at least 6 characters'); return; }
    if (users[email]) { showError('Email already registered'); return; }
    if (Object.values(users).some(u => u.username.toLowerCase() === username.toLowerCase())) { showError('Username taken'); return; }
    const authButton = document.getElementById('authButton');
    authButton.textContent = 'Checking email...';
    authButton.disabled = true;
    const emailCheck = await validateEmail(email);
    authButton.textContent = 'Continue';
    authButton.disabled = false;
    if (!emailCheck.valid) { showError(emailCheck.reason); return; }
    users[email] = { username, password, createdAt: new Date().toISOString() };
    localStorage.setItem('users', JSON.stringify(users));
    database.ref('users/' + email.replace(/\./g, '_')).set({ username, createdAt: new Date().toISOString() });
    localStorage.setItem('loggedInUser', email);
    localStorage.setItem('lastLoginTime', Date.now().toString());
    showSuccess('Account created! Redirecting to terms...');
    setTimeout(() => { window.location.href = 'terms.html'; }, 1000);
}

function login() {
    const email = document.getElementById('emailInput').value.trim();
    const password = document.getElementById('passwordInput').value;
    if (!email || !password) { showError('Please enter email and password'); return; }
    if (!users[email]) { showError('Account not found'); return; }
    if (users[email].password !== password) { showError('Invalid password'); return; }
    currentUser = email;
    localStorage.setItem('loggedInUser', email);
    localStorage.setItem('lastLoginTime', Date.now().toString());
    const role = checkUserRole(currentUser);
    isOwner = (role === 'owner');
    isAdmin = (role === 'owner' || role === 'admin');
    const termsAccepted = localStorage.getItem('termsAccepted_' + email);
    if (!termsAccepted) { window.location.href = 'terms.html'; return; }
    ensureProtectedAccountNotBanned(currentUser)
        .then(() => checkBanStatus())
        .then(() => {
            if (isBanned) { showBannedScreen(); return Promise.reject('User is banned'); }
            return database.ref('maintenance').once('value');
        })
        .then((snapshot) => {
            const maintenanceActive = snapshot.exists() && snapshot.val() === true;
            if (maintenanceActive && !isOwner && !isAdmin) { showMaintenanceScreen(); return Promise.reject('Maintenance active'); }
            updateLastActivity();
            showChat();
            setupMaintenanceListener();
        })
        .catch((error) => {
            if (error && error.code === 'PERMISSION_DENIED') { updateLastActivity(); showChat(); return; }
            if (error !== 'User is banned' && error !== 'Maintenance active') {
                if (error && error.message && error.message.includes('permission')) { updateLastActivity(); showChat(); }
                else { showError('Login error: ' + (error.message || error)); }
            }
        });
}

function showChat() {
    if (isProtectedAccount(currentUser)) isBanned = false;
    if (isBanned) { showBannedScreen(); return; }
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('chatContainer').style.display = 'flex';
    document.getElementById('bannedScreen').classList.remove('show');
    document.getElementById('maintenanceScreen').classList.remove('show');

    const displayName = users[currentUser]?.username || currentUser.split('@')[0];
    const initial = getUserInitial(currentUser);
    const userAvatarSmall = document.getElementById('userAvatarSmall');

    let badge = '';
    if (isOwner) {
        badge = '<span class="badge owner-badge">Owner</span>';
        document.getElementById('adminPanelHeader').textContent = '👑 OWNER PANEL';
        document.getElementById('adminPanelHeader').classList.add('owner-header');
        userAvatarSmall.className = 'user-avatar-small owner';
    } else if (isAdmin) {
        badge = '<span class="badge admin-badge">Admin</span>';
        document.getElementById('adminPanelHeader').textContent = '🛡️ ADMIN PANEL';
        userAvatarSmall.className = 'user-avatar-small admin';
    } else {
        userAvatarSmall.className = 'user-avatar-small';
    }

    userAvatarSmall.textContent = initial;
    document.getElementById('currentUser').innerHTML = displayName + badge;

    if (!isProtectedAccount(currentUser)) {
        banListener = database.ref('banned/' + currentUser.replace(/\./g, '_'));
        banListener.on('value', (snapshot) => {
            if (snapshot.exists() && snapshot.val() === true) { isBanned = true; showBannedScreen(); }
        });
    }

    if (isOwner || isAdmin) {
        document.getElementById('adminPanel').classList.add('show');
        loadAdminPanel();
        loadReports();
        document.getElementById('reportsSection').classList.remove('hidden');
        document.getElementById('bannedWordsSection').classList.remove('hidden');
        loadBannedWordsList();
        if (!isOwner) {
            const announcements = document.getElementById('announcementsSection');
            if (announcements) announcements.style.display = 'none';
        }
        if (isOwner) {
            document.getElementById('ownerControls').classList.remove('hidden');
        } else {
            document.getElementById('ownerControls').classList.add('hidden');
        }
        database.ref('maintenance').once('value', (snapshot) => {
            const maintenanceActive = snapshot.exists() && snapshot.val() === true;
            updateMaintenanceUI(maintenanceActive);
        });
    } else {
        document.getElementById('helpButton').classList.remove('hidden');
        // Load DM inbox for regular users
        loadDmInbox();
    }

    blockedUsers = JSON.parse(localStorage.getItem('blockedUsers_' + currentUser) || '[]');
    updateLastActivity();
    loadCustomSettings();
    loadMessages();
    loadVipRooms();
    loadAnnouncement();
    loadPrimeMembers();
    setInterval(updateLastActivity, 60000);
}

function showBannedScreen() {
    if (isProtectedAccount(currentUser)) { isBanned = false; return; }
    if (banListener) banListener.off();
    if (maintenanceListener) maintenanceListener.off();
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('chatContainer').style.display = 'none';
    document.getElementById('maintenanceScreen').classList.remove('show');
    document.getElementById('bannedScreen').classList.add('show');
}

function showError(msg) {
    document.getElementById('errorMsg').textContent = msg;
    document.getElementById('errorMsg').classList.remove('hidden');
    document.getElementById('successMsg').classList.add('hidden');
}

function showSuccess(msg) {
    document.getElementById('successMsg').textContent = msg;
    document.getElementById('successMsg').classList.remove('hidden');
    document.getElementById('errorMsg').classList.add('hidden');
}

function clearAuthMessages() {
    document.getElementById('errorMsg').classList.add('hidden');
    document.getElementById('successMsg').classList.add('hidden');
}

function logout() {
    if (maintenanceListener) maintenanceListener.off();
    if (banListener) banListener.off();
    if (dmListener) dmListener.off();
    localStorage.removeItem('loggedInUser');
    localStorage.removeItem('lastLoginTime');
    location.reload();
}

function checkLoginExpiration() {
    const lastLogin = localStorage.getItem('lastLoginTime');
    if (!lastLogin) return true;
    return (Date.now() - parseInt(lastLogin)) > ONE_MONTH_MS;
}

function updateLastActivity() {
    localStorage.setItem('lastLoginTime', Date.now().toString());
    if (currentUser) database.ref('users/' + currentUser.replace(/\./g, '_') + '/lastActive').set(Date.now());
}

// ─── MESSAGES ─────────────────────────────────────────────────────────────────

let currentMessageListener = null;

function loadMessages() {
    const messagesDiv = document.getElementById('messages');
    messagesDiv.innerHTML = '';
    if (currentMessageListener) database.ref('messages/' + currentMessageListener).off();
    currentMessageListener = currentChannel;
    database.ref('messages/' + currentChannel).limitToLast(50).on('child_added', (snapshot) => {
        addMessageToUI(snapshot.val(), snapshot.key);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    });
    database.ref('messages/' + currentChannel).on('child_removed', (snapshot) => {
        const el = document.querySelector(`[data-message-id="${snapshot.key}"]`);
        if (el) el.remove();
    });
}

function addMessageToUI(msg, messageId) {
    if (blockedUsers.includes(msg.user)) return;
    const messagesDiv = document.getElementById('messages');
    const messageEl = document.createElement('div');
    messageEl.className = 'message';
    messageEl.setAttribute('data-message-id', messageId);

    const initial = msg.user.charAt(0).toUpperCase();
    const roleClass = getUserRoleClass(msg.email);
    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const canDelete = isAdmin || isOwner || isModerator;

    let badge = '';
    if (isProtectedAccount(msg.email)) {
        badge = '<span class="badge owner-badge">👑 Owner</span>';
    } else if (isAdminAccount(msg.email)) {
        badge = '<span class="badge admin-badge">🛡️ Admin</span>';
    } else if (isPrimeMemberAccount(msg.email)) {
        badge = '<span class="badge prime-badge">⭐ Prime</span>';
    }

    const safeText = escapeHtml(msg.text);
    messageEl.innerHTML = `
        <div class="message-avatar ${roleClass}" onclick="viewUserActivity('${msg.email}')" title="Click to view activity">${initial}</div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-username" onclick="viewUserActivity('${msg.email}')">${escapeHtml(msg.user)}</span>
                ${badge}
                <span class="message-time">${time}</span>
            </div>
            <div class="message-text">${safeText}</div>
        </div>
        ${canDelete ? `<div class="message-buttons"><button class="message-btn" onclick="deleteMessage('${messageId}')" title="Delete">🗑️</button></div>` : ''}
    `;
    messagesDiv.appendChild(messageEl);
}

function deleteMessage(messageId) {
    if (!isAdmin && !isOwner && !isModerator) return;
    if (confirm('Delete this message?')) database.ref('messages/' + currentChannel + '/' + messageId).remove();
}

function handleKeyPress(event) {
    if (event.key === 'Enter') sendMessage();
}

function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (!text) return;
    if (isProtectedAccount(currentUser)) {
        const displayName = users[currentUser]?.username || currentUser.split('@')[0];
        database.ref('messages/' + currentChannel).push({ user: displayName, email: currentUser, text, timestamp: new Date().toISOString() });
        input.value = '';
        return;
    }
    if (isBanned) { alert('You are banned'); input.value = ''; return; }
    const lowerText = text.toLowerCase();
    if (racistSlurs.some(slur => lowerText.includes(slur))) {
        database.ref('banned/' + currentUser.replace(/\./g, '_')).set(true);
        alert('Banned for using racist language');
        isBanned = true;
        showBannedScreen();
        return;
    }
    if (bannedWords.some(word => lowerText.includes(word))) {
        if (!userStrikes[currentUser]) userStrikes[currentUser] = 0;
        userStrikes[currentUser]++;
        localStorage.setItem('userStrikes', JSON.stringify(userStrikes));
        document.getElementById('strikeCount').textContent = userStrikes[currentUser];
        document.getElementById('warningBanner').classList.remove('hidden');
        if (userStrikes[currentUser] >= 3) {
            database.ref('banned/' + currentUser.replace(/\./g, '_')).set(true);
            alert('Banned for excessive profanity (3 strikes)');
            isBanned = true;
            showBannedScreen();
            return;
        }
        setTimeout(() => document.getElementById('warningBanner').classList.add('hidden'), 3000);
        input.value = '';
        return;
    }
    const displayName = users[currentUser]?.username || currentUser.split('@')[0];
    database.ref('messages/' + currentChannel).push({ user: displayName, email: currentUser, text, timestamp: new Date().toISOString() });
    input.value = '';
}

// ─── ADMIN PANEL ──────────────────────────────────────────────────────────────

async function loadAdminPanel() {
    const adminUsersDiv = document.getElementById('adminUsers');
    adminUsersDiv.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">Loading users...</div>';
    const now = Date.now();
    const FIVE_MINUTES = 5 * 60 * 1000;
    OWNER_EMAILS.forEach(email => ensureProtectedAccountNotBanned(email));

    let bannedData = {};
    try {
        const bannedSnapshot = await database.ref('banned').once('value');
        bannedData = bannedSnapshot.val() || {};
    } catch (e) { console.warn('Could not read /banned:', e.message); }
    const bannedEmails = Object.keys(bannedData).map(key => key.replace(/_/g, '.'));

    let firebaseUsers = {};
    try {
        const usersSnapshot = await database.ref('users').once('value');
        firebaseUsers = usersSnapshot.val() || {};
    } catch (e) { console.warn('Cannot read /users from Firebase. Falling back to localStorage.'); }

    const allEmails = new Set([...Object.keys(users)]);
    Object.keys(firebaseUsers).forEach(key => allEmails.add(key.replace(/_/g, '.')));
    OWNER_EMAILS.forEach(e => allEmails.add(e));
    ADMIN_EMAILS.forEach(e => allEmails.add(e));
    bannedEmails.forEach(email => allEmails.add(email));

    adminUsersDiv.innerHTML = '';
    const usersList = Array.from(allEmails).map(email => {
        const userKey = email.replace(/\./g, '_');
        const lastActive = firebaseUsers[userKey]?.lastActive || 0;
        const isOnline = lastActive > 0 && (now - lastActive) < FIVE_MINUTES;
        const isBannedUser = bannedEmails.includes(email);
        const displayName = users[email]?.username || email.split('@')[0];
        const isPrime = primeMembers[userKey] === true;
        return { email, displayName, lastActive, isOnline, isBannedUser, isPrime, isProtected: isProtectedAccount(email), isAdminUser: isAdminAccount(email) };
    });

    usersList.sort((a, b) => {
        if (a.isProtected !== b.isProtected) return a.isProtected ? -1 : 1;
        if (a.isAdminUser !== b.isAdminUser) return a.isAdminUser ? -1 : 1;
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        return a.displayName.localeCompare(b.displayName);
    });

    usersList.forEach(user => {
        const userDiv = document.createElement('div');
        userDiv.className = 'admin-user' + (user.isBannedUser ? ' banned' : '');
        const onlineIndicator = user.isOnline
            ? '<span style="color: #43b581; font-size: 20px; margin-right: 5px;">●</span>'
            : '<span style="color: #747f8d; font-size: 20px; margin-right: 5px;">●</span>';
        let badges = '';
        if (user.isProtected) badges = ' <span class="badge owner-badge">Owner</span>';
        else if (user.isAdminUser) badges = ' <span class="badge admin-badge">Admin</span>';
        else if (user.isPrime) badges = ' <span class="badge prime-badge">⭐ Prime</span>';
        let banButtonHtml = '';
        if (!user.isProtected) {
            if (isOwner) {
                banButtonHtml = `<button class="${user.isBannedUser ? 'unban-btn' : 'ban-btn'}" onclick="toggleBan('${user.email}')">${user.isBannedUser ? 'Unban' : 'Ban'}</button>`;
            } else if (isAdmin && !user.isAdminUser) {
                banButtonHtml = `<button class="${user.isBannedUser ? 'unban-btn' : 'ban-btn'}" onclick="toggleBan('${user.email}')">${user.isBannedUser ? 'Unban' : 'Ban'}</button>`;
            }
        }
        let primeButtonHtml = '';
        if (isOwner && !user.isProtected && !user.isAdminUser) {
            primeButtonHtml = `<button style="background:${user.isPrime ? '#f59e0b' : '#6366f1'}; color:white; padding:8px 12px; border:none; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600; transition:all 0.2s;" onclick="togglePrimeMember('${user.email}')">${user.isPrime ? '⭐ Remove Prime' : '⭐ Grant Prime'}</button>`;
        }
        let dmButtonHtml = '';
        if (isOwner && !user.isProtected) {
            dmButtonHtml = `<button style="background:#10b981;color:white;padding:8px 12px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;" onclick="openDmModal('${user.email}', '${user.displayName}', '')">💬 DM</button>`;
        }
        userDiv.innerHTML = `
            <div class="admin-user-name" onclick="viewUserActivity('${user.email}')">
                ${onlineIndicator}${user.displayName}${badges}${user.isBannedUser ? ' <small>(BANNED)</small>' : ''}
            </div>
            <div class="admin-user-buttons">
                <button class="view-activity-btn" onclick="viewUserActivity('${user.email}')">View Activity</button>
                ${banButtonHtml}
                ${primeButtonHtml}
                ${dmButtonHtml}
                ${isOwner && !user.isProtected ? `<button class="delete-account-btn" onclick="deleteAccount('${user.email}')">Delete Account</button>` : ''}
            </div>
        `;
        adminUsersDiv.appendChild(userDiv);
    });

    const onlineCount = usersList.filter(u => u.isOnline).length;
    const totalCount = usersList.length;
    const summaryDiv = document.createElement('div');
    summaryDiv.style.cssText = 'padding: 10px; text-align: center; color: var(--text-muted); font-size: 13px; border-top: 1px solid var(--border-color); margin-top: 10px;';
    summaryDiv.textContent = `${onlineCount} online • ${totalCount} total users`;
    adminUsersDiv.appendChild(summaryDiv);
}

function toggleBan(email) {
    if (!isOwner && !isAdmin) return;
    if (isProtectedAccount(email)) { alert('Cannot ban owner account!'); ensureProtectedAccountNotBanned(email); return; }
    if (isAdminAccount(email) && !isOwner) { alert('Only owners can ban admin accounts!'); return; }
    const userKey = email.replace(/\./g, '_');
    database.ref('banned/' + userKey).once('value', (snapshot) => {
        if (snapshot.exists() && snapshot.val() === true) {
            database.ref('banned/' + userKey).remove().then(() => {
                if (userStrikes[email]) { delete userStrikes[email]; localStorage.setItem('userStrikes', JSON.stringify(userStrikes)); }
                loadAdminPanel();
            });
        } else {
            database.ref('banned/' + userKey).set(true).then(() => loadAdminPanel());
        }
    });
}

function deleteAccount(email) {
    if (!isOwner) return;
    if (isProtectedAccount(email) || isAdminAccount(email)) { alert('Cannot delete owner or admin accounts!'); return; }
    if (confirm(`Are you sure you want to permanently delete the account for ${email}?\n\nThis will:\n- Delete their user data\n- Delete all their messages\n- Remove them from the system\n\nThis action CANNOT be undone!`)) {
        const userKey = email.replace(/\./g, '_');
        const displayName = users[email]?.username || email.split('@')[0];
        if (users[email]) { delete users[email]; localStorage.setItem('users', JSON.stringify(users)); }
        localStorage.removeItem('termsAccepted_' + email);
        localStorage.removeItem('termsAcceptedDate_' + email);
        if (userStrikes[email]) { delete userStrikes[email]; localStorage.setItem('userStrikes', JSON.stringify(userStrikes)); }
        database.ref('users/' + userKey).remove();
        database.ref('banned/' + userKey).remove();
        database.ref('primeMembers/' + userKey).remove();
        database.ref('dms/' + userKey).remove();
        const allChannels = ['homework help', 'teacher complaints', 'study hall', 'science lab'];
        Object.keys(customChannels).forEach(ch => allChannels.push(ch));
        allChannels.forEach(channel => {
            database.ref('messages/' + channel).once('value', (snapshot) => {
                snapshot.forEach(child => {
                    const msg = child.val();
                    if (msg.email === email || msg.user === displayName) database.ref('messages/' + channel + '/' + child.key).remove();
                });
            });
        });
        alert(`Account for ${email} has been permanently deleted.`);
        loadAdminPanel();
    }
}

function checkBanStatus() {
    return new Promise((resolve, reject) => {
        if (isProtectedAccount(currentUser)) { isBanned = false; resolve(); return; }
        const userKey = currentUser.replace(/\./g, '_');
        database.ref('banned/' + userKey).once('value')
            .then((snapshot) => { isBanned = snapshot.exists() && snapshot.val() === true; resolve(); })
            .catch((error) => reject(error));
    });
}

// ─── USER ACTIVITY ────────────────────────────────────────────────────────────

function viewUserActivity(email) {
    if (!isOwner && !isAdmin) return;
    const username = users[email]?.username || email.split('@')[0];
    document.getElementById('activityUserName').textContent = username;
    document.getElementById('activityUserEmail').textContent = email;
    const allChannels = ['homework help', 'teacher complaints', 'study hall', 'science lab'];
    Object.keys(customChannels).forEach(ch => allChannels.push(ch));
    const activityList = document.getElementById('activityChannelsList');
    activityList.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">Loading...</div>';
    document.getElementById('userActivityModal').classList.add('show');
    Promise.all(allChannels.map(ch => {
        return database.ref('messages/' + ch).once('value').then(snapshot => {
            const messages = [];
            snapshot.forEach(child => {
                const msg = child.val();
                if (msg.user === username || msg.email === email) messages.push({ ...msg, id: child.key });
            });
            return { channelName: ch, messages };
        });
    })).then(results => {
        activityList.innerHTML = '';
        const channelsWithMessages = results.filter(r => r.messages.length > 0);
        if (channelsWithMessages.length === 0) {
            activityList.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:30px; font-style:italic;">No messages found</div>';
            return;
        }
        channelsWithMessages.forEach(result => {
            const section = document.createElement('div');
            section.className = 'channel-section';
            const header = document.createElement('div');
            header.className = 'channel-section-header';
            header.innerHTML = `<span># ${result.channelName}</span><span class="message-count">${result.messages.length}</span>`;
            const msgs = document.createElement('div');
            msgs.className = 'channel-messages';
            msgs.style.display = 'none';
            result.messages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).forEach(msg => {
                const item = document.createElement('div');
                item.className = 'user-message-item';
                const date = new Date(msg.timestamp);
                item.innerHTML = `<div class="message-meta">${date.toLocaleDateString()} ${date.toLocaleTimeString()}</div><div class="message-content">${msg.text}</div>`;
                msgs.appendChild(item);
            });
            header.onclick = () => msgs.style.display = msgs.style.display === 'none' ? 'block' : 'none';
            section.appendChild(header);
            section.appendChild(msgs);
            activityList.appendChild(section);
        });
    });
}

function closeUserActivityModal() { document.getElementById('userActivityModal').classList.remove('show'); }

// ─── HELP MODAL ───────────────────────────────────────────────────────────────

function openHelpModal() { document.getElementById('helpModal').classList.add('show'); }
function closeHelpModal() { document.getElementById('helpModal').classList.remove('show'); }

function reportBullying() {
    const username = prompt('Who is bullying you? (Enter their username)');
    if (username) {
        const details = prompt('Please describe what happened (optional):');
        const displayName = users[currentUser]?.username || currentUser.split('@')[0];
        database.ref('reports').push({ reporter: displayName, reporterEmail: currentUser, message: `Reported ${username} for bullying. ${details ? 'Details: ' + details : ''}`, timestamp: Date.now() });
        alert('Report submitted. An admin will review it.');
        closeHelpModal();
    }
}

function reportProblem() {
    const problem = prompt('Please describe the problem:');
    if (problem) {
        const displayName = users[currentUser]?.username || currentUser.split('@')[0];
        database.ref('reports').push({ reporter: displayName, reporterEmail: currentUser, message: `Problem: ${problem}`, timestamp: Date.now() });
        alert('Problem reported. An admin will look into it.');
        closeHelpModal();
    }
}

function contactAdmin() {
    const message = prompt('Message to admin:');
    if (message) {
        const displayName = users[currentUser]?.username || currentUser.split('@')[0];
        database.ref('reports').push({ reporter: displayName, reporterEmail: currentUser, message: `Message: ${message}`, timestamp: Date.now() });
        alert('Message sent to admin.');
        closeHelpModal();
    }
}

// ─── OWNER ACTIONS ────────────────────────────────────────────────────────────

function resetAllMessages() {
    if (!isOwner) return;
    if (confirm('⚠️ WARNING: This will delete ALL messages from ALL channels. Are you sure?')) {
        if (confirm('This action cannot be undone. Continue?')) {
            database.ref('messages').remove().then(() => { alert('All messages have been deleted.'); loadMessages(); });
        }
    }
}

function postAnnouncement() {
    if (!isOwner) return;
    const text = document.getElementById('newAnnouncement').value.trim();
    if (!text) { alert('Please enter an announcement text'); return; }
    database.ref('announcement').set({ text, timestamp: Date.now(), postedBy: currentUser }).then(() => {
        document.getElementById('newAnnouncement').value = '';
        alert('Announcement posted!');
        showAnnouncementBanner(text);
    });
}

function clearAnnouncement() {
    if (!isOwner) return;
    if (confirm('Clear the current announcement?')) {
        database.ref('announcement').remove().then(() => {
            document.getElementById('announcementsBanner').classList.remove('show');
            document.getElementById('currentAnnouncementText').textContent = 'None';
            alert('Announcement cleared');
        });
    }
}

function dismissAnnouncement() { document.getElementById('announcementsBanner').classList.remove('show'); }

function showAnnouncementBanner(text) {
    document.getElementById('announcementText').textContent = text;
    document.getElementById('announcementsBanner').classList.add('show');
    document.getElementById('currentAnnouncementText').textContent = text;
}

function loadAnnouncement() {
    database.ref('announcement').on('value', (snapshot) => {
        if (snapshot.exists()) {
            showAnnouncementBanner(snapshot.val().text);
        } else {
            document.getElementById('announcementsBanner').classList.remove('show');
            if (isOwner) document.getElementById('currentAnnouncementText').textContent = 'None';
        }
    });
}