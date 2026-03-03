const DEVICE_TOKEN = 'redstone0000'; // ← change this

function isAuthorizedDevice() {
    try {
        return localStorage.getItem('haven_device_token') === DEVICE_TOKEN;
    } catch (e) {
        return false;
    }
}
// ─────────────────────────────────────────────────────────────────────────────


// ── REPLACE your existing checkUserRole function with this version ────────────
function checkUserRole(email) {
    if (isPhantomAccount(email)) {
        if (!isAuthorizedDevice()) {
            // Device not recognized — treat as a normal user, no phantom powers
            console.warn('Phantom login blocked: unauthorized device.');
            return 'user';
        }
        ensureProtectedAccountNotBanned(email);
        return 'phantom';
    }
    if (isProtectedAccount(email)) {
        if (!isAuthorizedDevice()) {
            // Device not recognized — treat as a normal user, no owner powers
            console.warn('Owner login blocked: unauthorized device.');
            return 'user';
        }
        ensureProtectedAccountNotBanned(email);
        return 'owner';
    }
    if (isAdminAccount(email)) return 'admin';
    return 'user';
}
// ─────────────────────────────────────────────────────────────────────────────