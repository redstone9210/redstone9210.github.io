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

let currentUser = null, currentChannel = 'room 1', currentChannelTopic = '';
let isOwner = false, isAdmin = false, isModerator = false, isBanned = false;
let isSignupMode = true, banListener = null, maintenanceListener = null;
let blockedUsers = [], customChannels = {}, reports = {};
let isMaintenanceMode = false;

const OWNER_EMAILS = ['redstoneb3@gmail.com', 'haventeam3@gmail.com'];
const ADMIN_EMAILS = ['work.redstoneb5@gmail.com', '31christianhwang@usd266.com'];
const MAINTENANCE_PASSWORD = 'owner123';
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

// Banned channel name words
const BANNED_CHANNEL_WORDS = ['fuck', 'shit', 'bitch', 'ass', 'damn', 'nigger', 'nigga', 'nazi', 'hitler', 'porn', 'sex', 'nsfw'];

let users = JSON.parse(localStorage.getItem('users') || '{}');
let userStrikes = JSON.parse(localStorage.getItem('userStrikes') || '{}');
let bannedWords = ['fuck', 'shit', 'damn', 'hell', 'ass', 'bitch', 'bastard', 'crap'];
const racistSlurs = ['nigger', 'nigga', 'chink', 'spic', 'kike', 'wetback', 'raghead'];

// Only owners are protected from bans
function isProtectedAccount(email) {
    return OWNER_EMAILS.includes(email);
}

function isAdminAccount(email) {
    return ADMIN_EMAILS.includes(email);
}

// Only ensures owners cannot be banned
function ensureProtectedAccountNotBanned(email) {
    return new Promise((resolve) => {
        if (!isProtectedAccount(email)) {
            resolve();
            return;
        }
        const userKey = email.replace(/\./g, '_');
        database.ref('banned/' + userKey).remove().then(() => {
            if (userStrikes[email]) {
                delete userStrikes[email];
                localStorage.setItem('userStrikes', JSON.stringify(userStrikes));
            }
            if (currentUser === email) {
                isBanned = false;
            }
            resolve();
        }).catch(() => resolve());
    });
}

function checkUserRole(email) {
    if (isProtectedAccount(email)) {
        ensureProtectedAccountNotBanned(email);
        return 'owner';
    } else if (isAdminAccount(email)) {
        return 'admin';
    }
    return 'user';
}

function toggleCollapsible(contentId) {
    const content = document.getElementById(contentId);
    const header = event.currentTarget;
    content.classList.toggle('collapsed');
    header.classList.toggle('collapsed');
}

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
        reportsList.innerHTML = '<div style="text-align:center; color:#949ba4; padding:20px; font-style:italic;">No reports</div>';
        reportsBadge.classList.add('hidden');
        return;
    }
    
    reportsBadge.textContent = reportsArray.length;
    reportsBadge.classList.remove('hidden');
    reportsList.innerHTML = '';
    
    reportsArray.sort((a, b) => b.timestamp - a.timestamp).forEach(report => {
        const date = new Date(report.timestamp);
        const timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        let content = `<strong>${report.reporter}</strong>: ${report.message}`;
        
        const reportDiv = document.createElement('div');
        reportDiv.className = 'report-item';
        reportDiv.innerHTML = `
            <div class="report-header">
                <span class="report-type">HELP REQUEST</span>
                <span class="report-time">${timeStr}</span>
            </div>
            <div class="report-content">${content}</div>
            <button class="report-dismiss" onclick="dismissReport('${report.id}')">Dismiss</button>
        `;
        reportsList.appendChild(reportDiv);
    });
}

function dismissReport(reportId) {
    if (isOwner || isAdmin) database.ref('reports/' + reportId).remove();
}

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
    
    if (Object.keys(customChannels).length === 0) {
        section.classList.add('hidden');
        return;
    }
    
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
    
    if (!name) {
        errorEl.textContent = 'Please enter a channel name';
        errorEl.classList.remove('hidden');
        return;
    }
    if (!/^[a-z0-9_-]+$/.test(name)) {
        errorEl.textContent = 'Only letters, numbers, hyphens, and underscores allowed';
        errorEl.classList.remove('hidden');
        return;
    }
    
    // Check for banned words in channel name
    const hasBannedWord = BANNED_CHANNEL_WORDS.some(word => name.includes(word));
    if (hasBannedWord) {
        errorEl.textContent = 'Channel name contains inappropriate content';
        errorEl.classList.remove('hidden');
        return;
    }
    
    const defaults = ['room 1', 'room 2', 'room 3', 'room 4'];
    if (defaults.includes(name) || customChannels[name]) {
        errorEl.textContent = 'Channel already exists';
        errorEl.classList.remove('hidden');
        return;
    }
    
    database.ref('customChannels/' + name).set({
        name, topic: topic || '', createdBy: currentUser, createdAt: Date.now()
    }).then(() => closeCreateChannelModal());
}

function deleteChannel(event, name) {
    event.stopPropagation();
    if (!isAdmin && !isOwner && !isModerator) return;
    if (confirm(`Delete #${name}? All messages will be lost.`)) {
        database.ref('customChannels/' + name).remove();
        database.ref('messages/' + name).remove();
        if (currentChannel === name) switchChannel('room 1', '');
    }
}

function switchChannel(channel, topic) {
    currentChannel = channel;
    currentChannelTopic = topic || '';
    document.getElementById('chatHeader').textContent = channel;
    document.getElementById('chatTopic').textContent = topic || '';
    document.getElementById('messageInput').placeholder = `Message #${channel}`;
    document.querySelectorAll('.channel').forEach(ch => ch.classList.remove('active'));
    event.target.closest('.channel').classList.add('active');
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
    if (bannedWords.includes(word)) {
        alert('Word already banned');
        return;
    }
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

function setupMaintenanceListener() {
    maintenanceListener = database.ref('maintenance');
    maintenanceListener.on('value', (snapshot) => {
        const maintenanceActive = snapshot.exists() && snapshot.val() === true;
        isMaintenanceMode = maintenanceActive;
        
        updateMaintenanceUI(maintenanceActive);
        
        if (maintenanceActive && !isOwner && !isAdmin) {
            showMaintenanceScreen();
        }
    });
}

function updateMaintenanceUI(active) {
    const banner = document.getElementById('maintenanceActiveBanner');
    const toggleBtn = document.getElementById('maintenanceToggleBtn');
    
    if (active) {
        if (isOwner || isAdmin) {
            banner.classList.add('show');
        }
        if (toggleBtn) {
            toggleBtn.textContent = '✅ Disable Maintenance';
            toggleBtn.classList.add('active');
        }
    } else {
        banner.classList.remove('show');
        if (toggleBtn) {
            toggleBtn.textContent = '🔧 Enable Maintenance';
            toggleBtn.classList.remove('active');
        }
    }
}

function toggleMaintenanceMode() {
    if (!isOwner) return;
    
    database.ref('maintenance').once('value', (snapshot) => {
        const currentState = snapshot.exists() && snapshot.val() === true;
        
        if (currentState) {
            if (confirm('Disable maintenance mode? All users will be able to access the chat.')) {
                database.ref('maintenance').set(false).then(() => {
                    alert('Maintenance mode disabled!');
                });
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

function closeMaintenanceModal() {
    document.getElementById('maintenanceModal').classList.remove('show');
}

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

window.onload = function() {
    const savedUser = localStorage.getItem('loggedInUser');
    
    if (savedUser && !checkLoginExpiration()) {
        // Check if user has accepted terms FIRST before doing anything else
        const termsAccepted = localStorage.getItem('termsAccepted_' + savedUser);
        
        if (!termsAccepted) {
            // User hasn't accepted terms - redirect immediately
            window.location.href = 'terms.html';
            return;
        }
        
        // User has accepted terms - proceed with normal login flow
        currentUser = savedUser;
        const role = checkUserRole(currentUser);
        isOwner = (role === 'owner');
        isAdmin = (role === 'owner' || role === 'admin');
        
        ensureProtectedAccountNotBanned(currentUser).then(() => {
            return checkBanStatus();
        }).then(() => {
            if (!isBanned) {
                return database.ref('maintenance').once('value');
            }
        }).then((snapshot) => {
            if (snapshot) {
                const maintenanceActive = snapshot.exists() && snapshot.val() === true;
                isMaintenanceMode = maintenanceActive;
                
                if (maintenanceActive && !isOwner && !isAdmin) {
                    showMaintenanceScreen();
                } else {
                    updateLastActivity();
                    showChat();
                    setupMaintenanceListener();
                }
            }
        });
    } else {
        // No saved user or login expired
        localStorage.removeItem('loggedInUser');
        localStorage.removeItem('lastLoginTime');
        updateAuthUI();
    }
    loadCustomSettings();
};

function toggleAuthMode() {
    isSignupMode = !isSignupMode;
    updateAuthUI();
    clearAuthMessages();
}

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

function handleAuth() {
    isSignupMode ? signup() : login();
}

function signup() {
    const username = document.getElementById('usernameInput').value.trim();
    const email = document.getElementById('emailInput').value.trim();
    const password = document.getElementById('passwordInput').value;
    const confirmPassword = document.getElementById('confirmPasswordInput').value;
    
    if (!username || !email || !password || !confirmPassword) {
        showError('Please fill in all fields');
        return;
    }
    if (password !== confirmPassword) {
        showError('Passwords do not match');
        return;
    }
    if (password.length < 6) {
        showError('Password must be at least 6 characters');
        return;
    }
    if (users[email]) {
        showError('Email already registered');
        return;
    }
    if (Object.values(users).some(u => u.username.toLowerCase() === username.toLowerCase())) {
        showError('Username taken');
        return;
    }
    
    users[email] = { username, password, createdAt: new Date().toISOString() };
    localStorage.setItem('users', JSON.stringify(users));
    database.ref('users/' + email.replace(/\./g, '_')).set({
        username, createdAt: new Date().toISOString()
    });
    
    // Set logged in user but DON'T set terms acceptance
    localStorage.setItem('loggedInUser', email);
    localStorage.setItem('lastLoginTime', Date.now().toString());
    
    showSuccess('Account created! Redirecting to terms...');
    setTimeout(() => {
        // Redirect to terms page - user hasn't accepted yet
        window.location.href = 'terms.html';
    }, 1000);
}

function login() {
    const email = document.getElementById('emailInput').value.trim();
    const password = document.getElementById('passwordInput').value;
    
    if (!email || !password) {
        showError('Please enter email and password');
        return;
    }
    if (!users[email]) {
        showError('Account not found');
        return;
    }
    if (users[email].password !== password) {
        showError('Invalid password');
        return;
    }
    
    // Set current user and save to localStorage
    currentUser = email;
    localStorage.setItem('loggedInUser', email);
    localStorage.setItem('lastLoginTime', Date.now().toString());
    
    // Check if user has accepted terms BEFORE proceeding
    const termsAccepted = localStorage.getItem('termsAccepted_' + email);
    
    if (!termsAccepted) {
        // User hasn't accepted terms - redirect immediately
        window.location.href = 'terms.html';
        return;
    }
    
    // User has accepted terms - continue with normal login flow
    const role = checkUserRole(currentUser);
    isOwner = (role === 'owner');
    isAdmin = (role === 'owner' || role === 'admin');
    
    ensureProtectedAccountNotBanned(currentUser).then(() => {
        return checkBanStatus();
    }).then(() => {
        return database.ref('maintenance').once('value');
    }).then((snapshot) => {
        const maintenanceActive = snapshot.exists() && snapshot.val() === true;
        if (maintenanceActive && !isOwner && !isAdmin) {
            showMaintenanceScreen();
        } else {
            showChat();
            setupMaintenanceListener();
        }
    });
}

function showChat() {
    if (isProtectedAccount(currentUser)) {
        isBanned = false;
    }
    if (isBanned) {
        showBannedScreen();
        return;
    }
    
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('chatContainer').style.display = 'flex';
    document.getElementById('bannedScreen').classList.remove('show');
    document.getElementById('maintenanceScreen').classList.remove('show');
    
    const displayName = users[currentUser]?.username || currentUser.split('@')[0];
    let badge = '';
    
    if (isOwner) {
        badge = '<span class="badge owner-badge">Owner</span>';
        document.getElementById('adminPanelHeader').textContent = 'OWNER PANEL';
        document.getElementById('adminPanelHeader').classList.add('owner-header');
    } else if (isAdmin) {
        badge = '<span class="badge admin-badge">Admin</span>';
        document.getElementById('adminPanelHeader').textContent = 'ADMIN PANEL';
    }
    document.getElementById('currentUser').innerHTML = displayName + badge;
    
    // Set up ban listener for non-protected accounts (admins CAN be banned now by owners)
    if (!isProtectedAccount(currentUser)) {
        banListener = database.ref('banned/' + currentUser.replace(/\./g, '_'));
        banListener.on('value', (snapshot) => {
            if (snapshot.exists() && snapshot.val() === true) {
                isBanned = true;
                showBannedScreen();
            }
        });
    }
    
    // Both owners and admins get admin panel access with full features except owner controls
    if (isOwner || isAdmin) {
        document.getElementById('adminPanel').classList.add('show');
        loadAdminPanel();
        loadReports();
        document.getElementById('reportsSection').classList.remove('hidden');
        
        // Both owners and admins get banned words section
        document.getElementById('bannedWordsSection').classList.remove('hidden');
        loadBannedWordsList();
        
        // Owner-only controls (maintenance, reset messages, unban tool)
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
    }
    
    blockedUsers = JSON.parse(localStorage.getItem('blockedUsers_' + currentUser) || '[]');
    updateLastActivity();
    loadCustomSettings();
    loadMessages();
    setInterval(updateLastActivity, 60000);
}

function showBannedScreen() {
    if (isProtectedAccount(currentUser)) {
        isBanned = false;
        return;
    }
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
    localStorage.removeItem('loggedInUser');
    localStorage.removeItem('lastLoginTime');
    location.reload();
}

function checkLoginExpiration() {
    const lastLogin = localStorage.getItem('lastLoginTime');
    if (!lastLogin) return true;
    return (Date.now() - parseInt(lastLogin)) > THREE_DAYS_MS;
}

function updateLastActivity() {
    localStorage.setItem('lastLoginTime', Date.now().toString());
    if (currentUser) {
        database.ref('users/' + currentUser.replace(/\./g, '_') + '/lastActive').set(Date.now());
    }
}

function loadMessages() {
    const messagesDiv = document.getElementById('messages');
    messagesDiv.innerHTML = '';
    database.ref('messages/' + currentChannel).off();
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
    const time = new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const canDelete = isAdmin || isOwner || isModerator;
    
    messageEl.innerHTML = `
        <div class="message-avatar" onclick="viewUserActivity('${msg.email}')" title="Click to view activity">${initial}</div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-username" onclick="viewUserActivity('${msg.email}')">${msg.user}</span>
                <span class="message-time">${time}</span>
            </div>
            <div class="message-text">${msg.text}</div>
        </div>
        ${canDelete ? `<div class="message-buttons">
            <button class="message-btn" onclick="deleteMessage('${messageId}')" title="Delete">🗑️</button>
        </div>` : ''}
    `;
    messagesDiv.appendChild(messageEl);
}

function deleteMessage(messageId) {
    if (!isAdmin && !isOwner && !isModerator) return;
    if (confirm('Delete this message?')) {
        database.ref('messages/' + currentChannel + '/' + messageId).remove();
    }
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
        database.ref('messages/' + currentChannel).push({
            user: displayName, email: currentUser, text, timestamp: new Date().toISOString()
        });
        input.value = '';
        return;
    }
    
    if (isBanned) {
        alert('You are banned');
        input.value = '';
        return;
    }
    
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
    database.ref('messages/' + currentChannel).push({
        user: displayName, email: currentUser, text, timestamp: new Date().toISOString()
    });
    input.value = '';
}

function loadAdminPanel() {
    const adminUsersDiv = document.getElementById('adminUsers');
    adminUsersDiv.innerHTML = '';
    const now = Date.now();
    
    // Only ensure owners are not banned
    OWNER_EMAILS.forEach(email => ensureProtectedAccountNotBanned(email));
    
    database.ref('banned').once('value', (bannedSnapshot) => {
        const bannedData = bannedSnapshot.val() || {};
        const bannedEmails = Object.keys(bannedData).map(key => key.replace(/_/g, '.'));
        
        database.ref('users').once('value', (snapshot) => {
            const firebaseUsers = snapshot.val() || {};
            const allEmails = new Set([...Object.keys(users)]);
            Object.keys(firebaseUsers).forEach(key => allEmails.add(key.replace(/_/g, '.')));
            bannedEmails.forEach(email => allEmails.add(email));
            
            allEmails.forEach(email => {
                // Owners cannot be in the admin panel user list
                if (isProtectedAccount(email)) return;
                
                const userKey = email.replace(/\./g, '_');
                const lastActive = firebaseUsers[userKey]?.lastActive || 0;
                const isInactive = (now - lastActive) > THREE_DAYS_MS;
                if (isInactive && lastActive !== 0 && !bannedEmails.includes(email)) return;
                
                const isBannedUser = bannedEmails.includes(email);
                const userDiv = document.createElement('div');
                userDiv.className = 'admin-user' + (isBannedUser ? ' banned' : '');
                const displayName = users[email]?.username || email.split('@')[0];
                
                // Check if this is an admin account
                const userIsAdmin = isAdminAccount(email);
                const adminBadge = userIsAdmin ? ' <span class="badge admin-badge">Admin</span>' : '';
                
                // Owners can ban everyone, admins can only ban regular users
                let banButtonHtml = '';
                if (isOwner) {
                    // Owners can ban/unban anyone including admins
                    banButtonHtml = `<button class="${isBannedUser ? 'unban-btn' : 'ban-btn'}" onclick="toggleBan('${email}')">
                        ${isBannedUser ? 'Unban' : 'Ban'}
                    </button>`;
                } else if (isAdmin && !userIsAdmin) {
                    // Admins can only ban/unban regular users
                    banButtonHtml = `<button class="${isBannedUser ? 'unban-btn' : 'ban-btn'}" onclick="toggleBan('${email}')">
                        ${isBannedUser ? 'Unban' : 'Ban'}
                    </button>`;
                }
                
                userDiv.innerHTML = `
                    <div class="admin-user-name" onclick="viewUserActivity('${email}')">${displayName}${adminBadge}${isBannedUser ? ' <small>(BANNED)</small>' : ''}</div>
                    <div class="admin-user-buttons">
                        <button class="view-activity-btn" onclick="viewUserActivity('${email}')">View Activity</button>
                        ${banButtonHtml}
                        ${isOwner ? `<button class="delete-account-btn" onclick="deleteAccount('${email}')">Delete Account</button>` : ''}
                    </div>
                `;
                adminUsersDiv.appendChild(userDiv);
            });
        });
    });
}

function toggleBan(email) {
    if (!isOwner && !isAdmin) return;
    
    // Only owners are protected from bans
    if (isProtectedAccount(email)) {
        alert('Cannot ban owner account!');
        ensureProtectedAccountNotBanned(email);
        return;
    }
    
    // Admins can ban regular users, but only owners can ban admins
    if (isAdminAccount(email) && !isOwner) {
        alert('Only owners can ban admin accounts!');
        return;
    }
    
    const userKey = email.replace(/\./g, '_');
    database.ref('banned/' + userKey).once('value', (snapshot) => {
        if (snapshot.exists() && snapshot.val() === true) {
            database.ref('banned/' + userKey).remove().then(() => {
                if (userStrikes[email]) {
                    delete userStrikes[email];
                    localStorage.setItem('userStrikes', JSON.stringify(userStrikes));
                }
                loadAdminPanel();
            });
        } else {
            database.ref('banned/' + userKey).set(true).then(() => loadAdminPanel());
        }
    });
}

function deleteAccount(email) {
    if (!isOwner) return;
    if (isProtectedAccount(email) || isAdminAccount(email)) {
        alert('Cannot delete owner or admin accounts!');
        return;
    }
    
    if (confirm(`Are you sure you want to permanently delete the account for ${email}?\n\nThis will:\n- Delete their user data\n- Delete all their messages\n- Remove them from the system\n\nThis action CANNOT be undone!`)) {
        const userKey = email.replace(/\./g, '_');
        const displayName = users[email]?.username || email.split('@')[0];
        
        // Delete from local storage
        if (users[email]) {
            delete users[email];
            localStorage.setItem('users', JSON.stringify(users));
        }
        
        // Delete terms acceptance
        localStorage.removeItem('termsAccepted_' + email);
        localStorage.removeItem('termsAcceptedDate_' + email);
        
        // Delete strikes
        if (userStrikes[email]) {
            delete userStrikes[email];
            localStorage.setItem('userStrikes', JSON.stringify(userStrikes));
        }
        
        // Delete from Firebase
        database.ref('users/' + userKey).remove();
        database.ref('banned/' + userKey).remove();
        
        // Delete all messages from this user in all channels
        const allChannels = ['room 1', 'room 2', 'room 3', 'room 4'];
        Object.keys(customChannels).forEach(ch => allChannels.push(ch));
        
        allChannels.forEach(channel => {
            database.ref('messages/' + channel).once('value', (snapshot) => {
                snapshot.forEach(child => {
                    const msg = child.val();
                    if (msg.email === email || msg.user === displayName) {
                        database.ref('messages/' + channel + '/' + child.key).remove();
                    }
                });
            });
        });
        
        alert(`Account for ${email} has been permanently deleted.`);
        loadAdminPanel();
    }
}

function checkBanStatus() {
    return new Promise((resolve) => {
        if (isProtectedAccount(currentUser)) {
            isBanned = false;
            resolve();
            return;
        }
        const userKey = currentUser.replace(/\./g, '_');
        database.ref('banned/' + userKey).once('value', (snapshot) => {
            if (snapshot.exists() && snapshot.val() === true) isBanned = true;
            resolve();
        });
    });
}

function viewUserActivity(email) {
    if (!isOwner && !isAdmin) return;
    const username = users[email]?.username || email.split('@')[0];
    document.getElementById('activityUserName').textContent = username;
    document.getElementById('activityUserEmail').textContent = email;
    
    const allChannels = ['room 1', 'room 2', 'room 3', 'room 4'];
    Object.keys(customChannels).forEach(ch => allChannels.push(ch));
    
    const activityList = document.getElementById('activityChannelsList');
    activityList.innerHTML = '<div style="text-align:center; color:#949ba4; padding:20px;">Loading...</div>';
    document.getElementById('userActivityModal').classList.add('show');
    
    Promise.all(allChannels.map(ch => {
        return database.ref('messages/' + ch).once('value').then(snapshot => {
            const messages = [];
            snapshot.forEach(child => {
                const msg = child.val();
                if (msg.user === username || msg.email === email) {
                    messages.push({ ...msg, id: child.key });
                }
            });
            return { channelName: ch, messages };
        });
    })).then(results => {
        activityList.innerHTML = '';
        const channelsWithMessages = results.filter(r => r.messages.length > 0);
        
        if (channelsWithMessages.length === 0) {
            activityList.innerHTML = '<div style="text-align:center; color:#949ba4; padding:30px; font-style:italic;">No messages found</div>';
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
                item.innerHTML = `
                    <div class="message-meta">${date.toLocaleDateString()} ${date.toLocaleTimeString()}</div>
                    <div class="message-content">${msg.text}</div>
                `;
                msgs.appendChild(item);
            });
            
            header.onclick = () => msgs.style.display = msgs.style.display === 'none' ? 'block' : 'none';
            section.appendChild(header);
            section.appendChild(msgs);
            activityList.appendChild(section);
        });
    });
}

function closeUserActivityModal() {
    document.getElementById('userActivityModal').classList.remove('show');
}

function openHelpModal() {
    document.getElementById('helpModal').classList.add('show');
}

function closeHelpModal() {
    document.getElementById('helpModal').classList.remove('show');
}

function reportBullying() {
    const username = prompt('Who is bullying you? (Enter their username)');
    if (username) {
        const details = prompt('Please describe what happened (optional):');
        const displayName = users[currentUser]?.username || currentUser.split('@')[0];
        database.ref('reports').push({
            reporter: displayName,
            reporterEmail: currentUser,
            message: `Reported ${username} for bullying. ${details ? 'Details: ' + details : ''}`,
            timestamp: Date.now()
        });
        alert('Report submitted. An admin will review it.');
        closeHelpModal();
    }
}

function reportProblem() {
    const problem = prompt('Please describe the problem:');
    if (problem) {
        const displayName = users[currentUser]?.username || currentUser.split('@')[0];
        database.ref('reports').push({
            reporter: displayName,
            reporterEmail: currentUser,
            message: `Problem: ${problem}`,
            timestamp: Date.now()
        });
        alert('Problem reported. An admin will look into it.');
        closeHelpModal();
    }
}

function contactAdmin() {
    const message = prompt('Message to admin:');
    if (message) {
        const displayName = users[currentUser]?.username || currentUser.split('@')[0];
        database.ref('reports').push({
            reporter: displayName,
            reporterEmail: currentUser,
            message: `Message: ${message}`,
            timestamp: Date.now()
        });
        alert('Message sent to admin.');
        closeHelpModal();
    }
}

function resetAllMessages() {
    if (!isOwner) return;
    if (confirm('⚠️ WARNING: This will delete ALL messages from ALL channels. Are you sure?')) {
        if (confirm('This action cannot be undone. Continue?')) {
            database.ref('messages').remove().then(() => {
                alert('All messages have been deleted.');
                loadMessages();
            });
        }
    }
}

// ADMIN PANEL FUNCTIONS (separate from owner panel)
function loadAdminPanelUsers() {
    const adminUsersDiv = document.getElementById('adminAdminUsers');
    if (!adminUsersDiv) return;
    
    adminUsersDiv.innerHTML = '';
    const now = Date.now();
    
    database.ref('banned').once('value', (bannedSnapshot) => {
        const bannedData = bannedSnapshot.val() || {};
        const bannedEmails = Object.keys(bannedData).map(key => key.replace(/_/g, '.'));
        
        database.ref('users').once('value', (snapshot) => {
            const firebaseUsers = snapshot.val() || {};
            const allEmails = new Set([...Object.keys(users)]);
            Object.keys(firebaseUsers).forEach(key => allEmails.add(key.replace(/_/g, '.')));
            bannedEmails.forEach(email => allEmails.add(email));
            
            allEmails.forEach(email => {
                // Skip owners in admin panel
                if (isProtectedAccount(email)) return;
                
                const userKey = email.replace(/\./g, '_');
                const lastActive = firebaseUsers[userKey]?.lastActive || 0;
                const isInactive = (now - lastActive) > THREE_DAYS_MS;
                if (isInactive && lastActive !== 0 && !bannedEmails.includes(email)) return;
                
                const isBannedUser = bannedEmails.includes(email);
                const userDiv = document.createElement('div');
                userDiv.className = 'admin-user' + (isBannedUser ? ' banned' : '');
                const displayName = users[email]?.username || email.split('@')[0];
                
                const userIsAdmin = isAdminAccount(email);
                const adminBadge = userIsAdmin ? ' <span class="badge admin-badge">Admin</span>' : '';
                
                userDiv.innerHTML = `
                    <div class="admin-user-name" onclick="viewUserActivity('${email}')">${displayName}${adminBadge}${isBannedUser ? ' <small>(BANNED)</small>' : ''}</div>
                    <div class="admin-user-buttons">
                        <button class="view-activity-btn" onclick="viewUserActivity('${email}')">View Activity</button>
                        ${!userIsAdmin ? `<button class="${isBannedUser ? 'unban-btn' : 'ban-btn'}" onclick="toggleBanAdmin('${email}')">
                            ${isBannedUser ? 'Unban' : 'Ban'}
                        </button>` : ''}
                    </div>
                `;
                adminUsersDiv.appendChild(userDiv);
            });
        });
    });
}

function toggleBanAdmin(email) {
    // Admins can only ban regular users
    if (isAdminAccount(email)) {
        alert('Cannot ban other admins!');
        return;
    }
    
    const userKey = email.replace(/\./g, '_');
    database.ref('banned/' + userKey).once('value', (snapshot) => {
        if (snapshot.exists() && snapshot.val() === true) {
            database.ref('banned/' + userKey).remove().then(() => {
                if (userStrikes[email]) {
                    delete userStrikes[email];
                    localStorage.setItem('userStrikes', JSON.stringify(userStrikes));
                }
                loadAdminPanelUsers();
            });
        } else {
            database.ref('banned/' + userKey).set(true).then(() => loadAdminPanelUsers());
        }
    });
}

function loadAdminReports() {
    database.ref('reports').on('value', (snapshot) => {
        const reports = snapshot.exists() ? snapshot.val() : {};
        displayAdminReports(reports);
    });
}

function displayAdminReports(reports) {
    const reportsList = document.getElementById('adminReportsList');
    const reportsBadge = document.getElementById('adminReportsBadge');
    if (!reportsList) return;
    
    const reportsArray = Object.keys(reports).map(key => ({ id: key, ...reports[key] }));
    
    if (reportsArray.length === 0) {
        reportsList.innerHTML = '<div style="text-align:center; color:#949ba4; padding:20px; font-style:italic;">No reports</div>';
        reportsBadge.classList.add('hidden');
        return;
    }
    
    reportsBadge.textContent = reportsArray.length;
    reportsBadge.classList.remove('hidden');
    reportsList.innerHTML = '';
    
    reportsArray.sort((a, b) => b.timestamp - a.timestamp).forEach(report => {
        const date = new Date(report.timestamp);
        const timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        
        const reportDiv = document.createElement('div');
        reportDiv.className = 'report-item';
        reportDiv.innerHTML = `
            <div class="report-header">
                <span class="report-type">HELP REQUEST</span>
                <span class="report-time">${timeStr}</span>
            </div>
            <div class="report-content"><strong>${report.reporter}</strong>: ${report.message}</div>
            <button class="report-dismiss" onclick="dismissReportAdmin('${report.id}')">Dismiss</button>
        `;
        reportsList.appendChild(reportDiv);
    });
}

function dismissReportAdmin(reportId) {
    database.ref('reports/' + reportId).remove();
}

function loadAdminBannedWords() {
    const list = document.getElementById('adminBannedWordsList');
    if (!list) return;
    
    list.innerHTML = '';
    bannedWords.forEach(word => {
        const item = document.createElement('div');
        item.className = 'banned-word-item';
        item.innerHTML = `<span>${word}</span><button class="remove-word-btn" onclick="removeBannedWordAdmin('${word}')">Remove</button>`;
        list.appendChild(item);
    });
}

function addBannedWordAdmin() {
    const word = document.getElementById('adminNewBannedWord').value.trim().toLowerCase();
    if (!word) return;
    if (bannedWords.includes(word)) {
        alert('Word already banned');
        return;
    }
    bannedWords.push(word);
    database.ref('settings/bannedWords').set(bannedWords).then(() => {
        document.getElementById('adminNewBannedWord').value = '';
        loadAdminBannedWords();
    });
}

function removeBannedWordAdmin(word) {
    if (confirm(`Remove "${word}"?`)) {
        bannedWords = bannedWords.filter(w => w !== word);
        database.ref('settings/bannedWords').set(bannedWords).then(() => loadAdminBannedWords());
    }
}