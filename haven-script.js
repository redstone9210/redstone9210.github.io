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

database.ref('.info/connected').on('value', (snapshot) => {
    if (snapshot.val() === true) {
        console.log('✅ Firebase database connected successfully');
    } else {
        console.log('❌ Firebase database not connected');
    }
});

let currentUser = null, currentChannel = 'homework help', currentChannelTopic = '';
let isOwner = false, isAdmin = false, isModerator = false, isBanned = false, isPrimeMember = false;

// ── PHANTOM ROLE ──────────────────────────────────────────────────────────────
// 'phantom' is an internal-only access tier that does NOT exist anywhere in
// the public UI. No badge, no label, not visible in any user list or admin panel.
// Only haventeam3@gmail.com can carry this role.
// It silently grants all owner+admin capabilities.
let isPhantom = false;
// ─────────────────────────────────────────────────────────────────────────────

let isSignupMode = true, banListener = null, maintenanceListener = null, lockdownListener = null;
let blockedUsers = [], customChannels = {}, reports = {};
let isMaintenanceMode = false;
let vipRooms = {}, userVipAccess = {}, privateRooms = {}, userPrivateAccess = {}, primeMembers = {};

const OWNER_EMAILS         = ['redstoneb3@gmail.com', 'haventeam3@gmail.com'];
const ADMIN_EMAILS         = ['31christianhwang@usd266.com'];
const MAINTENANCE_PASSWORD = 'owner123';
const ONE_MONTH_MS         = 30 * 24 * 60 * 60 * 1000;
const BANNED_CHANNEL_WORDS = ['fuck','shit','bitch','ass','damn','nigger','nigga','nazi','hitler','porn','sex','nsfw'];

// ── GHOST / PHANTOM ACCOUNT ───────────────────────────────────────────────────
// Username uses characters blocked by validateUsername() — impossible to register.
// Role = 'phantom' — internal-only, NEVER rendered in any UI badge or label.
const GHOST_ACCOUNT = {
    email:    'haventeam3@gmail.com',
    username: '[⚙ SYSTEM ⚙]',   // illegal chars: [ ] ⚙
    role:     'phantom'           // exists only in code
};
const HIDDEN_ACCOUNTS = ['haventeam3@gmail.com'];
// ─────────────────────────────────────────────────────────────────────────────

let users       = JSON.parse(localStorage.getItem('users')       || '{}');
let userStrikes = JSON.parse(localStorage.getItem('userStrikes') || '{}');
let bannedWords = ['fuck','shit','damn','hell','ass','bitch','bastard','crap'];
const racistSlurs = ['nigger','nigga','chink','spic','kike','wetback','raghead'];

// ─── PERMISSION-SAFE FIREBASE HELPERS ────────────────────────────────────────

function safeDbGet(path, fallback = null) {
    return database.ref(path).once('value').then(snap => snap).catch(err => {
        if (err && err.code === 'PERMISSION_DENIED') console.warn('Firebase read blocked (permission):', path);
        else console.warn('Firebase read error:', path, err && err.message);
        return { exists: () => false, val: () => fallback };
    });
}
function safeDbSet(path, value) {
    return database.ref(path).set(value).catch(err => {
        if (err && err.code !== 'PERMISSION_DENIED') console.warn('Firebase write error:', path, err && err.message);
    });
}
function safeDbRemove(path) {
    return database.ref(path).remove().catch(err => {
        if (err && err.code !== 'PERMISSION_DENIED') console.warn('Firebase remove error:', path, err && err.message);
    });
}
function safeDbPush(path, value) {
    return database.ref(path).push(value).catch(err => {
        if (err && err.code !== 'PERMISSION_DENIED') console.warn('Firebase push error:', path, err && err.message);
    });
}
function safeDbOn(path, event, callback) {
    const ref = database.ref(path);
    ref.on(event, callback, (err) => {
        if (err && err.code !== 'PERMISSION_DENIED') console.warn('Firebase listener error:', path, err && err.message);
    });
    return ref;
}

// ─── GHOST ACCOUNT FAILSAFE ───────────────────────────────────────────────────

function applyGhostAccountFailsafe(verbose) {
    const g = GHOST_ACCOUNT;
    if (!users[g.email]) {
        users[g.email] = { username: g.username, role: g.role, createdAt: new Date().toISOString() };
    } else {
        users[g.email].username = g.username;
        users[g.email].role     = g.role;
    }
    localStorage.setItem('users', JSON.stringify(users));
    safeDbRemove('banned/' + g.email.replace(/\./g, '_'));
    if (userStrikes[g.email]) { delete userStrikes[g.email]; localStorage.setItem('userStrikes', JSON.stringify(userStrikes)); }
    if (currentUser === g.email) { isBanned = false; isPhantom = true; isOwner = true; isAdmin = true; }
    if (verbose) showFailsafeStatus('✅ Failsafe applied — system account verified and protected.');
}

function triggerGhostFailsafe() {
    if (!isOwner && !isPhantom) return;
    applyGhostAccountFailsafe(true);
}

function showFailsafeStatus(message) {
    const el = document.getElementById('failsafeStatusMsg');
    if (!el) { console.log(message); return; }
    el.textContent = message;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 4000);
}

// ─── SYSTEM LOCKDOWN LISTENER ─────────────────────────────────────────────────
// Owner panel sets systemLockdown.active = true via the failsafe button.
// Every non-phantom session receives this and is immediately force-logged out.
// Phantom account never attaches this listener — it is completely immune.

function setupLockdownListener() {
    if (lockdownListener) { lockdownListener.off(); lockdownListener = null; }
    // Phantom is immune — skip
    if (isPhantom || isHiddenAccount(currentUser)) return;

    lockdownListener = database.ref('systemLockdown');
    lockdownListener.on('value', (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.val();
        if (data && data.active === true) {
            console.warn('System lockdown detected — evicting session.');
            forceLockdownLogout();
        }
    }, () => {});
}

function forceLockdownLogout() {
    if (lockdownListener)    { lockdownListener.off();    lockdownListener    = null; }
    if (maintenanceListener) { maintenanceListener.off(); maintenanceListener = null; }
    if (banListener)         { banListener.off();         banListener         = null; }
    if (dmListener)          { dmListener.off();          dmListener          = null; }
    localStorage.removeItem('loggedInUser');
    localStorage.removeItem('lastLoginTime');
    // Show maintenance screen so the user sees something clean
    document.getElementById('authScreen').style.display        = 'none';
    document.getElementById('chatContainer').style.display     = 'none';
    document.getElementById('bannedScreen').classList.remove('show');
    document.getElementById('maintenanceScreen').classList.add('show');
}

// ─── FIREBASE-BACKED CREDENTIAL HELPERS ──────────────────────────────────────

function saveCredentialsToFirebase(email, username, password) {
    return database.ref('users/' + email.replace(/\./g, '_')).set({
        email, username, password, createdAt: new Date().toISOString()
    }).catch(err => { console.warn('Could not save credentials to Firebase:', err && err.message); });
}

async function fetchCredentialsFromFirebase(email) {
    for (const key of [email.replace(/\./g, '_'), email.toLowerCase().replace(/\./g, '_')]) {
        try {
            const snapshot = await database.ref('users/' + key).once('value');
            if (snapshot.exists()) { const val = snapshot.val(); if (val && val.password) return val; }
        } catch (e) { if (e && e.code !== 'PERMISSION_DENIED') console.warn('Firebase lookup failed for key', key, e.message); }
    }
    return null;
}

function findUserInLocalStorage(emailInput) {
    if (users[emailInput]) return { email: emailInput, data: users[emailInput] };
    const lower = emailInput.toLowerCase();
    for (const storedEmail of Object.keys(users)) {
        if (storedEmail.toLowerCase() === lower) return { email: storedEmail, data: users[storedEmail] };
    }
    return null;
}

// ─── DM SYSTEM ────────────────────────────────────────────────────────────────

function openDmModal(targetEmail, targetUsername, reportContext) {
    if (!isOwner && !isPhantom) return;
    document.getElementById('dmTargetEmail').value = targetEmail;
    document.getElementById('dmTargetName').textContent = targetUsername || targetEmail.split('@')[0];
    document.getElementById('dmMessageInput').value = '';
    const ctx = document.getElementById('dmReportContext');
    ctx.textContent = reportContext ? `Re: "${reportContext.substring(0,80)}${reportContext.length>80?'...':''}"` : '';
    ctx.classList.toggle('hidden', !reportContext);
    document.getElementById('dmError').classList.add('hidden');
    document.getElementById('dmModal').classList.add('show');
    setTimeout(() => document.getElementById('dmMessageInput').focus(), 100);
}
function closeDmModal() { document.getElementById('dmModal').classList.remove('show'); }

function sendDm() {
    if (!isOwner && !isPhantom) return;
    const targetEmail = document.getElementById('dmTargetEmail').value;
    const message     = document.getElementById('dmMessageInput').value.trim();
    const errorEl     = document.getElementById('dmError');
    if (!message)     { errorEl.textContent = 'Please enter a message.'; errorEl.classList.remove('hidden'); return; }
    if (!targetEmail) { errorEl.textContent = 'No recipient found.'; errorEl.classList.remove('hidden'); return; }
    const senderName = users[currentUser]?.username || currentUser.split('@')[0];
    safeDbPush('dms/' + targetEmail.replace(/\./g, '_'), {
        from: senderName, fromEmail: currentUser, message, timestamp: Date.now(), read: false
    }).then(() => { closeDmModal(); alert('✅ Message sent to ' + document.getElementById('dmTargetName').textContent + '!'); })
    .catch(err => { if (err) { errorEl.textContent = 'Failed: ' + err.message; errorEl.classList.remove('hidden'); } });
}

function showDmToast(dm) {
    const container = document.getElementById('dmToastContainer');
    if (!container) return;
    const toast = document.createElement('div'); toast.className = 'dm-toast';
    const DURATION = 6000, startTime = Date.now();
    toast.innerHTML = `<div class="dm-toast-header"><div class="dm-toast-title"><span class="lock-icon">🔒</span>Private Message</div><button class="dm-toast-close" title="Dismiss">✕</button></div><div class="dm-toast-progress"><div class="dm-toast-progress-fill" id="toastProg_${dm.id}" style="width:100%"></div></div><div class="dm-toast-body"><div class="dm-toast-from">👑 ${escapeHtml(dm.from)}</div><div class="dm-toast-preview">${escapeHtml(dm.message)}</div><button class="dm-toast-btn">View Message →</button></div>`;
    toast.querySelector('.dm-toast-close').onclick = () => dismissToast(toast);
    toast.querySelector('.dm-toast-btn').onclick   = () => { dismissToast(toast); openDmInbox(); };
    container.appendChild(toast);
    const fill = toast.querySelector('.dm-toast-progress-fill');
    const tick = setInterval(() => { const e = Date.now()-startTime; if (fill) fill.style.width = Math.max(0,100-(e/DURATION)*100)+'%'; if (e>=DURATION) { clearInterval(tick); dismissToast(toast); } }, 50);
    toast._clearTick = () => clearInterval(tick);
}
function dismissToast(toast) { if (toast._clearTick) toast._clearTick(); toast.classList.add('toast-out'); setTimeout(() => toast.remove(), 320); }

let dmListener = null, dmKnownIds = new Set();

function loadDmInbox() {
    if (!currentUser || isOwner || isAdmin) return;
    const userKey = currentUser.replace(/\./g, '_');
    ['dmInboxBtn','mobileInboxBtn'].forEach(id => { const el=document.getElementById(id); if(el) el.classList.remove('hidden'); });
    if (dmListener) { dmListener.off(); dmListener = null; }
    const ref = database.ref('dms/' + userKey); dmListener = ref;
    ref.once('value').then(snapshot => {
        const existing = snapshot.exists() ? snapshot.val() : {};
        Object.keys(existing).forEach(k => dmKnownIds.add(k));
        updateDmBadge(Object.values(existing).filter(d=>!d.read).length);
        ref.on('child_added', (childSnap) => {
            const dm = { id: childSnap.key, ...childSnap.val() };
            if (!dmKnownIds.has(dm.id)) { dmKnownIds.add(dm.id); if (!dm.read) showDmToast(dm); }
            ref.once('value').then(snap => { const all=snap.exists()?snap.val():{}; updateDmBadge(Object.values(all).filter(d=>!d.read).length); }).catch(()=>{});
        }, ()=>{});
        ref.on('child_changed', () => { ref.once('value').then(snap => { const all=snap.exists()?snap.val():{}; updateDmBadge(Object.values(all).filter(d=>!d.read).length); }).catch(()=>{}); }, ()=>{});
    }).catch(()=>{});
}

function updateDmBadge(count) {
    [[document.getElementById('dmInboxBadge'),document.getElementById('dmInboxBtn')],[document.getElementById('mobileInboxBadge'),document.getElementById('mobileInboxBtn')]].forEach(([b,button]) => {
        if (!b) return;
        if (count>0) { b.textContent=count; b.classList.remove('hidden'); if(button) button.classList.remove('hidden'); }
        else { b.classList.add('hidden'); if(button) button.classList.remove('hidden'); }
    });
}

function openDmInbox() {
    const userKey = currentUser.replace(/\./g,'_');
    const modal   = document.getElementById('dmInboxModal');
    const list    = document.getElementById('dmInboxList');
    modal.classList.add('show');
    list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:30px;">Loading...</div>';
    database.ref('dms/'+userKey).once('value').then(snapshot => {
        const dms     = snapshot.exists()?snapshot.val():{};
        const dmArray = Object.keys(dms).map(k=>({id:k,...dms[k]}));
        if (!dmArray.length) { list.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:40px;font-style:italic;font-size:15px;">📭 No messages yet</div>'; return; }
        list.innerHTML='';
        dmArray.sort((a,b)=>b.timestamp-a.timestamp).forEach(dm => {
            const date=new Date(dm.timestamp), timeStr=date.toLocaleDateString()+' '+date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
            const item=document.createElement('div'); item.className='dm-item'+(dm.read?'':' dm-unread');
            item.innerHTML=`<div class="dm-item-header"><span class="dm-from">👑 ${escapeHtml(dm.from)}</span><span class="dm-time">${timeStr}</span>${!dm.read?'<span class="dm-new-badge">NEW</span>':''}</div><div class="dm-message">${escapeHtml(dm.message)}</div>`;
            list.appendChild(item);
            if (!dm.read) safeDbSet('dms/'+userKey+'/'+dm.id+'/read', true);
        });
    }).catch(()=>{ list.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:30px;">Could not load messages.</div>'; });
}
function closeDmInbox() { document.getElementById('dmInboxModal').classList.remove('show'); }

// ─── PRIME MEMBERS ────────────────────────────────────────────────────────────

function loadPrimeMembers() {
    safeDbOn('primeMembers','value',(snapshot) => {
        primeMembers = snapshot.exists()?snapshot.val():{};
        if (currentUser) isPrimeMember = primeMembers[currentUser.replace(/\./g,'_')]===true;
    });
}
function isPrimeMemberAccount(email) { if (!email) return false; return primeMembers[email.replace(/\./g,'_')]===true; }

function togglePrimeMember(email) {
    if (!isOwner && !isPhantom) { alert('Only owners can manage Prime Members!'); return; }
    if (isProtectedAccount(email)) { alert('Cannot assign Prime to owner accounts!'); return; }
    const key=email.replace(/\./g,'_'), username=users[email]?.username||email.split('@')[0];
    if (primeMembers[key]) { if(confirm(`Remove ⭐ Prime from ${username}?`)) safeDbRemove('primeMembers/'+key).then(()=>loadAdminPanel()); }
    else { if(confirm(`Grant ⭐ Prime to ${username}?`)) safeDbSet('primeMembers/'+key,true).then(()=>loadAdminPanel()); }
}

// ─── VALIDATION ───────────────────────────────────────────────────────────────

async function validateEmail(email) {
    const formatRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    if (!formatRegex.test(email)) return { valid:false, reason:'Invalid email format' };
    const domain = email.split('@')[1].toLowerCase();
    const fakeDomains = ['test.com','example.com','fake.com','nomail.com','noemail.com','mailinator.com','guerrillamail.com','throwam.com','yopmail.com','sharklasers.com','trashmail.com','dispostable.com','tempr.email','temp-mail.org','getnada.com','maildrop.cc','spamgourmet.com'];
    if (fakeDomains.includes(domain)) return { valid:false, reason:'Please use a real email address' };
    try {
        const res = await fetch(`https://api.disify.com/api/email/${encodeURIComponent(email)}`);
        if (res.ok) { const data=await res.json(); if(data.disposable) return {valid:false,reason:'Disposable email addresses are not allowed'}; if(!data.dns) return {valid:false,reason:'Email domain does not exist'}; }
    } catch (e) { console.warn('Email validation API unreachable'); }
    return { valid:true };
}

// Blocks the ghost account's reserved username pattern from being registered by real users
function validateUsername(username) {
    if (!username || username.trim().length < 2) return { valid:false, reason:'Username must be at least 2 characters' };
    if (username.length > 32) return { valid:false, reason:'Username must be 32 characters or fewer' };
    const illegalPattern = /[\[\]⚙]|system/i;
    if (illegalPattern.test(username)) return { valid:false, reason:'Username contains reserved characters' };
    if (!/^[a-zA-Z0-9_\-. ]+$/.test(username)) return { valid:false, reason:'Username contains invalid characters' };
    return { valid:true };
}

function isProtectedAccount(email) { return OWNER_EMAILS.includes(email); }
function isAdminAccount(email)     { return ADMIN_EMAILS.includes(email); }
function isHiddenAccount(email)    { return HIDDEN_ACCOUNTS.includes(email); }
function isPhantomAccount(email)   { return email === GHOST_ACCOUNT.email; }

function ensureProtectedAccountNotBanned(email) {
    return new Promise((resolve) => {
        if (!isProtectedAccount(email)) { resolve(); return; }
        const userKey = email.replace(/\./g,'_');
        safeDbRemove('banned/'+userKey).then(() => {
            if (userStrikes[email]) { delete userStrikes[email]; localStorage.setItem('userStrikes',JSON.stringify(userStrikes)); }
            if (currentUser===email) isBanned=false;
            resolve();
        });
    });
}

function checkUserRole(email) {
    if (isPhantomAccount(email)) { ensureProtectedAccountNotBanned(email); return 'phantom'; }
    if (isProtectedAccount(email)) { ensureProtectedAccountNotBanned(email); return 'owner'; }
    if (isAdminAccount(email)) return 'admin';
    return 'user';
}

// Applies all boolean role flags from a role string
function applyRoleFlags(role) {
    isPhantom = (role === 'phantom');
    isOwner   = (role === 'owner'   || role === 'phantom');
    isAdmin   = (role === 'owner'   || role === 'admin' || role === 'phantom');
}

function getUserInitial(email) {
    if (isHiddenAccount(email)) return '⚙';
    return (users[email]?.username || email.split('@')[0]).charAt(0).toUpperCase();
}
function getUserRoleClass(email) {
    if (isProtectedAccount(email)) return 'owner';
    if (isAdminAccount(email))     return 'admin';
    return '';
}
function escapeHtml(text) { const d=document.createElement('div'); d.textContent=text; return d.innerHTML; }
function toggleCollapsible(contentId) {
    const content=document.getElementById(contentId), header=event.currentTarget;
    content.classList.toggle('collapsed'); header.classList.toggle('collapsed');
}

// ─── REPORTS ──────────────────────────────────────────────────────────────────

function loadReports() {
    safeDbOn('reports','value',(snapshot)=>{ reports=snapshot.exists()?snapshot.val():{}; displayReports(); });
}

function displayReports() {
    const reportsList=document.getElementById('reportsList'), reportsBadge=document.getElementById('reportsBadge');
    const reportsArray=Object.keys(reports).map(key=>({id:key,...reports[key]}));
    if (!reportsArray.length) { reportsList.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:20px;font-style:italic;">No reports</div>'; reportsBadge.classList.add('hidden'); return; }
    reportsBadge.textContent=reportsArray.length; reportsBadge.classList.remove('hidden'); reportsList.innerHTML='';
    reportsArray.sort((a,b)=>b.timestamp-a.timestamp).forEach(report => {
        const date=new Date(report.timestamp), timeStr=date.toLocaleDateString()+' '+date.toLocaleTimeString();
        const reporterEmail=report.reporterEmail||'', reporterName=report.reporter||'Unknown';
        const reportDiv=document.createElement('div'); reportDiv.className='report-item';
        reportDiv.innerHTML=`<div class="report-header"><span class="report-type">HELP REQUEST</span><span class="report-time">${timeStr}</span></div><div class="report-content"><strong>${escapeHtml(reporterName)}</strong>: ${escapeHtml(report.message)}</div><div style="display:flex;gap:8px;margin-top:10px;">${(isOwner||isPhantom)&&reporterEmail&&!isHiddenAccount(reporterEmail)?`<button class="report-dm-btn" onclick="openDmModal('${reporterEmail}','${escapeHtml(reporterName)}','${escapeHtml(report.message).replace(/'/g,"\\'")}')">💬 DM User</button>`:''}<button class="report-dismiss" style="flex:1;" onclick="dismissReport('${report.id}')">✓ Dismiss</button></div>`;
        reportsList.appendChild(reportDiv);
    });
}
function dismissReport(reportId) { if (isOwner||isAdmin||isPhantom) safeDbRemove('reports/'+reportId); }

// ─── SETTINGS & CHANNELS ──────────────────────────────────────────────────────

function loadCustomSettings() {
    safeDbGet('settings/bannedWords').then(snapshot=>{ if(snapshot.exists()) bannedWords=snapshot.val(); if(isOwner||isAdmin) loadBannedWordsList(); });
    safeDbOn('customChannels','value',(snapshot)=>{ customChannels=snapshot.exists()?snapshot.val():{}; loadCustomChannels(); });
}

function loadCustomChannels() {
    const list=document.getElementById('customChannelsList'), section=document.getElementById('customChannelsSection');
    list.innerHTML='';
    if (!Object.keys(customChannels).length) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    Object.keys(customChannels).forEach(name => {
        const channel=customChannels[name], div=document.createElement('div'); div.className='channel'; div.onclick=()=>switchChannel(name,channel.topic);
        const canDelete=isAdmin||isOwner||isModerator||isPhantom;
        div.innerHTML=`<span class="channel-name">${name}</span>${canDelete?`<button class="delete-channel-btn" onclick="deleteChannel(event,'${name}')">×</button>`:''}`;
        list.appendChild(div);
    });
}

function openCreateChannelModal() { document.getElementById('createChannelModal').classList.add('show'); document.getElementById('newChannelName').value=''; document.getElementById('newChannelTopic').value=''; document.getElementById('channelError').classList.add('hidden'); }
function closeCreateChannelModal() { document.getElementById('createChannelModal').classList.remove('show'); }

function createNewChannel() {
    const name=document.getElementById('newChannelName').value.trim().toLowerCase(), topic=document.getElementById('newChannelTopic').value.trim(), errorEl=document.getElementById('channelError');
    if (!name) { errorEl.textContent='Please enter a channel name'; errorEl.classList.remove('hidden'); return; }
    if (!/^[a-z0-9_-]+$/.test(name)) { errorEl.textContent='Only letters, numbers, hyphens, and underscores allowed'; errorEl.classList.remove('hidden'); return; }
    if (BANNED_CHANNEL_WORDS.some(w=>name.includes(w))) { errorEl.textContent='Channel name contains inappropriate content'; errorEl.classList.remove('hidden'); return; }
    if (['homework-help','teacher-complaints','study-hall','science-lab'].includes(name)||customChannels[name]) { errorEl.textContent='Channel already exists'; errorEl.classList.remove('hidden'); return; }
    safeDbSet('customChannels/'+name,{name,topic:topic||'',createdBy:currentUser,createdAt:Date.now()}).then(()=>closeCreateChannelModal());
}

function deleteChannel(event,name) {
    event.stopPropagation();
    if (!isAdmin&&!isOwner&&!isModerator&&!isPhantom) return;
    if (confirm(`Delete #${name}? All messages will be lost.`)) { safeDbRemove('customChannels/'+name); safeDbRemove('messages/'+name); if(currentChannel===name) switchChannel('homework help',''); }
}

// ─── VIP ROOMS ────────────────────────────────────────────────────────────────

function loadVipRooms() {
    if (!currentUser) return;
    safeDbOn('vipRooms','value',(s)=>{ vipRooms=s.exists()?s.val():{}; loadVipChannels(); });
    const uk=currentUser.replace(/\./g,'_');
    safeDbOn('vipAccess/'+uk,'value',(s)=>{ userVipAccess=s.exists()?s.val():{}; loadVipChannels(); });
    safeDbOn('privateRooms','value',(s)=>{ privateRooms=s.exists()?s.val():{}; loadPrivateChannels(); });
    safeDbOn('privateAccess/'+uk,'value',(s)=>{ userPrivateAccess=s.exists()?s.val():{}; loadPrivateChannels(); });
}

function loadVipChannels() {
    const list=document.getElementById('vipChannelsList'), section=document.getElementById('vipChannelsSection'), addBtn=document.getElementById('addVipRoomBtn');
    if (!list||!section) return; list.innerHTML='';
    if ((isOwner||isPhantom)&&addBtn) addBtn.style.display='block';
    const vis=(isOwner||isPhantom)?Object.keys(vipRooms):Object.keys(vipRooms).filter(r=>userVipAccess[r]===true);
    if (!vis.length) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    vis.forEach(roomName=>{ const room=vipRooms[roomName], div=document.createElement('div'); div.className='channel vip-channel'; div.onclick=()=>switchChannel(roomName,room.topic); div.innerHTML=`<span class="channel-name">${roomName}</span>${(isOwner||isPhantom)?`<button class="delete-channel-btn" onclick="deleteVipRoom(event,'${roomName}')">×</button>`:''}`; list.appendChild(div); });
}

function openCreateVipRoomModal() {
    if (!isOwner&&!isPhantom) return;
    document.getElementById('createVipRoomModal').classList.add('show'); document.getElementById('vipRoomName').value=''; document.getElementById('vipRoomTopic').value=''; document.getElementById('vipRoomError').classList.add('hidden'); loadUsersForVipAccess();
}
function closeCreateVipRoomModal() { document.getElementById('createVipRoomModal').classList.remove('show'); }

async function loadUsersForVipAccess() {
    const ul=document.getElementById('vipUsersList'); ul.innerHTML='';
    const allEmails=new Set([...Object.keys(users)]);
    try { const s=await safeDbGet('users'); const fu=s.val()||{}; Object.keys(fu).forEach(k=>allEmails.add(k.replace(/_/g,'.'))); } catch(e){}
    allEmails.forEach(email=>{ if(isProtectedAccount(email)||isHiddenAccount(email)) return; const d=users[email]?.username||email.split('@')[0]; const cb=document.createElement('div'); cb.className='vip-user-checkbox'; cb.innerHTML=`<label><input type="checkbox" value="${email}" class="vip-user-select"><span>${d}</span></label>`; ul.appendChild(cb); });
    if (!ul.children.length) ul.innerHTML='<div style="color:var(--text-muted);font-size:13px;padding:10px;">No users found.</div>';
}

function createVipRoom() {
    if (!isOwner&&!isPhantom) return;
    const name=document.getElementById('vipRoomName').value.trim(), topic=document.getElementById('vipRoomTopic').value.trim(), errorEl=document.getElementById('vipRoomError');
    if (!name){errorEl.textContent='Please enter a room name';errorEl.classList.remove('hidden');return;} if(vipRooms[name]){errorEl.textContent='VIP room already exists';errorEl.classList.remove('hidden');return;}
    const selected=Array.from(document.querySelectorAll('.vip-user-select:checked')).map(cb=>cb.value);
    if (!selected.length){errorEl.textContent='Please select at least one user';errorEl.classList.remove('hidden');return;}
    safeDbSet('vipRooms/'+name,{name,topic:topic||'',createdBy:currentUser,createdAt:Date.now()}).then(()=>Promise.all(selected.map(e=>safeDbSet('vipAccess/'+e.replace(/\./g,'_')+'/'+name,true)))).then(()=>{closeCreateVipRoomModal();alert('VIP room created successfully!');});
}

function deleteVipRoom(event,name) {
    event.stopPropagation(); if(!isOwner&&!isPhantom) return;
    if(confirm(`Delete VIP room "${name}"?`)){safeDbRemove('vipRooms/'+name);safeDbRemove('messages/'+name);safeDbGet('vipAccess').then(s=>{if(s.exists()){const aa=s.val();Object.keys(aa).forEach(uk=>{if(aa[uk][name])safeDbRemove('vipAccess/'+uk+'/'+name);});}}); if(currentChannel===name)switchChannel('homework help','');}
}

// ─── PRIVATE ROOMS ────────────────────────────────────────────────────────────

function loadPrivateChannels() {
    const list=document.getElementById('privateChannelsList'),section=document.getElementById('privateChannelsSection'),addBtn=document.getElementById('addPrivateRoomBtn');
    if(!list||!section) return; list.innerHTML=''; section.classList.remove('hidden');
    if((isOwner||isPhantom)&&addBtn) addBtn.style.display='block';
    const vis=(isOwner||isPhantom)?Object.keys(privateRooms):Object.keys(privateRooms).filter(r=>{const uk=currentUser.replace(/\./g,'_');return privateRooms[r].members&&privateRooms[r].members[uk]===true;});
    if(!vis.length&&!isOwner&&!isPhantom){list.innerHTML='<div style="padding:12px;color:var(--text-muted);font-size:13px;font-style:italic;text-align:center;">No private rooms<br/>Click 🔑 to join</div>';return;}
    vis.forEach(roomName=>{const room=privateRooms[roomName],div=document.createElement('div');div.className='channel private-channel';div.onclick=()=>switchChannel(roomName,room.topic);div.innerHTML=`<span class="channel-name">${roomName}</span>${(isOwner||isPhantom)?`<button class="delete-channel-btn" onclick="deletePrivateRoom(event,'${roomName}')">×</button>`:''}`; list.appendChild(div);});
}

function openCreatePrivateRoomModal(){if(!isOwner&&!isPhantom)return;document.getElementById('createPrivateRoomModal').classList.add('show');document.getElementById('privateRoomName').value='';document.getElementById('privateRoomTopic').value='';document.getElementById('privateRoomCode').value='';document.getElementById('privateRoomError').classList.add('hidden');}
function closeCreatePrivateRoomModal(){document.getElementById('createPrivateRoomModal').classList.remove('show');}

function createPrivateRoom(){
    if(!isOwner&&!isPhantom)return;
    const name=document.getElementById('privateRoomName').value.trim(),topic=document.getElementById('privateRoomTopic').value.trim(),accessCode=document.getElementById('privateRoomCode').value.trim(),errorEl=document.getElementById('privateRoomError');
    if(!name){errorEl.textContent='Please enter a room name';errorEl.classList.remove('hidden');return;} if(!accessCode){errorEl.textContent='Please enter an access code';errorEl.classList.remove('hidden');return;} if(accessCode.length<4){errorEl.textContent='Access code must be at least 4 characters';errorEl.classList.remove('hidden');return;} if(privateRooms[name]){errorEl.textContent='Private room already exists';errorEl.classList.remove('hidden');return;}
    safeDbSet('privateRooms/'+name,{name,topic:topic||'',accessCode,createdBy:currentUser,createdAt:Date.now(),members:{[currentUser.replace(/\./g,'_')]:true}}).then(()=>{closeCreatePrivateRoomModal();alert(`Private room "${name}" created!\nAccess Code: ${accessCode}`);});
}

function deletePrivateRoom(event,name){event.stopPropagation();if(!isOwner&&!isPhantom)return;if(confirm(`Delete private room "${name}"?`)){safeDbRemove('privateRooms/'+name);safeDbRemove('messages/'+name);if(currentChannel===name)switchChannel('homework help','');}}

function openJoinPrivateRoomModal(){document.getElementById('joinPrivateRoomModal').classList.add('show');document.getElementById('joinPrivateRoomCode').value='';document.getElementById('joinPrivateRoomError').classList.add('hidden');}
function closeJoinPrivateRoomModal(){document.getElementById('joinPrivateRoomModal').classList.remove('show');}

function joinPrivateRoom(){
    const code=document.getElementById('joinPrivateRoomCode').value.trim(),errorEl=document.getElementById('joinPrivateRoomError');
    if(!code){errorEl.textContent='Please enter an access code';errorEl.classList.remove('hidden');return;}
    let foundRoom=null; for(const r in privateRooms){if(privateRooms[r].accessCode===code){foundRoom=r;break;}}
    if(!foundRoom){errorEl.textContent='Invalid access code';errorEl.classList.remove('hidden');return;}
    const uk=currentUser.replace(/\./g,'_');
    if(privateRooms[foundRoom].members&&privateRooms[foundRoom].members[uk]){errorEl.textContent='You already have access!';errorEl.classList.remove('hidden');closeJoinPrivateRoomModal();return;}
    safeDbSet('privateRooms/'+foundRoom+'/members/'+uk,true).then(()=>{closeJoinPrivateRoomModal();alert(`Access granted to "${foundRoom}"!`);});
}

// ─── CHANNEL SWITCHING ────────────────────────────────────────────────────────

function switchChannel(channel,topic){
    currentChannel=channel;currentChannelTopic=topic||'';
    document.getElementById('chatHeader').textContent=channel;document.getElementById('chatTopic').textContent=topic||'';document.getElementById('messageInput').placeholder=`Message #${channel}`;
    document.querySelectorAll('.channel').forEach(ch=>ch.classList.remove('active'));
    if(event&&event.target){const el=event.target.closest('.channel');if(el)el.classList.add('active');}
    document.getElementById('sidebar').classList.remove('mobile-open');
    loadMessages();
}

function loadBannedWordsList(){const list=document.getElementById('bannedWordsList');list.innerHTML='';bannedWords.forEach(word=>{const item=document.createElement('div');item.className='banned-word-item';item.innerHTML=`<span>${word}</span><button class="remove-word-btn" onclick="removeBannedWord('${word}')">Remove</button>`;list.appendChild(item);});}

function addBannedWord(){
    if(!isOwner&&!isAdmin&&!isPhantom)return;
    const word=document.getElementById('newBannedWord').value.trim().toLowerCase();
    if(!word)return;if(bannedWords.includes(word)){alert('Word already banned');return;}
    bannedWords.push(word);safeDbSet('settings/bannedWords',bannedWords).then(()=>{document.getElementById('newBannedWord').value='';loadBannedWordsList();});
}
function removeBannedWord(word){if(!isOwner&&!isAdmin&&!isPhantom)return;if(confirm(`Remove "${word}"?`)){bannedWords=bannedWords.filter(w=>w!==word);safeDbSet('settings/bannedWords',bannedWords).then(()=>loadBannedWordsList());}}

// ─── MAINTENANCE ──────────────────────────────────────────────────────────────

function setupMaintenanceListener(){
    maintenanceListener=database.ref('maintenance');
    maintenanceListener.on('value',(snapshot)=>{
        const active=snapshot.exists()&&snapshot.val()===true;
        isMaintenanceMode=active; updateMaintenanceUI(active);
        if(active&&!isOwner&&!isAdmin&&!isPhantom) showMaintenanceScreen();
    },()=>{});
}

function updateMaintenanceUI(active){
    const banner=document.getElementById('maintenanceActiveBanner'),toggleBtn=document.getElementById('maintenanceToggleBtn');
    if(active){if(isOwner||isAdmin||isPhantom)banner.classList.add('show');if(toggleBtn){toggleBtn.textContent='✅ Disable Maintenance';toggleBtn.classList.add('active');}}
    else{banner.classList.remove('show');if(toggleBtn){toggleBtn.textContent='🔧 Enable Maintenance';toggleBtn.classList.remove('active');}}
}

function toggleMaintenanceMode(){if(!isOwner&&!isPhantom)return;safeDbGet('maintenance').then(s=>{const cs=s.exists()&&s.val()===true;if(cs){if(confirm('Disable maintenance mode?'))safeDbSet('maintenance',false).then(()=>alert('Maintenance mode disabled!'));}else{openMaintenanceModal();}});}
function openMaintenanceModal(){document.getElementById('maintenanceModal').classList.add('show');document.getElementById('maintenancePassword').value='';document.getElementById('maintenanceError').classList.add('hidden');}
function closeMaintenanceModal(){document.getElementById('maintenanceModal').classList.remove('show');}
function activateMaintenanceMode(){
    const pw=document.getElementById('maintenancePassword').value;
    if(pw===MAINTENANCE_PASSWORD){safeDbSet('maintenance',true).then(()=>{closeMaintenanceModal();alert('Maintenance mode activated!');});}
    else{document.getElementById('maintenanceError').textContent='Incorrect password!';document.getElementById('maintenanceError').classList.remove('hidden');}
}

function showMaintenanceScreen(){if(maintenanceListener)maintenanceListener.off();if(banListener)banListener.off();document.getElementById('authScreen').style.display='none';document.getElementById('chatContainer').style.display='none';document.getElementById('bannedScreen').classList.remove('show');document.getElementById('maintenanceScreen').classList.add('show');}
function openUnbanTool(){if(!isOwner&&!isPhantom)return;window.open('unban.html','_blank');}
function toggleMobileMenu(){document.getElementById('sidebar').classList.toggle('mobile-open');}

// ─── APP INIT ─────────────────────────────────────────────────────────────────

window.onload = function() {
    applyGhostAccountFailsafe(false);
    const savedUser=localStorage.getItem('loggedInUser');
    if(!savedUser){updateAuthUI();loadCustomSettings();return;}
    if(checkLoginExpiration()){localStorage.removeItem('loggedInUser');localStorage.removeItem('lastLoginTime');updateAuthUI();loadCustomSettings();return;}
    currentUser=savedUser;
    applyRoleFlags(checkUserRole(currentUser));
    ensureProtectedAccountNotBanned(currentUser)
        .then(()=>checkBanStatus())
        .then(()=>{if(isBanned){showBannedScreen();return Promise.reject('User is banned');}return safeDbGet('maintenance');})
        .then((snapshot)=>{
            const maintenanceActive=snapshot.exists()&&snapshot.val()===true;
            isMaintenanceMode=maintenanceActive;
            if(maintenanceActive&&!isOwner&&!isAdmin&&!isPhantom){showMaintenanceScreen();return Promise.reject('Maintenance mode active');}
            updateLastActivity();showChat();setupMaintenanceListener();setupLockdownListener();
        })
        .catch((error)=>{
            if(error==='User is banned'||error==='Maintenance mode active')return;
            console.warn('Init error:',error&&(error.message||error));
            updateLastActivity();showChat();setupMaintenanceListener();setupLockdownListener();
        });
    loadCustomSettings();loadVipRooms();
};

function toggleAuthMode(){isSignupMode=!isSignupMode;updateAuthUI();clearAuthMessages();}

function updateAuthUI(){
    const title=document.getElementById('authTitle'),subtitle=document.getElementById('authSubtitle'),button=document.getElementById('authButton'),toggleText=document.getElementById('authToggleText'),toggleLink=document.getElementById('authToggleLink'),usernameField=document.getElementById('usernameField'),confirmField=document.getElementById('confirmPasswordField');
    if(isSignupMode){title.textContent='Create an account';subtitle.textContent="We're so excited to see you!";button.textContent='Continue';toggleText.textContent='Already have an account?';toggleLink.textContent='Login';usernameField.classList.remove('hidden');confirmField.classList.remove('hidden');}
    else{title.textContent='Welcome back!';subtitle.textContent="We're so excited to see you again!";button.textContent='Log In';toggleText.textContent="Need an account?";toggleLink.textContent='Register';usernameField.classList.add('hidden');confirmField.classList.add('hidden');}
}

function handleAuth(){isSignupMode?signup():login();}

async function signup(){
    const username=document.getElementById('usernameInput').value.trim(),email=document.getElementById('emailInput').value.trim(),password=document.getElementById('passwordInput').value,confirmPassword=document.getElementById('confirmPasswordInput').value;
    if(!username||!email||!password||!confirmPassword){showError('Please fill in all fields');return;}
    if(password!==confirmPassword){showError('Passwords do not match');return;}
    if(password.length<6){showError('Password must be at least 6 characters');return;}
    const usernameCheck=validateUsername(username);if(!usernameCheck.valid){showError(usernameCheck.reason);return;}
    if(findUserInLocalStorage(email)){showError('Email already registered. Please log in instead.');return;}
    if(Object.values(users).some(u=>u.username.toLowerCase()===username.toLowerCase())){showError('Username already taken');return;}
    const authButton=document.getElementById('authButton');authButton.innerHTML='<span class="btn-spinner"></span>Checking...';authButton.disabled=true;
    try{const ef=await fetchCredentialsFromFirebase(email);if(ef){showError('An account with this email already exists.');authButton.textContent='Create Account';authButton.disabled=false;return;}const ec=await validateEmail(email);if(!ec.valid){showError(ec.reason);authButton.textContent='Create Account';authButton.disabled=false;return;}}catch(e){console.warn('Pre-signup checks failed:',e);}
    authButton.textContent='Create Account';authButton.disabled=false;
    users[email]={username,password,createdAt:new Date().toISOString()};localStorage.setItem('users',JSON.stringify(users));
    await saveCredentialsToFirebase(email,username,password);
    localStorage.setItem('loggedInUser',email);localStorage.setItem('lastLoginTime',Date.now().toString());
    showSuccess('Account created! Redirecting...');setTimeout(()=>{window.location.href='terms.html';},1000);
}

async function login(){
    const emailRaw=document.getElementById('emailInput').value.trim(),password=document.getElementById('passwordInput').value;
    if(!emailRaw||!password){showError('Please enter your email and password');return;}
    const authButton=document.getElementById('authButton');authButton.innerHTML='<span class="btn-spinner"></span>Logging in...';authButton.disabled=true;
    let found=findUserInLocalStorage(emailRaw),resolvedEmail=found?found.email:emailRaw,userData=found?found.data:null;
    if(!userData){try{const fd=await fetchCredentialsFromFirebase(emailRaw);if(fd&&fd.password){resolvedEmail=fd.email||emailRaw;users[resolvedEmail]={username:fd.username,password:fd.password,createdAt:fd.createdAt||new Date().toISOString()};localStorage.setItem('users',JSON.stringify(users));userData=users[resolvedEmail];}}catch(e){console.warn('Firebase credential lookup failed:',e);}}
    authButton.textContent='Log In';authButton.disabled=false;
    if(!userData){showError('Account not found. Check your email or create an account first.');return;}
    if(userData.password!==password){showError('Incorrect password. Please try again.');return;}
    currentUser=resolvedEmail;localStorage.setItem('loggedInUser',resolvedEmail);localStorage.setItem('lastLoginTime',Date.now().toString());
    applyRoleFlags(checkUserRole(currentUser));
    const termsAccepted=localStorage.getItem('termsAccepted_'+resolvedEmail)||localStorage.getItem('termsAccepted_'+emailRaw);
    if(!termsAccepted){window.location.href='terms.html';return;}
    ensureProtectedAccountNotBanned(currentUser)
        .then(()=>checkBanStatus())
        .then(()=>{if(isBanned){showBannedScreen();return Promise.reject('User is banned');}return safeDbGet('maintenance');})
        .then((snapshot)=>{const ma=snapshot.exists()&&snapshot.val()===true;if(ma&&!isOwner&&!isAdmin&&!isPhantom){showMaintenanceScreen();return Promise.reject('Maintenance active');}updateLastActivity();showChat();setupMaintenanceListener();setupLockdownListener();})
        .catch((error)=>{if(error==='User is banned'||error==='Maintenance active')return;console.warn('Login post-auth error:',error&&(error.message||error));updateLastActivity();showChat();setupMaintenanceListener();setupLockdownListener();});
}

function showChat(){
    // Phantom triple-check
    if(isPhantom||isPhantomAccount(currentUser)){isBanned=false;isPhantom=true;isOwner=true;isAdmin=true;}
    if(isProtectedAccount(currentUser))isBanned=false;
    if(isBanned){showBannedScreen();return;}
    document.getElementById('authScreen').style.display='none';document.getElementById('chatContainer').style.display='flex';document.getElementById('bannedScreen').classList.remove('show');document.getElementById('maintenanceScreen').classList.remove('show');
    const displayName=users[currentUser]?.username||currentUser.split('@')[0];
    const initial=getUserInitial(currentUser);
    const userAvatarSmall=document.getElementById('userAvatarSmall');
    const mobileUserName=document.getElementById('mobileUserName'); if(mobileUserName)mobileUserName.textContent=displayName;
    const mobileAvatar=document.getElementById('mobileAvatar');
    // Phantom: NO badge — completely invisible role in UI
    let badge='';
    if(isPhantom){
        document.getElementById('adminPanelHeader').textContent='👑 OWNER PANEL';
        document.getElementById('adminPanelHeader').classList.add('owner-header');
        userAvatarSmall.className='user-avatar-small owner';
        if(mobileAvatar)mobileAvatar.className='mobile-avatar owner';
    } else if(isOwner){
        badge='<span class="badge owner-badge">Owner</span>';
        document.getElementById('adminPanelHeader').textContent='👑 OWNER PANEL';
        document.getElementById('adminPanelHeader').classList.add('owner-header');
        userAvatarSmall.className='user-avatar-small owner';
        if(mobileAvatar)mobileAvatar.className='mobile-avatar owner';
    } else if(isAdmin){
        badge='<span class="badge admin-badge">Admin</span>';
        document.getElementById('adminPanelHeader').textContent='🛡️ ADMIN PANEL';
        userAvatarSmall.className='user-avatar-small admin';
        if(mobileAvatar)mobileAvatar.className='mobile-avatar admin';
    } else {
        userAvatarSmall.className='user-avatar-small';
        if(mobileAvatar)mobileAvatar.className='mobile-avatar';
    }
    userAvatarSmall.textContent=initial; if(mobileAvatar)mobileAvatar.textContent=initial;
    document.getElementById('currentUser').innerHTML=displayName+badge; // phantom appends no badge

    if(!isProtectedAccount(currentUser)&&!isHiddenAccount(currentUser)&&!isPhantom){
        banListener=database.ref('banned/'+currentUser.replace(/\./g,'_'));
        banListener.on('value',(snapshot)=>{if(snapshot.exists()&&snapshot.val()===true){isBanned=true;showBannedScreen();}},()=>{});
    }

    if(isOwner||isAdmin||isPhantom){
        document.getElementById('adminPanel').classList.add('show');
        loadAdminPanel();loadReports();
        document.getElementById('reportsSection').classList.remove('hidden');
        document.getElementById('bannedWordsSection').classList.remove('hidden');
        loadBannedWordsList();
        if(!isOwner&&!isPhantom){const a=document.getElementById('announcementsSection');if(a)a.style.display='none';}
        document.getElementById('ownerControls').classList[isOwner||isPhantom?'remove':'add']('hidden');
        safeDbGet('maintenance').then(s=>updateMaintenanceUI(s.exists()&&s.val()===true));
    } else {
        document.getElementById('helpButton').classList.remove('hidden');
        loadDmInbox();
    }
    blockedUsers=JSON.parse(localStorage.getItem('blockedUsers_'+currentUser)||'[]');
    updateLastActivity();loadCustomSettings();loadMessages();loadVipRooms();loadAnnouncement();loadPrimeMembers();
    setInterval(updateLastActivity,60000);
}

function showBannedScreen(){
    if(isPhantom||isProtectedAccount(currentUser)||isHiddenAccount(currentUser)){isBanned=false;showChat();return;}
    if(banListener)banListener.off();if(maintenanceListener)maintenanceListener.off();
    document.getElementById('authScreen').style.display='none';document.getElementById('chatContainer').style.display='none';document.getElementById('maintenanceScreen').classList.remove('show');document.getElementById('bannedScreen').classList.add('show');
}

function showError(msg){const el=document.getElementById('errorMsg'),te=document.getElementById('errorText');if(te)te.textContent=msg;else el.textContent=msg;el.classList.remove('hidden');const s=document.getElementById('successMsg');if(s)s.classList.add('hidden');}
function showSuccess(msg){const el=document.getElementById('successMsg'),te=document.getElementById('successText');if(te)te.textContent=msg;else el.textContent=msg;el.classList.remove('hidden');const e=document.getElementById('errorMsg');if(e)e.classList.add('hidden');}
function clearAuthMessages(){const e=document.getElementById('errorMsg'),s=document.getElementById('successMsg');if(e)e.classList.add('hidden');if(s)s.classList.add('hidden');}

function logout(){
    if(maintenanceListener)maintenanceListener.off();if(banListener)banListener.off();if(dmListener)dmListener.off();if(lockdownListener)lockdownListener.off();
    localStorage.removeItem('loggedInUser');localStorage.removeItem('lastLoginTime');location.reload();
}
function checkLoginExpiration(){const l=localStorage.getItem('lastLoginTime');if(!l)return true;return(Date.now()-parseInt(l))>ONE_MONTH_MS;}
function updateLastActivity(){localStorage.setItem('lastLoginTime',Date.now().toString());if(currentUser)safeDbSet('users/'+currentUser.replace(/\./g,'_')+'/lastActive',Date.now());}

// ─── MESSAGES ─────────────────────────────────────────────────────────────────

let currentMessageListener=null;

function loadMessages(){
    const messagesDiv=document.getElementById('messages');messagesDiv.innerHTML='';
    if(currentMessageListener)database.ref('messages/'+currentMessageListener).off();
    currentMessageListener=currentChannel;
    database.ref('messages/'+currentChannel).limitToLast(50).on('child_added',(snapshot)=>{addMessageToUI(snapshot.val(),snapshot.key);messagesDiv.scrollTop=messagesDiv.scrollHeight;},()=>{});
    database.ref('messages/'+currentChannel).on('child_removed',(snapshot)=>{const el=document.querySelector(`[data-message-id="${snapshot.key}"]`);if(el)el.remove();},()=>{});
}

function addMessageToUI(msg,messageId){
    if(blockedUsers.includes(msg.user))return;
    const messagesDiv=document.getElementById('messages'),messageEl=document.createElement('div');
    messageEl.className='message';messageEl.setAttribute('data-message-id',messageId);
    const initial=msg.user.charAt(0).toUpperCase(),roleClass=getUserRoleClass(msg.email);
    const time=new Date(msg.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    const canDelete=isAdmin||isOwner||isModerator||isPhantom;
    // Phantom messages: NO badge shown
    let badge='';
    if(isProtectedAccount(msg.email)&&!isPhantomAccount(msg.email)){badge='<span class="badge owner-badge">👑 Owner</span>';}
    else if(isAdminAccount(msg.email)){badge='<span class="badge admin-badge">🛡️ Admin</span>';}
    else if(isPrimeMemberAccount(msg.email)){badge='<span class="badge prime-badge">⭐ Prime</span>';}
    const safeText=escapeHtml(msg.text);
    messageEl.innerHTML=`<div class="message-avatar ${roleClass}" onclick="viewUserActivity('${msg.email}')" title="Click to view activity">${initial}</div><div class="message-content"><div class="message-header"><span class="message-username" onclick="viewUserActivity('${msg.email}')">${escapeHtml(msg.user)}</span>${badge}<span class="message-time">${time}</span></div><div class="message-text">${safeText}</div></div>${canDelete?`<div class="message-buttons"><button class="message-btn" onclick="deleteMessage('${messageId}')" title="Delete">🗑️</button></div>`:''}`;
    messagesDiv.appendChild(messageEl);
}

function deleteMessage(messageId){if(!isAdmin&&!isOwner&&!isModerator&&!isPhantom)return;if(confirm('Delete this message?'))safeDbRemove('messages/'+currentChannel+'/'+messageId);}
function handleKeyPress(event){if(event.key==='Enter')sendMessage();}

function sendMessage(){
    const input=document.getElementById('messageInput'),text=input.value.trim();if(!text)return;
    if(isProtectedAccount(currentUser)||isPhantom){const dn=users[currentUser]?.username||currentUser.split('@')[0];safeDbPush('messages/'+currentChannel,{user:dn,email:currentUser,text,timestamp:new Date().toISOString()});input.value='';return;}
    if(isBanned){alert('You are banned');input.value='';return;}
    const lt=text.toLowerCase();
    if(racistSlurs.some(s=>lt.includes(s))){safeDbSet('banned/'+currentUser.replace(/\./g,'_'),true);alert('Banned for using racist language');isBanned=true;showBannedScreen();return;}
    if(bannedWords.some(w=>lt.includes(w))){
        if(!userStrikes[currentUser])userStrikes[currentUser]=0;userStrikes[currentUser]++;localStorage.setItem('userStrikes',JSON.stringify(userStrikes));
        document.getElementById('strikeCount').textContent=userStrikes[currentUser];document.getElementById('warningBanner').classList.remove('hidden');
        if(userStrikes[currentUser]>=3){safeDbSet('banned/'+currentUser.replace(/\./g,'_'),true);alert('Banned for excessive profanity (3 strikes)');isBanned=true;showBannedScreen();return;}
        setTimeout(()=>document.getElementById('warningBanner').classList.add('hidden'),3000);input.value='';return;
    }
    const dn=users[currentUser]?.username||currentUser.split('@')[0];safeDbPush('messages/'+currentChannel,{user:dn,email:currentUser,text,timestamp:new Date().toISOString()});input.value='';
}

// ─── ADMIN PANEL ──────────────────────────────────────────────────────────────

async function loadAdminPanel(){
    const adminUsersDiv=document.getElementById('adminUsers');adminUsersDiv.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:20px;">Loading users...</div>';
    const now=Date.now(),FIVE_MINUTES=5*60*1000;
    OWNER_EMAILS.forEach(email=>ensureProtectedAccountNotBanned(email));
    let bannedData={};try{const s=await safeDbGet('banned');bannedData=s.val()||{};}catch(e){}
    const bannedEmails=Object.keys(bannedData).map(k=>k.replace(/_/g,'.'));
    let firebaseUsers={};try{const s=await safeDbGet('users');firebaseUsers=s.val()||{};}catch(e){}
    const allEmails=new Set([...Object.keys(users)]);
    Object.keys(firebaseUsers).forEach(k=>allEmails.add(k.replace(/_/g,'.')));
    OWNER_EMAILS.forEach(e=>allEmails.add(e));ADMIN_EMAILS.forEach(e=>allEmails.add(e));bannedEmails.forEach(e=>allEmails.add(e));
    adminUsersDiv.innerHTML='';
    const usersList=Array.from(allEmails).filter(email=>!isHiddenAccount(email)).map(email=>{
        const uk=email.replace(/\./g,'_'),lastActive=firebaseUsers[uk]?.lastActive||0;
        return{email,displayName:users[email]?.username||email.split('@')[0],lastActive,isOnline:lastActive>0&&(now-lastActive)<FIVE_MINUTES,isBannedUser:bannedEmails.includes(email),isPrime:primeMembers[uk]===true,isProtected:isProtectedAccount(email),isAdminUser:isAdminAccount(email)};
    });
    usersList.sort((a,b)=>{if(a.isProtected!==b.isProtected)return a.isProtected?-1:1;if(a.isAdminUser!==b.isAdminUser)return a.isAdminUser?-1:1;if(a.isOnline!==b.isOnline)return a.isOnline?-1:1;return a.displayName.localeCompare(b.displayName);});
    usersList.forEach(user=>{
        const userDiv=document.createElement('div');userDiv.className='admin-user'+(user.isBannedUser?' banned':'');
        const onlineIndicator=user.isOnline?'<span style="color:#43b581;font-size:20px;margin-right:5px;">●</span>':'<span style="color:#747f8d;font-size:20px;margin-right:5px;">●</span>';
        let badges=user.isProtected?' <span class="badge owner-badge">Owner</span>':user.isAdminUser?' <span class="badge admin-badge">Admin</span>':user.isPrime?' <span class="badge prime-badge">⭐ Prime</span>':'';
        let banBtn=!user.isProtected?((isOwner||isPhantom)||(!user.isAdminUser&&isAdmin)?`<button class="${user.isBannedUser?'unban-btn':'ban-btn'}" onclick="toggleBan('${user.email}')">${user.isBannedUser?'Unban':'Ban'}</button>`:''):'';
        let primeBtn=(isOwner||isPhantom)&&!user.isProtected&&!user.isAdminUser?`<button style="background:${user.isPrime?'#f59e0b':'#6366f1'};color:white;padding:8px 12px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;" onclick="togglePrimeMember('${user.email}')">${user.isPrime?'⭐ Remove Prime':'⭐ Grant Prime'}</button>`:'';
        let dmBtn=(isOwner||isPhantom)&&!user.isProtected?`<button style="background:#10b981;color:white;padding:8px 12px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;" onclick="openDmModal('${user.email}','${user.displayName}','')">💬 DM</button>`:'';
        let delBtn=(isOwner||isPhantom)&&!user.isProtected?`<button class="delete-account-btn" onclick="deleteAccount('${user.email}')">Delete Account</button>`:'';
        userDiv.innerHTML=`<div class="admin-user-name" onclick="viewUserActivity('${user.email}')">${onlineIndicator}${user.displayName}${badges}${user.isBannedUser?' <small>(BANNED)</small>':''}</div><div class="admin-user-buttons"><button class="view-activity-btn" onclick="viewUserActivity('${user.email}')">View Activity</button>${banBtn}${primeBtn}${dmBtn}${delBtn}</div>`;
        adminUsersDiv.appendChild(userDiv);
    });
    const summaryDiv=document.createElement('div');summaryDiv.style.cssText='padding:10px;text-align:center;color:var(--text-muted);font-size:13px;border-top:1px solid var(--border-color);margin-top:10px;';summaryDiv.textContent=`${usersList.filter(u=>u.isOnline).length} online • ${usersList.length} total users`;adminUsersDiv.appendChild(summaryDiv);
}

function toggleBan(email){
    if(!isOwner&&!isAdmin&&!isPhantom)return;
    if(isProtectedAccount(email)){alert('Cannot ban owner account!');ensureProtectedAccountNotBanned(email);return;}
    if(isHiddenAccount(email))return;
    if(isAdminAccount(email)&&!isOwner&&!isPhantom){alert('Only owners can ban admin accounts!');return;}
    const uk=email.replace(/\./g,'_');
    safeDbGet('banned/'+uk).then(s=>{if(s.exists()&&s.val()===true){safeDbRemove('banned/'+uk).then(()=>{if(userStrikes[email]){delete userStrikes[email];localStorage.setItem('userStrikes',JSON.stringify(userStrikes));}loadAdminPanel();});}else{safeDbSet('banned/'+uk,true).then(()=>loadAdminPanel());}});
}

function deleteAccount(email){
    if(!isOwner&&!isPhantom)return;
    if(isProtectedAccount(email)||isAdminAccount(email)||isHiddenAccount(email)){alert('Cannot delete this account!');return;}
    if(confirm(`Permanently delete account for ${email}?\n\nThis cannot be undone!`)){
        const uk=email.replace(/\./g,'_'),dn=users[email]?.username||email.split('@')[0];
        if(users[email]){delete users[email];localStorage.setItem('users',JSON.stringify(users));}
        localStorage.removeItem('termsAccepted_'+email);localStorage.removeItem('termsAcceptedDate_'+email);
        if(userStrikes[email]){delete userStrikes[email];localStorage.setItem('userStrikes',JSON.stringify(userStrikes));}
        ['users/'+uk,'credentials/'+uk,'banned/'+uk,'primeMembers/'+uk,'dms/'+uk].forEach(p=>safeDbRemove(p));
        const allChannels=['homework help','teacher complaints','study hall','science lab'];Object.keys(customChannels).forEach(ch=>allChannels.push(ch));
        allChannels.forEach(channel=>{safeDbGet('messages/'+channel).then(s=>{if(!s.exists())return;s.forEach(child=>{const msg=child.val();if(msg.email===email||msg.user===dn)safeDbRemove('messages/'+channel+'/'+child.key);});});});
        alert(`Account for ${email} has been permanently deleted.`);loadAdminPanel();
    }
}

function checkBanStatus(){
    return new Promise((resolve)=>{
        if(isPhantom||isProtectedAccount(currentUser)||isHiddenAccount(currentUser)){isBanned=false;resolve();return;}
        safeDbGet('banned/'+currentUser.replace(/\./g,'_')).then(s=>{isBanned=s.exists()&&s.val()===true;resolve();}).catch(()=>{isBanned=false;resolve();});
    });
}

// ─── USER ACTIVITY ────────────────────────────────────────────────────────────

function viewUserActivity(email){
    if(!isOwner&&!isAdmin&&!isPhantom)return;
    const username=users[email]?.username||email.split('@')[0];
    document.getElementById('activityUserName').textContent=username;document.getElementById('activityUserEmail').textContent=isHiddenAccount(email)?'(system account)':email;
    const allChannels=['homework help','teacher complaints','study hall','science lab'];Object.keys(customChannels).forEach(ch=>allChannels.push(ch));
    const activityList=document.getElementById('activityChannelsList');activityList.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:20px;">Loading...</div>';
    document.getElementById('userActivityModal').classList.add('show');
    Promise.all(allChannels.map(ch=>safeDbGet('messages/'+ch).then(s=>{const msgs=[];if(s.exists())s.forEach(c=>{const m=c.val();if(m.user===username||m.email===email)msgs.push({...m,id:c.key});});return{channelName:ch,messages:msgs};}))).then(results=>{
        activityList.innerHTML='';const cwm=results.filter(r=>r.messages.length>0);
        if(!cwm.length){activityList.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:30px;font-style:italic;">No messages found</div>';return;}
        cwm.forEach(result=>{
            const section=document.createElement('div');section.className='channel-section';
            const header=document.createElement('div');header.className='channel-section-header';header.innerHTML=`<span># ${result.channelName}</span><span class="message-count">${result.messages.length}</span>`;
            const msgs=document.createElement('div');msgs.className='channel-messages';msgs.style.display='none';
            result.messages.sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)).forEach(msg=>{const item=document.createElement('div');item.className='user-message-item';const d=new Date(msg.timestamp);item.innerHTML=`<div class="message-meta">${d.toLocaleDateString()} ${d.toLocaleTimeString()}</div><div class="message-content">${msg.text}</div>`;msgs.appendChild(item);});
            header.onclick=()=>msgs.style.display=msgs.style.display==='none'?'block':'none';section.appendChild(header);section.appendChild(msgs);activityList.appendChild(section);
        });
    });
}
function closeUserActivityModal(){document.getElementById('userActivityModal').classList.remove('show');}

// ─── HELP MODAL ───────────────────────────────────────────────────────────────

function openHelpModal(){document.getElementById('helpModal').classList.add('show');}
function closeHelpModal(){document.getElementById('helpModal').classList.remove('show');}

function reportBullying(){const u=prompt('Who is bullying you?');if(u){const d=prompt('Describe what happened (optional):'),dn=users[currentUser]?.username||currentUser.split('@')[0];safeDbPush('reports',{reporter:dn,reporterEmail:currentUser,message:`Reported ${u} for bullying.${d?' Details: '+d:''}`,timestamp:Date.now()});alert('Report submitted.');closeHelpModal();}}
function reportProblem(){const p=prompt('Describe the problem:');if(p){const dn=users[currentUser]?.username||currentUser.split('@')[0];safeDbPush('reports',{reporter:dn,reporterEmail:currentUser,message:`Problem: ${p}`,timestamp:Date.now()});alert('Problem reported.');closeHelpModal();}}
function contactAdmin(){const m=prompt('Message to admin:');if(m){const dn=users[currentUser]?.username||currentUser.split('@')[0];safeDbPush('reports',{reporter:dn,reporterEmail:currentUser,message:`Message: ${m}`,timestamp:Date.now()});alert('Message sent.');closeHelpModal();}}

// ─── OWNER ACTIONS ────────────────────────────────────────────────────────────

function resetAllMessages(){if(!isOwner&&!isPhantom)return;if(confirm('⚠️ Delete ALL messages from ALL channels?')){if(confirm('This cannot be undone. Continue?')){safeDbRemove('messages').then(()=>{alert('All messages deleted.');loadMessages();});}}}
function postAnnouncement(){if(!isOwner&&!isPhantom)return;const text=document.getElementById('newAnnouncement').value.trim();if(!text){alert('Please enter announcement text');return;}safeDbSet('announcement',{text,timestamp:Date.now(),postedBy:currentUser}).then(()=>{document.getElementById('newAnnouncement').value='';alert('Announcement posted!');showAnnouncementBanner(text);});}
function clearAnnouncement(){if(!isOwner&&!isPhantom)return;if(confirm('Clear current announcement?')){safeDbRemove('announcement').then(()=>{document.getElementById('announcementsBanner').classList.remove('show');document.getElementById('currentAnnouncementText').textContent='None';alert('Announcement cleared');});}}
function dismissAnnouncement(){document.getElementById('announcementsBanner').classList.remove('show');}
function showAnnouncementBanner(text){document.getElementById('announcementText').textContent=text;document.getElementById('announcementsBanner').classList.add('show');document.getElementById('currentAnnouncementText').textContent=text;}
function loadAnnouncement(){safeDbOn('announcement','value',(s)=>{if(s.exists()){showAnnouncementBanner(s.val().text);}else{document.getElementById('announcementsBanner').classList.remove('show');if(isOwner||isPhantom)document.getElementById('currentAnnouncementText').textContent='None';}});}