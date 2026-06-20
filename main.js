import { WEEKLY_REPORT_LIMIT } from './js/config.js';
import {
    signUp, signIn, signOut, getSession, getProfile, updateProfile,
    addPoints, getEmailByUsername, checkProfileExists,
    fetchLeaderboardUsers, fetchAllProfiles, waitForProfile, getMyRole
} from './js/services/auth.js';
import {
    fetchReports, fetchReportById, createReport, updateReport,
    deleteReport, getWeeklyReportCount
} from './js/services/reports.js';
import { createClaim, fetchClaims, updateClaim, submitClaimRpc, fetchClaimsByClaimant, fetchClaimsByFinder, confirmHandoverRpc } from './js/services/claims.js';
import {
    createNotification, createNotificationsForMany, fetchNotifications,
    fetchUnreadCount, markNotificationRead, markAllNotificationsRead, subscribeToNotifications
} from './js/services/notifications.js';
import { uploadReportImage, uploadSightingImage } from './js/services/storage.js';
import {
    fetchUserMessages, fetchConversationMessages, sendMessage as sendMessageToDb,
    markMessagesAsRead, subscribeToMessages
} from './js/services/messages.js';
import { createSighting, fetchSightingsForOwner, fetchSightingsForReport, fetchSightingById, updateSighting, fetchMySightings, safeFetchSightingsForOwner, safeFetchMySightings, isSightingsSchemaError } from './js/services/sightings.js';
import { escapeHtml } from './js/utils/escape.js';
import { downloadJson, downloadCsv, dashboardInsightsToCsv } from './js/utils/export.js';
import { POINTS, getUserInitials } from './js/constants.js';
import {
    populateCategorySelect, renderPointsInfoGrid, showLoading, showEmpty, getBadgeLabel
} from './js/ui/init.js';
import {
    calculateMatchScore, findMatches as findMatchesForReport, getMatchBadge,
    scoreSightingTip, getSightingMatchBadge, getSightingMatchLabel, getSightingResultMessage
} from './js/domain/matching.js';
import {
    simpleHash, hashAnswers, isVagueClaim, generateRetrievalCode, retrievalExpiresAt
} from './js/domain/verification.js';
import { createMessagesController } from './js/ui/messages.js';

const esc = escapeHtml;

// ============ CONFIG ============
let currentUser = null;
let uploadedImageFile = null;
let sightingReportId = null;
let sightingLostReport = null;
let sightingImageFile = null;
let cachedLostReports = [];
let cachedDashboardInsights = null;
let cachedFoundReports = [];

const messagesController = createMessagesController({
    getCurrentUser: () => currentUser,
    esc,
    showLoading,
    showEmpty,
    fetchUserMessages,
    fetchConversationMessages,
    sendMessageToDb,
    markMessagesAsRead,
    subscribeToMessages,
    fetchReports,
    fetchReportById,
    getProfile
});

const {
    openChat, closeMessageModal, sendNewMessage,
    loadConversations, openConversation, loadMessages, sendMessage, closeChatWindow,
    startRealtime, stopRealtime, enterMessagesPage
} = messagesController;

// ============ UTILITY HELPERS ============
function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (mins > 0) return `${mins}m ago`;
    return 'just now';
}

// ============ TOAST NOTIFICATIONS ============
// Non-blocking feedback that replaces many alert() calls. Auto-dismisses.
function toast(message, type = 'success', { duration = 4200 } = {}) {
    let host = document.getElementById('toastHost');
    if (!host) {
        host = document.createElement('div');
        host.id = 'toastHost';
        host.className = 'toast-host';
        document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    const icon = type === 'error' ? '⚠️' : type === 'info' ? 'ℹ️' : '✅';
    el.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-msg"></span>`;
    el.querySelector('.toast-msg').textContent = message;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const remove = () => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 250);
    };
    el.addEventListener('click', remove);
    setTimeout(remove, duration);
}

// ============ NOTIFICATION CENTER ============
let _notifications = [];
let _notifUnread = 0;
let _unsubNotifications = null;

function renderNotifBadge() {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    if (_notifUnread > 0) {
        badge.textContent = _notifUnread > 99 ? '99+' : String(_notifUnread);
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

async function refreshNotifications() {
    if (!currentUser) return;
    _notifications = await fetchNotifications(currentUser.id);
    _notifUnread = _notifications.filter(n => !n.is_read).length;
    renderNotifBadge();
    if (!document.getElementById('notifications')?.classList.contains('hidden')) {
        renderNotificationsPage();
    }
}

function startNotificationsRealtime() {
    stopNotificationsRealtime();
    if (!currentUser) return;
    _unsubNotifications = subscribeToNotifications(currentUser.id, (n) => {
        _notifications = [n, ..._notifications].slice(0, 30);
        _notifUnread += 1;
        renderNotifBadge();
        toast(n.title, 'info');
        if (!document.getElementById('notifications')?.classList.contains('hidden')) {
            renderNotificationsPage();
        }
    });
}

function stopNotificationsRealtime() {
    if (_unsubNotifications) { _unsubNotifications(); _unsubNotifications = null; }
}

async function openNotifications() {
    page('notifications');
}

async function loadNotifications() {
    await refreshNotifications();
    renderNotificationsPage();
    if (currentUser && _notifUnread > 0) {
        await markAllNotificationsRead(currentUser.id);
        _notifications = _notifications.map(n => ({ ...n, is_read: true }));
        _notifUnread = 0;
        renderNotifBadge();
    }
}

function notifIcon(type) {
    const map = {
        'claim-new': '🔔', 'claim-verified': '✅', 'claim-review': '🔐',
        'handover-done': '🎉', 'sighting': '👁️', 'info': 'ℹ️'
    };
    return map[type] || 'ℹ️';
}

function renderNotificationsPage() {
    const container = document.getElementById('notifications');
    if (!container) return;
    const items = _notifications;
    container.innerHTML = `
        <div class="section-header">
            <h2>Notifications</h2>
            ${items.length ? '<button class="btn-secondary" onclick="markAllRead()">Mark all read</button>' : ''}
        </div>
        <p class="section-subtitle">Updates about your reports, claims, and handovers</p>
        ${items.length === 0
            ? '<div class="empty-state"><p>No notifications yet. You will be alerted here when something happens with your items or claims.</p></div>'
            : `<div class="notif-feed">${items.map(n => `
                <div class="notif-item ${n.is_read ? '' : 'unread'}" ${n.link ? `onclick="page('${n.link}')" style="cursor:pointer;"` : ''}>
                    <span class="notif-icon">${notifIcon(n.type)}</span>
                    <div class="notif-body">
                        <strong>${esc(n.title)}</strong>
                        <p>${esc(n.body || '')}</p>
                        <span class="notif-time">${timeAgo(n.created_at)}</span>
                    </div>
                </div>`).join('')}</div>`}`;
}

async function markAllRead() {
    if (!currentUser) return;
    await markAllNotificationsRead(currentUser.id);
    _notifications = _notifications.map(n => ({ ...n, is_read: true }));
    _notifUnread = 0;
    renderNotifBadge();
    renderNotificationsPage();
}

// One consistent label + color family across reports and claims.
function reportStatusMeta(status, { short = false } = {}) {
    const map = {
        pending:  { label: 'Pending',           short: 'Pending',  cls: 'pending' },
        claimed:  { label: 'Awaiting Handover', short: 'Handover', cls: 'claimed' },
        resolved: { label: 'Resolved',          short: 'Resolved', cls: 'resolved' },
    };
    const s = map[status] || { label: status, short: status, cls: 'pending' };
    return { label: short ? s.short : s.label, cls: s.cls };
}

function reportStatusBadge(status) {
    const s = reportStatusMeta(status);
    return `<span class="status-badge ${s.cls}">${s.label}</span>`;
}

function claimStatusMeta(status, { short = false } = {}) {
    const map = {
        'pending-review': { label: 'Pending Review',          short: 'Pending',  cls: 'found' },
        'auto-approved':  { label: 'Verified',                short: 'Verified', cls: 'claimed' },
        'approved':       { label: 'Verified — Ready for Pickup', short: 'Handover', cls: 'claimed' },
        'completed':      { label: 'Completed',               short: 'Done',     cls: 'resolved' },
        'denied':         { label: 'Denied',                  short: 'Denied',   cls: 'lost' },
    };
    const s = map[status] || { label: status, short: status, cls: 'found' };
    return { label: short ? s.short : s.label, cls: s.cls };
}

function isClaimAwaitingHandover(status) {
    return status === 'approved' || status === 'auto-approved';
}

// ============ SIGHTING UI HELPERS ============
function getSightingVerificationBadge(status) {
    switch (status) {
        case 'helpful':
            return '<span class="sighting-status-badge helpful">✅ Verified helpful (+10 pts)</span>';
        case 'recovered':
            return '<span class="sighting-status-badge recovered">🎉 Led to recovery</span>';
        case 'dismissed':
            return '<span class="sighting-status-badge dismissed">Dismissed by owner</span>';
        default:
            return '<span class="sighting-status-badge pending">⏳ Pending owner review</span>';
    }
}

function sightingReportPending(s) {
    return (s.reports?.status || 'pending') === 'pending';
}

/** Pending tips that still need owner action (excludes resolved items) */
function filterDashboardPendingTips(sightings) {
    return sightings.filter(s =>
        sightingReportPending(s) && (s.status || 'pending') === 'pending'
    );
}

/** Helpful/recovered tips on still-active items only — history lives in My Reports */
function filterDashboardReviewedTips(sightings) {
    return sightings.filter(s => {
        if (!sightingReportPending(s)) return false;
        const st = s.status || 'pending';
        return st === 'helpful' || st === 'recovered';
    });
}

function renderSightingOwnerActions(s, reportPending) {
    const status = s.status || 'pending';
    if (status !== 'pending') {
        const pts = s.points_awarded ? ` · +${s.points_awarded} pts awarded` : '';
        return `${getSightingVerificationBadge(status)}${pts ? `<span style="font-size:0.8rem;color:#64748b;margin-left:6px;">${pts}</span>` : ''}`;
    }
    if (!reportPending) {
        return getSightingVerificationBadge('pending');
    }
    return `
        <div class="sighting-actions" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
            <button onclick="confirmSightingHelpful(${s.id}, ${s.report_id})" class="btn-secondary" style="padding:6px 10px;font-size:0.8rem;" title="Tip was accurate">✅ Helpful</button>
            <button onclick="confirmSightingRecovery(${s.id}, ${s.report_id})" class="btn-primary" style="padding:6px 10px;font-size:0.8rem;" title="They helped return your item">🎉 Recovered via them</button>
            <button onclick="dismissSighting(${s.id}, ${s.report_id})" class="btn-secondary" style="padding:6px 10px;font-size:0.8rem;color:#94a3b8;">Dismiss</button>
        </div>`;
}

async function findMatches(lostReport) {
    return findMatchesForReport(lostReport, fetchReports);
}

function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function validatePassword(p) { return p.length >= 6; }
function validateUsername(u) { return u.length >= 3 && /^[a-zA-Z0-9_]+$/.test(u); }

function showAuthAlert(id, message, type = 'error') {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.className = `auth-alert ${type}`;
    el.classList.remove('hidden');
}

function hideAuthAlert(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
}

function setBtnLoading(btnId, loading, label = '') {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    if (loading) {
        btn.dataset.originalText = btn.textContent;
        btn.textContent = label || 'Please wait...';
    } else if (btn.dataset.originalText) {
        btn.textContent = btn.dataset.originalText;
    }
}

function togglePassword(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? '🙈' : '👁';
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}

function mapAuthError(message) {
    if (!message) return 'Something went wrong. Please try again.';
    const lower = message.toLowerCase();
    if (lower.includes('email signups are disabled') || lower.includes('signup is disabled')) {
        return 'Email signups are disabled in Supabase. Enable them: Dashboard → Authentication → Providers → Email → turn on "Enable sign ups".';
    }
    if (lower.includes('email not confirmed')) {
        return 'Please confirm your email before signing in, or disable email confirmation in Supabase for demo use.';
    }
    if (lower.includes('invalid login credentials')) {
        return 'Incorrect email or password.';
    }
    if (lower.includes('user already registered')) {
        return 'This email is already registered. Try signing in instead.';
    }
    if (lower.includes('cannot coerce') || lower.includes('json object') || lower.includes('pgrst116')) {
        return 'Your account exists but the profile is missing. Run docs/sql/006_ensure_profile.sql in Supabase, then try again.';
    }
    if (lower.includes('ensure_user_profile')) {
        return 'Could not create your profile. Run docs/sql/006_ensure_profile.sql in Supabase SQL Editor.';
    }
    return message;
}

function clearAuthFormErrors() {
    hideAuthAlert('loginAlert');
    hideAuthAlert('registerAlert');
    document.querySelectorAll('.form-field input.input-error').forEach(el => {
        el.classList.remove('input-error');
    });
}

function showLanding() {
    document.getElementById('landing-page').classList.remove('hidden');
    document.getElementById('login').classList.add('hidden');
    document.getElementById('register').classList.add('hidden');
    document.getElementById('app').classList.add('hidden');
    clearAuthFormErrors();
}

function showLogin() {
    document.getElementById('landing-page').classList.add('hidden');
    document.getElementById('register').classList.add('hidden');
    document.getElementById('login').classList.remove('hidden');
    clearAuthFormErrors();
}

function showRegister() {
    document.getElementById('landing-page').classList.add('hidden');
    document.getElementById('login').classList.add('hidden');
    document.getElementById('register').classList.remove('hidden');
    clearAuthFormErrors();
}

function show(id) {
    if (id === 'login') showLogin();
    else if (id === 'register') showRegister();
}

function enterApp() {
    document.getElementById('login').classList.add('hidden');
    document.getElementById('register').classList.add('hidden');
    document.getElementById('landing-page').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    updateSidebar();
    startRealtime();
    startNotificationsRealtime();
    refreshNotifications();
    page('dashboard');
}

async function register(event) {
    if (event) event.preventDefault();

    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const username = document.getElementById('regUsername').value.trim();
    const role = document.getElementById('regRole').value;
    const idNumber = document.getElementById('regIdNumber').value.trim();
    const contact = document.getElementById('regContact').value.trim();
    const password = document.getElementById('regPassword').value;
    const rpass = document.getElementById('regRpass').value;

    hideAuthAlert('registerAlert');
    document.querySelectorAll('#registerForm .input-error').forEach(el => el.classList.remove('input-error'));

    if (!name || !email || !username || !password || !idNumber) {
        showAuthAlert('registerAlert', 'Please fill in all required fields.');
        return;
    }
    if (!validateEmail(email)) {
        document.getElementById('regEmail').classList.add('input-error');
        showAuthAlert('registerAlert', 'Enter a valid email address (e.g. name@icct.edu.ph).');
        return;
    }
    if (!validateUsername(username)) {
        document.getElementById('regUsername').classList.add('input-error');
        showAuthAlert('registerAlert', 'Username must be at least 3 characters (letters, numbers, underscore only).');
        return;
    }
    if (!validatePassword(password)) {
        document.getElementById('regPassword').classList.add('input-error');
        showAuthAlert('registerAlert', 'Password must be at least 6 characters.');
        return;
    }
    if (password !== rpass) {
        document.getElementById('regRpass').classList.add('input-error');
        showAuthAlert('registerAlert', 'Passwords do not match.');
        return;
    }

    setBtnLoading('registerBtn', true, 'Creating account...');

    try {
        const exists = await checkProfileExists({ username, email, id_number: idNumber });
        if (exists) {
            showAuthAlert('registerAlert', 'Username, email, or school ID is already registered.');
            return;
        }

        const { data, error } = await signUp({
            email,
            password,
            metadata: {
                username,
                name,
                id_number: idNumber,
                contact_number: contact,
                role_label: role
            }
        });

        if (error) {
            showAuthAlert('registerAlert', mapAuthError(error.message));
            return;
        }

        if (data.session) {
            currentUser = await waitForProfile(data.user.id);
            document.getElementById('registerForm').reset();
            enterApp();
            return;
        }

        showAuthAlert('registerAlert', 'Account created! Check your email to confirm, then sign in.', 'success');
        setTimeout(() => showLogin(), 2000);
        document.getElementById('registerForm').reset();
    } catch (err) {
        showAuthAlert('registerAlert', err.message || 'Registration failed. Please try again.');
    } finally {
        setBtnLoading('registerBtn', false);
    }
}

async function login(event) {
    if (event) event.preventDefault();

    const input = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    hideAuthAlert('loginAlert');
    document.querySelectorAll('#loginForm .input-error').forEach(el => el.classList.remove('input-error'));

    if (!input || !password) {
        showAuthAlert('loginAlert', 'Please enter your email/username and password.');
        return;
    }

    setBtnLoading('loginBtn', true, 'Signing in...');

    try {
        let email = input;
        if (!input.includes('@')) {
            const resolved = await getEmailByUsername(input);
            if (!resolved) {
                document.getElementById('loginUsername').classList.add('input-error');
                showAuthAlert('loginAlert', 'No account found with that username.');
                return;
            }
            email = resolved;
        }

        const { data, error } = await signIn(email, password);

        if (error) {
            showAuthAlert('loginAlert', mapAuthError(error.message), error.message.includes('Email not confirmed') ? 'info' : 'error');
            return;
        }

        if (!data.session) {
            showAuthAlert('loginAlert', 'Sign in failed. Please try again.');
            return;
        }

        currentUser = await waitForProfile(data.session.user.id);
        document.getElementById('loginForm').reset();
        enterApp();
    } catch (err) {
        showAuthAlert('loginAlert', err.message || 'Sign in failed. Please try again.');
    } finally {
        setBtnLoading('loginBtn', false);
    }
}

async function logout() {
    if (confirm('Are you sure you want to logout?')) {
        stopRealtime();
        stopNotificationsRealtime();
        _notifications = []; _notifUnread = 0;
        await signOut();
        currentUser = null;
        showLanding();
    }
}

function updateSidebar() {
    if (!currentUser) return;

    const sidebar = document.getElementById('sidebar');
    const initials = getUserInitials(currentUser.name);
    const isAdmin = currentUser.role === 'admin';
    const dashLabel = isAdmin ? 'Admin' : 'Dashboard';

    sidebar.innerHTML = `
        <div class="sidebar-header">
            <div class="sidebar-logo"></div>
            <h2>LostFinder</h2>
            <button class="notif-bell" onclick="openNotifications()" title="Notifications" aria-label="Notifications">
                🔔<span id="notifBadge" class="notif-badge hidden">0</span>
            </button>
        </div>
        <div class="user-profile">
            <div class="sidebar-avatar-initials">${esc(initials)}</div>
            <div class="user-info">
                <p class="user-name">${esc(currentUser.name)}${currentUser.role === 'admin' ? ' 👑' : ''}</p>
                <p class="user-points">⭐ <span id="currentUserPoints">${currentUser.points}</span> pts</p>
            </div>
        </div>
        <nav class="sidebar-nav">
            <a data-page="dashboard" onclick="page('dashboard')" class="active"><span class="nav-icon"></span> ${dashLabel}</a>
            <a data-page="lost" onclick="page('lost')"><span class="nav-icon"></span> Lost Items</a>
            <a data-page="found" onclick="page('found')"><span class="nav-icon"></span> Found Items</a>
            <a data-page="reports" onclick="page('reports')"><span class="nav-icon"></span> My Reports</a>
            <a data-page="my-claims" onclick="page('my-claims')"><span class="nav-icon"></span> My Claims</a>
            <a data-page="messages" onclick="page('messages')"><span class="nav-icon"></span> Messages</a>
            <a data-page="leaderboard" onclick="page('leaderboard')"><span class="nav-icon"></span> Leaderboard</a>
            <a data-page="settings" onclick="page('settings')"><span class="nav-icon"></span> Settings</a>
            <a onclick="logout()" class="logout-btn"><span class="nav-icon"></span> Logout</a>
        </nav>
    `;
    renderNotifBadge();
}

const ADMIN_PAGES = ['admin-panel', 'all-items', 'claims-panel', 'admin-users'];
const DYNAMIC_PAGES = ['notifications', 'my-claims'];

function page(id) {
    if (ADMIN_PAGES.includes(id) && currentUser?.role !== 'admin') {
        id = 'dashboard';
    }
    // Admins use the admin panel as their dashboard — avoid duplicate campus stats.
    if (id === 'dashboard' && currentUser?.role === 'admin') {
        id = 'admin-panel';
    }

    document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));
    document.querySelectorAll('main section').forEach(s => s.classList.add('hidden'));

    if ((ADMIN_PAGES.includes(id) || DYNAMIC_PAGES.includes(id)) && !document.getElementById(id)) {
        const sec = document.createElement('section');
        sec.id = id;
        sec.className = 'hidden';
        document.querySelector('.main').appendChild(sec);
    }

    const section = document.getElementById(id);
    if (section) section.classList.remove('hidden');

    if (ADMIN_PAGES.includes(id)) {
        document.querySelector('.sidebar-nav a[data-page="dashboard"]')?.classList.add('active');
    } else {
        const navPage = id === 'admin-panel' ? 'dashboard' : id;
        document.querySelector(`.sidebar-nav a[data-page="${navPage}"]`)?.classList.add('active');
    }

    if (id === 'dashboard')    loadDashboard();
    if (id === 'lost')         loadLostItems();
    if (id === 'found')        loadFoundItems();
    if (id === 'reports')      loadMyReports();
    if (id === 'leaderboard')  loadLeaderboard();
    if (id === 'messages')     enterMessagesPage();
    if (id === 'settings')     loadSettings();
    if (id === 'all-items')    loadAllItems();
    if (id === 'admin-panel')  loadAdminPanel();
    if (id === 'claims-panel') loadClaimsPanel();
    if (id === 'admin-users')  loadAdminUsers();
    if (id === 'notifications') loadNotifications();
    if (id === 'my-claims')    loadMyClaims();
}

function toggleVerificationQuestions() {
    const type = document.getElementById('reportType').value;
    const vs = document.getElementById('verificationSection');
    const dl = document.getElementById('reportDateLabel');
    dl.textContent = type === 'found' ? 'Date Found' : 'Date Lost';
    type === 'found' ? vs.classList.remove('hidden') : vs.classList.add('hidden');
}

function openReportModal() {
    document.getElementById('reportModal').style.display = 'flex';
    uploadedImageFile = null;
    document.getElementById('imagePreview').innerHTML = '';
    document.getElementById('reportImage').value = '';
    document.getElementById('reportDate').value = new Date().toISOString().split('T')[0];
    toggleVerificationQuestions();
}

function closeReportModal() {
    document.getElementById('reportModal').style.display = 'none';
}

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
        alert('❌ Image too large (max 5MB)');
        event.target.value = '';
        return;
    }
    const allowed = ['image/jpeg','image/jpg','image/png','image/gif','image/webp'];
    if (!allowed.includes(file.type)) {
        alert('❌ Only JPG, PNG, GIF, WEBP images allowed');
        event.target.value = '';
        return;
    }
    uploadedImageFile = file;
    const previewUrl = URL.createObjectURL(file);
    document.getElementById('imagePreview').innerHTML =
        `<img src="${previewUrl}" style="max-width:200px;max-height:200px;border-radius:8px;margin-top:10px;">`;
}

async function submitReport() {
    const type = document.getElementById('reportType').value;
    const category = document.getElementById('reportCategory').value;
    const itemName = document.getElementById('reportItemName').value.trim();
    const location = document.getElementById('reportLocation').value.trim();
    const date = document.getElementById('reportDate').value;
    const description = document.getElementById('reportDescription').value.trim();

    if (!itemName || !location || !description) {
        alert('❌ Please fill in all required fields');
        return;
    }
    if (itemName.length < 3) {
        alert('❌ Item name must be at least 3 characters');
        return;
    }
    if (description.length < 10) {
        alert('❌ Description must be at least 10 characters');
        return;
    }

    try {
        const weeklyCount = await getWeeklyReportCount(currentUser.id);
        if (weeklyCount >= WEEKLY_REPORT_LIMIT) {
            alert(`❌ Weekly report limit reached (${WEEKLY_REPORT_LIMIT} reports per week).\n\nPlease try again next week.`);
            return;
        }

        let verifyHashes = null;
        if (type === 'found') {
            const q1 = document.getElementById('verifyQ1').value.trim();
            const q2 = document.getElementById('verifyQ2').value.trim();
            const q3 = document.getElementById('verifyQ3').value.trim();
            if (!q1 || !q2 || !q3) {
                alert('❌ Please answer all 3 verification questions for found items.');
                return;
            }
            verifyHashes = { q1: simpleHash(q1), q2: simpleHash(q2), q3: simpleHash(q3) };
        }

        let newReport = await createReport({
            user_id: currentUser.id,
            user_name: currentUser.name,
            type, category, item_name: itemName,
            location, date_reported: date || null,
            description,
            image_url: '',
            verify_hashes: verifyHashes,
            contact_number: currentUser.contact_number || '',
            status: 'pending'
        });

        if (uploadedImageFile) {
            try {
                const imageUrl = await uploadReportImage(currentUser.id, newReport.id, uploadedImageFile);
                newReport = await updateReport(newReport.id, { image_url: imageUrl });
            } catch (imgErr) {
                alert('⚠️ Report saved but image upload failed: ' + imgErr.message);
            }
        }

        const points = type === 'lost' ? POINTS.lost : POINTS.found;
        currentUser = await addPoints(currentUser.id, points);
        updateSidebar();

        const remaining = WEEKLY_REPORT_LIMIT - (weeklyCount + 1);
        alert(`✅ Report submitted!\n\n🎉 +${points} points earned!\n⭐ Total: ${currentUser.points} pts\n\n📊 Weekly reports remaining: ${remaining}/${WEEKLY_REPORT_LIMIT}`);
        closeReportModal();

        if (type === 'lost') {
            const matches = await findMatches(newReport);
            if (matches.length > 0) {
                const topMatch = matches[0];
                setTimeout(() => {
                    alert(`🎯 Smart Match Found!\n\n"${topMatch.report.item_name}" at ${topMatch.report.location}\nMatch Score: ${topMatch.score}%\n\nCheck "Found Items" to view it!`);
                }, 300);
            }
        }

        ['reportItemName','reportLocation','reportDescription','verifyQ1','verifyQ2','verifyQ3'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        uploadedImageFile = null;
        document.getElementById('reportImage').value = '';

        page(type === 'lost' ? 'lost' : 'found');
    } catch (err) {
        alert('❌ Failed to submit report: ' + err.message);
    }
}

async function loadDashboard() {
    document.getElementById('myLostCount').textContent = '—';
    document.getElementById('myFoundCount').textContent = '—';
    document.getElementById('myResolvedCount').textContent = '—';
    cachedDashboardInsights = null;
    setDashboardDownloadButtons(false);
    showLoading('dashboardMatches', 'Loading dashboard...');

    try {
        if (currentUser.role === 'admin') {
            document.getElementById('dashboardMatches').innerHTML =
                '<p class="section-subtitle">Use the Admin section for campus-wide stats and claim review.</p>';
            setDashboardDownloadButtons(false);
            return;
        }

        const mine = await fetchReports({ userId: currentUser.id });
            document.getElementById('myLostCount').textContent = mine.filter(r => r.type === 'lost').length;
            document.getElementById('myFoundCount').textContent = mine.filter(r => r.type === 'found').length;
            document.getElementById('myResolvedCount').textContent = mine.filter(r => r.status === 'resolved').length;
            document.getElementById('dashLostLabel').textContent = 'My Lost Items';
            document.getElementById('dashFoundLabel').textContent = 'My Found Items';
            document.getElementById('dashResolvedLabel').textContent = 'Resolved';

            const myLost = mine.filter(r => r.type === 'lost' && r.status === 'pending');
            const matchesContainer = document.getElementById('dashboardMatches');

            let sightingsWarning = '';
            let ownerSightings = [];
            let mySubmittedSightings = [];

            const [ownerResult, submittedResult] = await Promise.all([
                safeFetchSightingsForOwner(currentUser.id),
                safeFetchMySightings(currentUser.id)
            ]);
            ownerSightings = ownerResult.data;
            mySubmittedSightings = submittedResult.data;

            const sightingsErr = ownerResult.error || submittedResult.error;
            if (sightingsErr) {
                if (isSightingsSchemaError(sightingsErr)) {
                    sightingsWarning = 'Sighting tips unavailable — run <code>007_sightings.sql</code> and <code>008_sighting_verification.sql</code> in Supabase SQL Editor.';
                } else {
                    sightingsWarning = `Sighting tips could not load: ${esc(sightingsErr.message)}`;
                }
            }

            const allMatches = [];
            try {
                const matchResults = await Promise.all(myLost.map(lr => findMatches(lr)));
                myLost.forEach((lr, i) => {
                    matchResults[i].forEach(m => allMatches.push({ lost: lr, found: m.report, score: m.score }));
                });
            } catch (matchErr) {
                console.error('Smart matches failed:', matchErr);
            }

            let html = '';
            if (sightingsWarning) {
                html += `<div class="verification-notice" style="background:#fef3c7;border-color:#fde047;color:#92400e;margin-bottom:16px;">⚠️ ${sightingsWarning}</div>`;
            }

            const pendingTips = filterDashboardPendingTips(ownerSightings);
            if (pendingTips.length > 0) {
                html += `
                    <div class="matches-section" style="border-left-color:#f59e0b;margin-bottom:16px;">
                        <h3>⏳ Tips Awaiting Your Review</h3>
                        <p style="color:#7f8c8d;margin-bottom:16px;">Confirm if these sightings were helpful or led to recovery — reporters earn points when verified.</p>
                        ${pendingTips.slice(0, 5).map(s => `
                            <div class="match-card">
                                <div class="match-info">
                                    <span class="match-lost-label">Item: <strong>${esc(s.reports?.item_name || 'Lost item')}</strong></span>
                                    <span style="margin-left:8px;color:#7f8c8d;font-size:0.9rem;">from ${esc(s.reporter_name)}</span>
                                </div>
                                ${getSightingMatchBadge(s.match_score)}
                                ${s.location_seen ? `<p style="margin:8px 0 4px;"><strong>📍</strong> ${esc(s.location_seen)}</p>` : ''}
                                <p style="margin:4px 0;">${esc(s.description)}</p>
                                ${renderSightingOwnerActions(s, sightingReportPending(s))}
                                <button onclick="openChat(${s.report_id}, '${s.reporter_id}', '${escapeQuotes(s.reporter_name)}', '${escapeQuotes(s.reports?.item_name || '')}')" class="btn-secondary" style="margin-top:8px;padding:6px 12px;font-size:0.85rem;">
                                    💬 Reply to ${esc(s.reporter_name)}
                                </button>
                            </div>
                        `).join('')}
                    </div>`;
            }

            const reviewedTips = filterDashboardReviewedTips(ownerSightings);
            if (reviewedTips.length > 0) {
                html += `
                    <div class="matches-section" style="border-left-color:#22c55e;margin-bottom:16px;">
                        <h3>✅ Verified Tips (active items)</h3>
                        <p style="color:#7f8c8d;margin-bottom:16px;">Tips you verified on items still open. Recovered items are cleared from this list.</p>
                        ${reviewedTips.slice(0, 5).map(s => `
                            <div class="match-card">
                                <div class="match-info">
                                    <span class="match-lost-label">Item: <strong>${esc(s.reports?.item_name || 'Lost item')}</strong></span>
                                    <span style="margin-left:8px;color:#7f8c8d;font-size:0.9rem;">from ${esc(s.reporter_name)}</span>
                                </div>
                                ${renderSightingOwnerActions(s, sightingReportPending(s))}
                                <p style="margin:4px 0;">${esc(s.description)}</p>
                                <button onclick="openChat(${s.report_id}, '${s.reporter_id}', '${escapeQuotes(s.reporter_name)}', '${escapeQuotes(s.reports?.item_name || '')}')" class="btn-secondary" style="margin-top:8px;padding:6px 12px;font-size:0.85rem;">
                                    💬 Message ${esc(s.reporter_name)}
                                </button>
                            </div>
                        `).join('')}
                    </div>`;
            }

            if (mySubmittedSightings.length > 0) {
                html += `
                    <div class="matches-section" style="border-left-color:#6366f1;margin-bottom:16px;">
                        <h3>📤 My Submitted Sightings</h3>
                        <p style="color:#7f8c8d;margin-bottom:16px;">Track whether owners verified your tips.</p>
                        ${mySubmittedSightings.slice(0, 5).map(s => `
                            <div class="match-card">
                                <div class="match-info">
                                    <span class="match-lost-label">${esc(s.reports?.item_name || 'Lost item')}</span>
                                    <span style="margin-left:8px;color:#7f8c8d;font-size:0.9rem;">owner: ${esc(s.reports?.user_name || 'Unknown')}</span>
                                </div>
                                ${getSightingVerificationBadge(s.status || 'pending')}
                                ${s.points_awarded ? `<span style="font-size:0.85rem;color:#2563eb;font-weight:600;">+${s.points_awarded} pts</span>` : ''}
                                <p style="margin:4px 0;">${esc(s.description)}</p>
                                ${s.reports?.user_id ? `
                                    <button onclick="openChat(${s.report_id}, '${s.reports.user_id}', '${escapeQuotes(s.reports.user_name || 'Owner')}', '${escapeQuotes(s.reports.item_name || '')}')" class="btn-secondary" style="margin-top:8px;padding:6px 12px;font-size:0.85rem;">
                                        💬 Message Owner
                                    </button>` : ''}
                            </div>
                        `).join('')}
                    </div>`;
            }

            if (allMatches.length > 0) {
                html += `
                    <div class="matches-section">
                        <h3>🎯 Smart Matches Found</h3>
                        <p style="color:#7f8c8d;margin-bottom:16px;">We found potential matches for your lost items!</p>
                        ${allMatches.slice(0, 3).map(m => `
                            <div class="match-card">
                                <div class="match-info">
                                    <span class="match-lost-label">Lost: <strong>${esc(m.lost.item_name)}</strong></span>
                                    <span style="margin:0 8px;color:#ccc;">→</span>
                                    <span class="match-found-label">Found: <strong>${esc(m.found.item_name)}</strong></span>
                                    <span style="margin-left:8px;color:#7f8c8d;font-size:0.9rem;">📍 ${esc(m.found.location)}</span>
                                </div>
                                ${getMatchBadge(m.score)}
                                <button onclick="openClaimModal(${m.found.id})" class="btn-primary" style="margin-top:8px;padding:8px 16px;font-size:0.9rem;">
                                    🔐 Claim This Item
                                </button>
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            if (!html.trim()) {
                html = `<div class="matches-section">
                    <h3>📊 Dashboard Insights</h3>
                    <p style="color:#7f8c8d;">No pending sighting tips or smart matches right now. Your stats above are current — use <strong>⬇️ JSON</strong> or <strong>⬇️ CSV</strong> to download your report data.</p>
                </div>`;
            }

            matchesContainer.innerHTML = html;

            cachedDashboardInsights = {
                generated_at: new Date().toISOString(),
                app: 'LostFinder',
                user: {
                    id: currentUser.id,
                    name: currentUser.name,
                    role: currentUser.role,
                    points: currentUser.points
                },
                summary: {
                    lost_label: 'My Lost Items',
                    lost_count: mine.filter(r => r.type === 'lost').length,
                    found_label: 'My Found Items',
                    found_count: mine.filter(r => r.type === 'found').length,
                    resolved_label: 'Resolved',
                    resolved_count: mine.filter(r => r.status === 'resolved').length,
                    points: currentUser.points
                },
                my_reports: mine.map(r => ({
                    id: r.id,
                    type: r.type,
                    item_name: r.item_name,
                    category: r.category,
                    location: r.location,
                    description: r.description,
                    status: r.status,
                    date_reported: r.date_reported,
                    created_at: r.created_at,
                    resolved_at: r.resolved_at || null
                })),
                smart_matches: allMatches.map(m => ({
                    lost_item_name: m.lost.item_name,
                    lost_location: m.lost.location,
                    found_item_name: m.found.item_name,
                    found_location: m.found.location,
                    score: m.score,
                    found_report_id: m.found.id
                })),
                sightings_received: ownerSightings.map(s => ({
                    id: s.id,
                    item_name: s.reports?.item_name,
                    reporter_name: s.reporter_name,
                    description: s.description,
                    location_seen: s.location_seen,
                    match_score: s.match_score,
                    match_label: s.match_label,
                    status: s.status || 'pending',
                    points_awarded: s.points_awarded || 0,
                    created_at: s.created_at
                })),
                sightings_submitted: mySubmittedSightings.map(s => ({
                    id: s.id,
                    item_name: s.reports?.item_name,
                    owner_name: s.reports?.user_name,
                    description: s.description,
                    location_seen: s.location_seen,
                    match_score: s.match_score,
                    match_label: s.match_label,
                    status: s.status || 'pending',
                    points_awarded: s.points_awarded || 0,
                    created_at: s.created_at
                }))
            };
        setDashboardDownloadButtons(true);
    } catch (err) {
        console.error('Dashboard load failed:', err);
        const hint = isSightingsSchemaError(err)
            ? ' Run docs/sql/007_sightings.sql and 008_sighting_verification.sql in Supabase.'
            : '';
        showEmpty('dashboardMatches', `Could not load dashboard: ${err.message || 'Unknown error'}.${hint}`);
        setDashboardDownloadButtons(false);

        // Still allow download of partial stats if reports loaded
        if (currentUser) {
            try {
                const mine = await fetchReports(
                    currentUser.role === 'admin' ? {} : { userId: currentUser.id }
                );
                const reports = currentUser.role === 'admin' ? mine : mine;
                cachedDashboardInsights = {
                    generated_at: new Date().toISOString(),
                    app: 'LostFinder',
                    partial: true,
                    error: err.message,
                    user: { id: currentUser.id, name: currentUser.name, role: currentUser.role, points: currentUser.points },
                    summary: {
                        lost_count: reports.filter(r => r.type === 'lost').length,
                        found_count: reports.filter(r => r.type === 'found').length,
                        resolved_count: reports.filter(r => r.status === 'resolved').length,
                        points: currentUser.points
                    },
                    my_reports: currentUser.role === 'admin' ? [] : reports.map(r => ({
                        id: r.id, type: r.type, item_name: r.item_name, status: r.status,
                        location: r.location, description: r.description, created_at: r.created_at
                    })),
                    smart_matches: [],
                    sightings_received: [],
                    sightings_submitted: []
                };
                setDashboardDownloadButtons(true);
            } catch (_) { /* ignore secondary failure */ }
        }
    }
}

function setDashboardDownloadButtons(enabled) {
    ['downloadInsightsJson', 'downloadInsightsCsv'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = !enabled;
    });
}

function downloadDashboardInsights(format) {
    if (!cachedDashboardInsights) {
        alert('Dashboard insights are not ready yet. Wait for the dashboard to finish loading, then try again.');
        return;
    }
    const date = new Date().toISOString().slice(0, 10);
    const slug = (currentUser?.name || 'user').replace(/[^\w\-]+/g, '-').toLowerCase();
    const base = `lostfinder-insights-${slug}-${date}`;

    try {
        if (format === 'csv') {
            downloadCsv(`${base}.csv`, dashboardInsightsToCsv(cachedDashboardInsights));
        } else {
            downloadJson(`${base}.json`, cachedDashboardInsights);
        }
    } catch (err) {
        alert('❌ Download failed: ' + err.message);
    }
}

async function loadLostItems() {
    showLoading('lostItemsContainer', 'Loading lost items...');
    try {
        cachedLostReports = await fetchReports({ type: 'lost', status: 'pending' });
        renderLostItems(cachedLostReports);
    } catch (err) {
        console.error('Load lost items failed:', err);
        showEmpty('lostItemsContainer', 'Could not load lost items.');
    }
}

function filterLostItems() {
    const q = document.getElementById('lostSearch').value.toLowerCase();
    const cat = document.getElementById('lostCategoryFilter').value;
    const filtered = cachedLostReports.filter(r => {
        const matchQ = !q || r.item_name.toLowerCase().includes(q) ||
            r.location.toLowerCase().includes(q) ||
            (r.description || '').toLowerCase().includes(q);
        const matchCat = !cat || r.category === cat;
        return matchQ && matchCat;
    });
    renderLostItems(filtered);
}

function renderLostItems(reports) {
    const container = document.getElementById('lostItemsContainer');
    if (reports.length === 0) {
        showEmpty('lostItemsContainer', 'No lost items reported yet.');
        return;
    }
    container.innerHTML = reports.map(r => {
        const imgHtml = r.image_url
            ? `<img src="${esc(r.image_url)}" alt="${esc(r.item_name)}" class="item-image">`
            : `<div class="item-image-placeholder">🔍</div>`;
        const isOwner = r.user_id === currentUser.id;
        return `
            <div class="card">
                <div class="card-badges">
                    <span class="status-badge lost">Lost</span>
                    ${r.category ? `<span class="category-badge">${esc(r.category)}</span>` : ''}
                </div>
                ${imgHtml}
                <h4>${esc(r.item_name)}</h4>
                <p><strong>📍</strong> ${esc(r.location)}</p>
                <p><strong>👤</strong> ${esc(r.user_name)}</p>
                <p><strong>📅</strong> ${r.date_reported || new Date(r.created_at).toLocaleDateString()}</p>
                <p style="margin-top:8px;">${esc(r.description)}</p>
                ${!isOwner ? `
                    <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
                        <button onclick="openSightingModal(${r.id})" class="btn-primary" style="flex:1;padding:10px;">
                            👁️ Submit Sighting
                        </button>
                        <button onclick="openChat(${r.id}, '${r.user_id}', '${escapeQuotes(r.user_name)}', '${escapeQuotes(r.item_name)}')" class="btn-secondary" style="flex:1;padding:10px;">
                            💬 Message Owner
                        </button>
                    </div>` : '<p style="color:#7f8c8d;font-size:0.9rem;margin-top:8px;">📌 This is your item</p>'}
            </div>`;
    }).join('');
}

async function loadFoundItems() {
    showLoading('foundItemsContainer', 'Loading found items...');
    try {
        cachedFoundReports = await fetchReports({ type: 'found', status: 'pending' });
        const myLost = currentUser.role !== 'admin'
            ? (await fetchReports({ userId: currentUser.id, type: 'lost', status: 'pending' }))
            : [];
        renderFoundItems(cachedFoundReports, myLost);
    } catch (err) {
        console.error('Load found items failed:', err);
        showEmpty('foundItemsContainer', 'Could not load found items.');
    }
}

function filterFoundItems() {
    const q = document.getElementById('foundSearch').value.toLowerCase();
    const cat = document.getElementById('foundCategoryFilter').value;
    const filtered = cachedFoundReports.filter(r => {
        const matchQ = !q || r.item_name.toLowerCase().includes(q) ||
            r.location.toLowerCase().includes(q) ||
            (r.description || '').toLowerCase().includes(q);
        const matchCat = !cat || r.category === cat;
        return matchQ && matchCat;
    });
    fetchReports({ userId: currentUser.id, type: 'lost', status: 'pending' })
        .then(myLost => renderFoundItems(filtered, myLost))
        .catch(() => renderFoundItems(filtered, []));
}

function renderFoundItems(reports, myLost) {
    const container = document.getElementById('foundItemsContainer');
    if (reports.length === 0) {
        showEmpty('foundItemsContainer', 'No found items reported yet.');
        return;
    }

    container.innerHTML = reports.map(r => {
        const imgHtml = r.image_url
            ? `<img src="${esc(r.image_url)}" alt="${esc(r.item_name)}" class="item-image">`
            : `<div class="item-image-placeholder">✅</div>`;
        const isOwner = r.user_id === currentUser.id;

        let badgeHtml = '';
        if (myLost.length > 0) {
            const bestScore = Math.max(...myLost.map(lr => calculateMatchScore(lr, r)));
            badgeHtml = getMatchBadge(bestScore);
        }

        return `
            <div class="card">
                <div class="card-badges">
                    <span class="status-badge found">Found</span>
                    ${r.category ? `<span class="category-badge">${esc(r.category)}</span>` : ''}
                </div>
                ${badgeHtml}
                ${imgHtml}
                <h4>${esc(r.item_name)}</h4>
                <p><strong>📍</strong> ${esc(r.location)}</p>
                <p><strong>👤</strong> Found by: ${esc(r.user_name)}</p>
                <p><strong>📅</strong> ${r.date_reported || new Date(r.created_at).toLocaleDateString()}</p>
                <p style="margin-top:8px;">${esc(r.description)}</p>
                ${!isOwner ? `
                    <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
                        ${r.verify_hashes ? `
                            <button onclick="openClaimModal(${r.id})" class="btn-primary" style="flex:1;padding:10px;">
                                🔐 Claim
                            </button>` : ''}
                        <button onclick="openChat(${r.id}, '${r.user_id}', '${escapeQuotes(r.user_name)}', '${escapeQuotes(r.item_name)}')" class="btn-secondary" style="flex:1;padding:10px;">
                            💬 Message
                        </button>
                    </div>` : '<p style="color:#7f8c8d;font-size:0.9rem;margin-top:8px;">📌 You found this item</p>'}
            </div>`;
    }).join('');
}

async function openClaimModal(reportId) {
    try {
        const report = await fetchReportById(reportId);
        if (!report.verify_hashes) {
            alert('This item has no verification questions set. Contact the finder via Messages.');
            return;
        }
        document.getElementById('claimItemTitle').textContent = `Item: "${report.item_name}" found at ${report.location}`;
        document.getElementById('claimReportId').value = reportId;
        ['claimQ1','claimQ2','claimQ3'].forEach(id => { document.getElementById(id).value = ''; });
        document.getElementById('claimModal').style.display = 'flex';
    } catch (err) {
        alert('❌ Could not load item: ' + err.message);
    }
}

function closeClaimModal() {
    document.getElementById('claimModal').style.display = 'none';
}

async function openSightingModal(reportId) {
    if (!currentUser) {
        alert('Please log in to submit a sighting.');
        return;
    }
    try {
        const report = cachedLostReports.find(r => r.id === reportId) || await fetchReportById(reportId);
        if (report.user_id === currentUser.id) {
            alert('You cannot submit a sighting on your own lost item.');
            return;
        }
        sightingReportId = reportId;
        sightingLostReport = report;
        sightingImageFile = null;

        document.getElementById('sightingItemTitle').textContent = `${report.item_name} — ${report.location}`;
        document.getElementById('sightingItemDesc').textContent = report.description || 'No description provided.';
        document.getElementById('sightingLocation').value = '';
        document.getElementById('sightingDescription').value = '';
        document.getElementById('sightingImage').value = '';
        document.getElementById('sightingImagePreview').innerHTML = '';
        document.getElementById('sightingMatchPreview').innerHTML = '';
        document.getElementById('sightingResult').classList.add('hidden');
        document.getElementById('sightingForm').classList.remove('hidden');
        document.getElementById('sightingModal').style.display = 'flex';
    } catch (err) {
        alert('❌ Could not load item: ' + err.message);
    }
}

function closeSightingModal() {
    document.getElementById('sightingModal').style.display = 'none';
    sightingReportId = null;
    sightingLostReport = null;
    sightingImageFile = null;
}

function updateSightingMatchPreview() {
    if (!sightingLostReport) return;
    const desc = document.getElementById('sightingDescription').value.trim();
    const loc = document.getElementById('sightingLocation').value.trim();
    const preview = document.getElementById('sightingMatchPreview');
    if (!desc) {
        preview.innerHTML = '';
        return;
    }
    const score = scoreSightingTip(sightingLostReport, desc, loc);
    preview.innerHTML = `<p style="font-size:0.85rem;color:#7f8c8d;margin-bottom:6px;">Estimated match with lost item:</p>${getSightingMatchBadge(score)}`;
}

function handleSightingImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        alert('Please select an image file.');
        event.target.value = '';
        return;
    }
    sightingImageFile = file;
    const reader = new FileReader();
    reader.onload = e => {
        document.getElementById('sightingImagePreview').innerHTML =
            `<img src="${e.target.result}" alt="Preview" style="max-width:100%;border-radius:8px;margin-top:8px;">`;
    };
    reader.readAsDataURL(file);
}

async function submitSighting() {
    const desc = document.getElementById('sightingDescription').value.trim();
    const loc = document.getElementById('sightingLocation').value.trim();

    if (!desc || desc.length < 10) {
        alert('Please describe what you saw (at least 10 characters).');
        return;
    }
    if (!sightingLostReport || !sightingReportId) return;

    const score = scoreSightingTip(sightingLostReport, desc, loc);
    const label = getSightingMatchLabel(score);

    setBtnLoading('sightingSubmitBtn', true, 'Submitting...');
    try {
        let imageUrl = '';
        if (sightingImageFile) {
            imageUrl = await uploadSightingImage(currentUser.id, Date.now(), sightingImageFile);
        }

        await createSighting({
            report_id: sightingReportId,
            reporter_id: currentUser.id,
            reporter_name: currentUser.name,
            description: desc,
            location_seen: loc,
            image_url: imageUrl,
            match_score: score,
            match_label: label,
            status: 'pending'
        });

        // Actually notify the owner (the result copy promises this).
        if (sightingLostReport?.user_id && sightingLostReport.user_id !== currentUser.id) {
            createNotification({
                user_id: sightingLostReport.user_id,
                type: 'sighting',
                title: 'New sighting tip on your lost item',
                body: `${currentUser.name} reported seeing "${sightingLostReport.item_name}"` +
                      (loc ? ` near ${loc}` : '') + `. Review it in My Reports.`,
                link: 'reports'
            });
        }

        document.getElementById('sightingForm').classList.add('hidden');
        document.getElementById('sightingResult').classList.remove('hidden');
        document.getElementById('sightingResultBadge').innerHTML = getSightingMatchBadge(score);
        document.getElementById('sightingResultText').textContent = getSightingResultMessage(score);

        const actions = document.getElementById('sightingResultActions');
        if (score >= 50) {
            const owner = sightingLostReport;
            actions.innerHTML = `
                <button onclick="closeSightingModal(); openChat(${owner.id}, '${owner.user_id}', '${escapeQuotes(owner.user_name)}', '${escapeQuotes(owner.item_name)}')"
                    class="btn-primary" style="flex:1;padding:10px;">
                    💬 Message Owner
                </button>`;
        } else {
            actions.innerHTML = '';
        }
    } catch (err) {
        alert('❌ Failed to submit sighting: ' + err.message);
    } finally {
        setBtnLoading('sightingSubmitBtn', false);
    }
}

async function verifySightingOwnership(sightingId, reportId) {
    const [sighting, report] = await Promise.all([
        fetchSightingById(sightingId),
        fetchReportById(reportId)
    ]);
    if (report.user_id !== currentUser.id) throw new Error('Only the item owner can verify sightings');
    if (sighting.report_id !== reportId) throw new Error('Sighting does not match this item');
    return { sighting, report };
}

async function confirmSightingHelpful(sightingId, reportId) {
    if (!confirm(`Mark this tip as helpful? The reporter earns +${POINTS.sightingHelpful} points.`)) return;
    try {
        const { sighting } = await verifySightingOwnership(sightingId, reportId);
        if (sighting.status !== 'pending') {
            alert('This sighting was already reviewed.');
            return;
        }
        await updateSighting(sightingId, {
            status: 'helpful',
            verified_at: new Date().toISOString(),
            verified_by: currentUser.id,
            points_awarded: POINTS.sightingHelpful
        });
        await addPoints(sighting.reporter_id, POINTS.sightingHelpful);
        alert(`✅ Tip verified helpful! ${sighting.reporter_name} earned +${POINTS.sightingHelpful} points.`);
        loadMyReports();
        loadDashboard();
    } catch (err) {
        alert('❌ ' + err.message);
    }
}

async function creditSightingRecovery(sightingId, reportId) {
    const { sighting, report } = await verifySightingOwnership(sightingId, reportId);
    if (report.status === 'resolved') throw new Error('This item is already marked recovered');
    if (!['pending', 'helpful'].includes(sighting.status || 'pending')) {
        throw new Error('This sighting cannot be credited for recovery');
    }

    const recoveryPoints = POINTS.sightingRecovered;
    const totalAwarded = (sighting.points_awarded || 0) + recoveryPoints;

    await updateSighting(sightingId, {
        status: 'recovered',
        verified_at: new Date().toISOString(),
        verified_by: currentUser.id,
        points_awarded: totalAwarded
    });
    await updateReport(reportId, {
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        recovery_sighting_id: sightingId
    });
    await addPoints(sighting.reporter_id, recoveryPoints);
    currentUser = await addPoints(currentUser.id, POINTS.resolved);

    alert(`🎉 Item recovered! ${sighting.reporter_name} earned +${recoveryPoints} points. You earned +${POINTS.resolved} points.`);
    loadMyReports();
    loadDashboard();
    loadLostItems();
}

async function confirmSightingRecovery(sightingId, reportId) {
    if (!confirm(`Confirm this person helped you recover your item?\n\nThey earn +${POINTS.sightingRecovered} points and your item will be marked resolved.`)) return;
    try {
        await creditSightingRecovery(sightingId, reportId);
    } catch (err) {
        alert('❌ ' + err.message);
    }
}

async function dismissSighting(sightingId, reportId) {
    if (!confirm('Dismiss this tip as not helpful?')) return;
    try {
        const { sighting } = await verifySightingOwnership(sightingId, reportId);
        if (sighting.status !== 'pending') {
            alert('This sighting was already reviewed.');
            return;
        }
        await updateSighting(sightingId, {
            status: 'dismissed',
            verified_at: new Date().toISOString(),
            verified_by: currentUser.id
        });
        loadMyReports();
        loadDashboard();
    } catch (err) {
        alert('❌ ' + err.message);
    }
}

async function openRecoveryModal(reportId) {
    try {
        const report = await fetchReportById(reportId);
        if (report.user_id !== currentUser.id) {
            alert('Only the item owner can mark it recovered.');
            return;
        }
        if (report.status === 'resolved') {
            alert('This item is already marked recovered.');
            return;
        }

        document.getElementById('recoveryReportId').value = reportId;
        document.getElementById('recoveryItemTitle').textContent = `${report.item_name} — ${report.location}`;

        const select = document.getElementById('recoveryCredit');
        select.innerHTML = '<option value="">Found it on my own / other way</option>';

        const tips = await fetchSightingsForReport(reportId);
        tips
            .filter(s => ['pending', 'helpful'].includes(s.status || 'pending'))
            .forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                const preview = s.description.length > 60 ? s.description.slice(0, 60) + '…' : s.description;
                opt.textContent = `${s.reporter_name}: ${preview}`;
                select.appendChild(opt);
            });

        document.getElementById('recoveryModal').style.display = 'flex';
    } catch (err) {
        alert('❌ ' + err.message);
    }
}

function closeRecoveryModal() {
    document.getElementById('recoveryModal').style.display = 'none';
}

async function submitLostRecovery() {
    const reportId = parseInt(document.getElementById('recoveryReportId').value);
    const sightingId = document.getElementById('recoveryCredit').value;

    setBtnLoading('recoverySubmitBtn', true, 'Saving...');
    try {
        if (sightingId) {
            await creditSightingRecovery(parseInt(sightingId), reportId);
        } else {
            if (!confirm(`Mark this item as recovered? You earn +${POINTS.resolved} points.`)) return;
            const report = await fetchReportById(reportId);
            if (report.user_id !== currentUser.id) throw new Error('Not your report');
            if (report.status === 'resolved') throw new Error('Already recovered');
            await updateReport(reportId, {
                status: 'resolved',
                resolved_at: new Date().toISOString()
            });
            currentUser = await addPoints(currentUser.id, POINTS.resolved);
            alert(`✅ Item marked recovered! +${POINTS.resolved} points`);
            loadMyReports();
            loadDashboard();
            loadLostItems();
        }
        closeRecoveryModal();
    } catch (err) {
        alert('❌ ' + err.message);
    } finally {
        setBtnLoading('recoverySubmitBtn', false);
    }
}

async function submitClaim() {
    const reportId = parseInt(document.getElementById('claimReportId').value, 10);
    const a1 = document.getElementById('claimQ1').value.trim();
    const a2 = document.getElementById('claimQ2').value.trim();
    const a3 = document.getElementById('claimQ3').value.trim();

    if (!a1 || !a2 || !a3) {
        alert('❌ Please answer all verification questions');
        return;
    }
    if (!reportId || Number.isNaN(reportId)) {
        alert('❌ Invalid item. Close the form and try again.');
        return;
    }

    try {
        const result = await submitClaimRpc(reportId, a1, a2, a3);
        closeClaimModal();

        if (result.exact_match) {
            // Unified flow: verified → ready for pickup (NOT auto-resolved).
            alert(
                `✅ Ownership Verified!\n\n` +
                `🎟️ Your Retrieval Code: ${result.retrieval_code}\n` +
                `(valid 48 hours)\n\n` +
                `The item is still held by the finder. Coordinate the handover, then it is confirmed and the case closes.\n\n` +
                `Track everything under "My Claims".`
            );
            loadFoundItems();
            loadDashboard();
            page('my-claims');
        } else if (result.vague) {
            toast('Your answers were brief — claim flagged for admin review. Track it under My Claims.', 'info');
            page('my-claims');
        } else {
            toast('Answers did not match exactly — claim sent for admin review. Track it under My Claims.', 'info');
            page('my-claims');
        }
    } catch (err) {
        console.error('submitClaim failed:', err);
        toast('Failed to submit claim: ' + err.message, 'error');
    }
}

// ============ MY CLAIMS (CLAIMANT TRACKER) ============
const CLAIM_STEPS = ['Submitted', 'Verified', 'Ready for pickup', 'Completed'];

function claimStepIndex(c) {
    if (c.status === 'denied') return -1;
    if (c.status === 'completed') return 3;
    if (c.status === 'approved' || c.status === 'auto-approved') return 2;
    if (c.exact_match) return 1;
    return 0; // pending-review
}

function renderClaimStepper(c) {
    const active = claimStepIndex(c);
    if (active === -1) {
        return '<div class="claim-stepper denied"><span class="step-denied">✖ Claim denied</span></div>';
    }
    return `<div class="claim-stepper">
        ${CLAIM_STEPS.map((label, i) => `
            <div class="claim-step ${i <= active ? 'done' : ''} ${i === active ? 'current' : ''}">
                <span class="step-dot">${i < active ? '✓' : i + 1}</span>
                <span class="step-label">${label}</span>
            </div>`).join('<span class="step-line"></span>')}
    </div>`;
}

async function loadMyClaims() {
    const container = document.getElementById('my-claims');
    if (!container) return;
    container.innerHTML = '<h2>My Claims</h2><p class="section-subtitle">Track every item you have claimed</p><div class="empty-state"><p>Loading…</p></div>';
    try {
        const claims = await fetchClaimsByClaimant(currentUser.id);
        if (!claims.length) {
            container.innerHTML = `
                <h2>My Claims</h2>
                <p class="section-subtitle">Track every item you have claimed</p>
                <div class="empty-state"><p>You haven't claimed any items yet. Browse <a onclick="page('found')" style="cursor:pointer;color:#2563eb;">Found Items</a> to make a claim.</p></div>`;
            return;
        }
        container.innerHTML = `
            <h2>My Claims</h2>
            <p class="section-subtitle">Track every item you have claimed</p>
            <div class="claims-list">${claims.map(c => renderMyClaimCard(c)).join('')}</div>`;
    } catch (err) {
        container.innerHTML = `<h2>My Claims</h2><p style="color:red;padding:20px;">Could not load your claims: ${esc(err.message)}</p>`;
    }
}

function renderMyClaimCard(c) {
    const r = c.report;
    const meta = claimStatusMeta(c.status);
    const code = c.retrieval_code;
    const expired = c.expires_at && new Date(c.expires_at) < new Date();
    const readyForPickup = isClaimAwaitingHandover(c.status);

    const codeBlock = (code && readyForPickup) ? `
        <div class="claim-code-block">
            <span style="font-size:0.8rem;color:#7f8c8d;font-weight:600;">Retrieval Code:</span>
            <code>${esc(code)}</code>
            <button class="btn-secondary" style="padding:3px 10px;font-size:0.78rem;" onclick="copyText('${esc(code)}')">Copy</button>
            ${c.expires_at ? `<span class="claim-expiry ${expired ? 'expired' : ''}">${expired ? 'Expired' : 'Expires'} ${new Date(c.expires_at).toLocaleString()}</span>` : ''}
        </div>
        ${c.pickup_location ? `<p style="margin-top:8px;"><strong>📍 Pickup location:</strong> ${esc(c.pickup_location)}</p>` : ''}` : '';

    const guidance = c.status === 'pending-review'
        ? '<p class="claim-guidance">An admin is reviewing your claim. You will be notified when there is an update.</p>'
        : readyForPickup
        ? '<p class="claim-guidance">Your ownership is verified. Present the code above to collect your item, then the finder/admin confirms the handover.</p>'
        : c.status === 'completed'
        ? '<p class="claim-guidance done">This case is closed. Item returned — thank you!</p>'
        : c.status === 'denied'
        ? '<p class="claim-guidance denied">This claim was denied. Check Messages for the reason, or contact the admin.</p>'
        : '';

    return `
        <div class="claim-card-v2 status-${c.status}">
            <div class="claim-card-body">
                <div class="claim-card-top">
                    <h4 class="claim-item-name">${esc(c.item_name)}</h4>
                    <span class="status-badge ${meta.cls}">${meta.label}</span>
                </div>
                <div class="claim-date-row"><span>Claimed ${timeAgo(c.created_at)}</span></div>
                ${renderClaimStepper(c)}
                ${guidance}
                ${codeBlock}
                ${r ? `<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn-secondary" onclick="openChat(${c.report_id},'${r.user_id}','${escapeQuotes(r.user_name)}','${escapeQuotes(c.item_name)}')">💬 Message Finder</button>
                </div>` : ''}
            </div>
        </div>`;
}

function copyText(text) {
    navigator.clipboard?.writeText(text).then(
        () => toast('Copied to clipboard', 'success'),
        () => toast('Could not copy', 'error')
    );
}

// Finder (or admin) confirms physical handover via the secure RPC.
async function confirmHandover(claimId, btnLabel = 'Confirm Handover') {
    if (!confirm('Confirm you have physically handed this item to the claimant?\n\nThis marks the case resolved and awards you points. It cannot be undone.')) return;
    const btns = document.querySelectorAll(`[data-handover="${claimId}"]`);
    btns.forEach(b => { b.disabled = true; b.textContent = 'Confirming…'; });
    try {
        await confirmHandoverRpc(claimId);
        currentUser = await getProfile(currentUser.id) || currentUser;
        updateSidebar();
        toast('Handover confirmed — case closed. Thank you!', 'success');
        refreshNotifications();
        // Refresh whichever view is open
        if (!document.getElementById('reports')?.classList.contains('hidden')) loadMyReports();
        if (!document.getElementById('claims-panel')?.classList.contains('hidden')) loadClaimsPanel();
    } catch (err) {
        toast('Failed to confirm handover: ' + err.message, 'error');
        btns.forEach(b => { b.disabled = false; b.textContent = btnLabel; });
    }
}

async function loadMyReports() {
    showLoading('myLostReports', 'Loading your reports...');
    showLoading('myFoundReports', 'Loading your reports...');
    document.getElementById('lostTabCount').textContent = '—';
    document.getElementById('foundTabCount').textContent = '—';

    try {
        const mine = await fetchReports({ userId: currentUser.id });
        const lost = mine.filter(r => r.type === 'lost');
        const found = mine.filter(r => r.type === 'found');
        document.getElementById('lostTabCount').textContent = lost.length;
        document.getElementById('foundTabCount').textContent = found.length;

        const weekly = await getWeeklyReportCount(currentUser.id);
        const remaining = WEEKLY_REPORT_LIMIT - weekly;
        document.getElementById('weeklyLimitInfo').innerHTML = `
            <div class="weekly-info-bar">
                📊 Weekly Reports: <strong>${weekly}/${WEEKLY_REPORT_LIMIT}</strong> used &nbsp;|&nbsp;
                <strong>${remaining}</strong> remaining this week
                ${remaining === 0 ? '<span class="limit-warning"> ⚠️ Limit reached</span>' : ''}
            </div>`;

        const ownerSightings = await fetchSightingsForOwner(currentUser.id);
        const sightingsByReport = {};
        ownerSightings.forEach(s => {
            if (!sightingsByReport[s.report_id]) sightingsByReport[s.report_id] = [];
            sightingsByReport[s.report_id].push(s);
        });
        renderReportsList('myLostReports', lost, sightingsByReport);
        renderReportsList('myFoundReports', found);
        renderFinderClaimsBlock();
    } catch (err) {
        console.error('Load my reports failed:', err);
        showEmpty('myLostReports', 'Could not load reports.');
        showEmpty('myFoundReports', 'Could not load reports.');
    }
}

// "Claims on my items" — the finder sees who claimed the items they reported,
// and confirms the physical handover (closes the loop + earns points).
async function renderFinderClaimsBlock() {
    const host = document.getElementById('reports');
    if (!host) return;
    let block = document.getElementById('finderClaimsBlock');
    if (!block) {
        block = document.createElement('div');
        block.id = 'finderClaimsBlock';
        const anchor = document.getElementById('weeklyLimitInfo');
        anchor?.insertAdjacentElement('afterend', block);
    }
    let claims = [];
    try {
        claims = await fetchClaimsByFinder(currentUser.id);
    } catch {
        block.innerHTML = '';
        return;
    }
    // Only show claims that need the finder's attention or are in progress.
    const active = claims.filter(c => ['pending-review', 'approved', 'auto-approved'].includes(c.status));
    if (!active.length) { block.innerHTML = ''; return; }

    block.innerHTML = `
        <div class="finder-claims-card">
            <h3>📥 Claims on items you found</h3>
            <p class="section-subtitle" style="margin-bottom:14px;">Someone is claiming an item you turned in. Confirm the handover once you physically return it.</p>
            ${active.map(c => {
                const meta = claimStatusMeta(c.status);
                const ready = isClaimAwaitingHandover(c.status);
                return `
                <div class="finder-claim-row">
                    <div class="finder-claim-info">
                        <strong>${esc(c.item_name)}</strong>
                        <span class="status-badge ${meta.cls}" style="font-size:0.72rem;margin-left:8px;">${meta.label}</span>
                        <div class="finder-claim-sub">Claimed by ${esc(c.claimant_name)} · ${timeAgo(c.created_at)}</div>
                        ${ready && c.retrieval_code ? `<div class="finder-claim-sub">Ask the claimant for code <code>${esc(c.retrieval_code)}</code> before releasing.</div>` : ''}
                        ${c.status === 'pending-review' ? `<div class="finder-claim-sub">Verification was not exact — an admin will review before handover.</div>` : ''}
                    </div>
                    <div class="finder-claim-actions">
                        <button class="btn-secondary" onclick="openChat(${c.report_id},'${c.claimant_id}','${escapeQuotes(c.claimant_name)}','${escapeQuotes(c.item_name)}')">💬 Message</button>
                        ${ready ? `<button class="btn-primary" data-handover="${c.id}" onclick="confirmHandover(${c.id})">Confirm Handover</button>` : ''}
                    </div>
                </div>`;
            }).join('')}
        </div>`;
}

function renderSightingsBlock(sightings, reportStatus) {
    const reportPending = reportStatus === 'pending';
    return `
        <div class="sightings-block">
            <h5>👁️ ${sightings.length} sighting tip${sightings.length === 1 ? '' : 's'}</h5>
            <div class="sightings-block-grid">
            ${sightings.map(s => `
                <div class="sighting-card">
                    ${getSightingMatchBadge(s.match_score)}
                    ${renderSightingOwnerActions(s, reportPending)}
                    <p style="margin:6px 0;"><strong>${esc(s.reporter_name)}</strong> · ${new Date(s.created_at).toLocaleString()}</p>
                    ${s.location_seen ? `<p><strong>📍</strong> ${esc(s.location_seen)}</p>` : ''}
                    <p>${esc(s.description)}</p>
                    ${s.image_url ? `<img src="${esc(s.image_url)}" alt="Sighting photo">` : ''}
                    <button onclick="openChat(${s.report_id}, '${s.reporter_id}', '${escapeQuotes(s.reporter_name)}', '')" class="btn-secondary" style="margin-top:8px;padding:6px 12px;font-size:0.85rem;">
                        💬 Message ${esc(s.reporter_name)}
                    </button>
                </div>
            `).join('')}
            </div>
        </div>`;
}

function renderReportsList(containerId, reports, sightingsByReport = {}) {
    const container = document.getElementById(containerId);
    if (reports.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No items reported yet.</p></div>';
        return;
    }
    container.innerHTML = reports.map(r => {
        const status = reportStatusMeta(r.status);
        const statusLabel = r.status === 'resolved' ? '✅ Resolved'
            : r.status === 'claimed' ? '🤝 Awaiting Handover'
            : '⏳ Pending';
        const imgHtml = r.image_url
            ? `<img class="report-card-img" src="${esc(r.image_url)}" alt="${esc(r.item_name)}">`
            : `<div class="report-card-img placeholder">${r.type === 'lost' ? '🔍' : '📦'}</div>`;
        const dateStr = r.date_reported || new Date(r.created_at).toLocaleDateString();
        const sightingsBlock = (r.type === 'lost' && sightingsByReport[r.id]?.length)
            ? renderSightingsBlock(sightingsByReport[r.id], r.status) : '';
        return `
            <div class="card report-card">
                <div class="report-card-main">
                    <div class="report-card-media">${imgHtml}</div>
                    <div class="report-card-body">
                        <div class="card-badges">
                            <span class="status-badge ${status.cls}">${statusLabel}</span>
                            ${r.category ? `<span class="category-badge">${esc(r.category)}</span>` : ''}
                        </div>
                        <h4>${esc(r.item_name)}</h4>
                        <div class="report-card-meta">
                            <span><strong>📍</strong> ${esc(r.location)}</span>
                            <span><strong>📅</strong> ${dateStr}</span>
                        </div>
                        <p class="report-card-desc">${esc(r.description)}</p>
                        ${r.type === 'found' && r.verify_hashes ? '<p class="report-card-verify">🔒 Verification questions set</p>' : ''}
                        <div class="report-card-actions">
                            ${r.type === 'lost' && r.status === 'pending' ? `
                                <button onclick="openRecoveryModal(${r.id})" class="btn-primary">✅ Mark Item Recovered</button>` : ''}
                        </div>
                    </div>
                </div>
                ${sightingsBlock}
            </div>`;
    }).join('');
}

function showReportTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.currentTarget.classList.add('active');
    document.getElementById('lostReports').classList.toggle('hidden', tab !== 'lost');
    document.getElementById('foundReports').classList.toggle('hidden', tab !== 'found');
}

async function loadLeaderboard() {
    const table = document.getElementById('leaderboardTable');
    table.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:#64748b;">Loading leaderboard...</td></tr>';
    try {
        const users = await fetchLeaderboardUsers();
        const reports = await fetchReports();
        if (users.length === 0) {
            table.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;">No users on the leaderboard yet.</td></tr>';
            return;
        }
        table.innerHTML = users.map((user, i) => {
            const rank = i + 1;
            const icon = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
            const badge = getBadgeLabel(user.points);
            const rCount = reports.filter(r => r.user_id === user.id).length;
            const isMe = currentUser && user.id === currentUser.id;
            return `
                <tr style="${isMe ? 'background:#f0f4ff;font-weight:600;' : ''}">
                    <td style="font-size:1.5rem;">${icon}</td>
                    <td>${esc(user.name)} ${isMe ? '<span style="color:#2563eb;">(You)</span>' : ''}</td>
                    <td style="font-weight:700;color:#2563eb;">${user.points}</td>
                    <td>${rCount}</td>
                    <td>${badge}</td>
                </tr>`;
        }).join('');
    } catch (err) {
        console.error('Leaderboard load failed:', err);
        document.getElementById('leaderboardTable').innerHTML =
            '<tr><td colspan="5" style="text-align:center;padding:20px;">Could not load leaderboard.</td></tr>';
    }
}

function loadSettings() {
    document.getElementById('settingsName').value = currentUser.name || '';
    document.getElementById('settingsEmail').value = currentUser.email || '';
    document.getElementById('settingsUsername').value = currentUser.username || '';
    document.getElementById('settingsRole').value = currentUser.role_label || 'Student';
    document.getElementById('settingsContact').value = currentUser.contact_number || '';
    hideAuthAlert('settingsAlert');
}

async function saveSettings() {
    const name = document.getElementById('settingsName').value.trim();
    const contact = document.getElementById('settingsContact').value.trim();
    hideAuthAlert('settingsAlert');

    if (!name) {
        showAuthAlert('settingsAlert', 'Name cannot be empty.');
        return;
    }

    setBtnLoading('settingsSaveBtn', true, 'Saving...');

    try {
        currentUser = await updateProfile(currentUser.id, { name, contact_number: contact });
        updateSidebar();
        showAuthAlert('settingsAlert', 'Settings saved successfully.', 'success');
    } catch (err) {
        showAuthAlert('settingsAlert', err.message || 'Failed to save settings.');
    } finally {
        setBtnLoading('settingsSaveBtn', false);
    }
}

// Returns the shared tab bar HTML injected at the top of every admin page.
// Pass the current tab key so that tab is highlighted.
// Counts are optional — shown as small badges on the tab.
function adminTabBar(activeTab, { pendingClaims = 0, awaitingHandover = 0 } = {}) {
    const tabs = [
        { key: 'admin-panel',  label: 'Dashboard', icon: '📊', badge: null },
        { key: 'all-items',    label: 'Items',      icon: '📋', badge: null },
        {
            key: 'claims-panel', label: 'Claims', icon: '🔐',
            badge: pendingClaims > 0  ? { text: pendingClaims,      cls: '' }
                 : awaitingHandover > 0 ? { text: awaitingHandover, cls: 'amber' }
                 : null
        },
        { key: 'admin-users',  label: 'Users',      icon: '👤', badge: null },
    ];
    return `
        <div class="admin-section-tabs">
            ${tabs.map(t => `
                <button class="admin-section-tab ${activeTab === t.key ? 'active' : ''}"
                        onclick="page('${t.key}')">
                    <span>${t.icon}</span>${t.label}
                    ${t.badge ? `<span class="tab-badge ${t.badge.cls}">${t.badge.text}</span>` : ''}
                </button>`).join('')}
        </div>`;
}

async function loadAdminPanel() {
    const freshRole = await getMyRole();
    if (freshRole !== 'admin') { currentUser.role = freshRole; page('dashboard'); return; }
    currentUser.role = freshRole;
    showLoading('admin-panel', 'Loading admin dashboard...');
    try {
        const [allProfiles, reports, claims] = await Promise.all([
            fetchAllProfiles(), fetchReports(), fetchClaims()
        ]);
        const users = allProfiles.filter(u => u.role === 'user');

        const stats = {
            users: users.length,
            lost: reports.filter(r => r.type === 'lost' && r.status === 'pending').length,
            found: reports.filter(r => r.type === 'found' && r.status === 'pending').length,
            resolved: reports.filter(r => r.status === 'resolved').length,
            pendingClaims:    claims.filter(c => c.status === 'pending-review').length,
            awaitingHandover: claims.filter(c => isClaimAwaitingHandover(c.status)).length,
        };
        const recentReports = [...reports].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6);
        const recentClaims  = [...claims].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);

        const inboxItems = [];
        if (stats.pendingClaims > 0) {
            inboxItems.push(`
                <button type="button" class="admin-inbox-item urgent" onclick="page('claims-panel')">
                    <span class="inbox-icon">🔐</span>
                    <span class="inbox-text"><strong>${stats.pendingClaims}</strong> claim${stats.pendingClaims > 1 ? 's' : ''} need review</span>
                    <span class="inbox-cta">Review claims →</span>
                </button>`);
        }
        if (stats.awaitingHandover > 0) {
            inboxItems.push(`
                <button type="button" class="admin-inbox-item warn" onclick="page('claims-panel')">
                    <span class="inbox-icon">⏳</span>
                    <span class="inbox-text"><strong>${stats.awaitingHandover}</strong> awaiting handover confirmation</span>
                    <span class="inbox-cta">Confirm handover →</span>
                </button>`);
        }
        const inboxHtml = inboxItems.length
            ? `<div class="admin-inbox">${inboxItems.join('')}</div>`
            : `<div class="admin-inbox-clear">✓ All caught up — no claims waiting for you</div>`;

        document.getElementById('admin-panel').innerHTML = `
            <div class="admin-page">
            ${adminTabBar('admin-panel', { pendingClaims: stats.pendingClaims, awaitingHandover: stats.awaitingHandover })}

            <header class="admin-page-header">
                <div>
                    <h2>Admin</h2>
                    <p class="section-subtitle">Review claims, manage items, and monitor campus activity</p>
                </div>
            </header>

            ${inboxHtml}

            <div class="admin-activity-grid">
                <section class="admin-activity-panel">
                    <div class="activity-section-header">
                        <h3>Recent reports</h3>
                        <button class="btn-secondary btn-sm" onclick="page('all-items')">View all</button>
                    </div>
                    <div class="activity-feed">
                        ${recentReports.length === 0 ? '<p class="activity-empty">No reports yet.</p>' :
                        recentReports.map(r => `
                            <div class="activity-item type-${r.type}">
                                <div class="activity-dot type-${r.type}"></div>
                                <div class="activity-body">
                                    <strong>${esc(r.item_name)}</strong>
                                    <div class="activity-meta">${r.type === 'lost' ? 'Lost' : 'Found'} by ${esc(r.user_name)} · ${timeAgo(r.created_at)}</div>
                                </div>
                                <span class="status-badge ${reportStatusMeta(r.status).cls} sm">${reportStatusMeta(r.status, { short: true }).label}</span>
                            </div>`).join('')}
                    </div>
                </section>
                <section class="admin-activity-panel">
                    <div class="activity-section-header">
                        <h3>Recent claims</h3>
                        <button class="btn-secondary btn-sm" onclick="page('claims-panel')">View all</button>
                    </div>
                    <div class="activity-feed">
                        ${recentClaims.length === 0 ? '<p class="activity-empty">No claims yet.</p>' :
                        recentClaims.map(c => `
                            <div class="activity-item type-claim">
                                <div class="activity-dot type-claim"></div>
                                <div class="activity-body">
                                    <strong>${esc(c.item_name)}</strong>
                                    <div class="activity-meta">${esc(c.claimant_name)} · ${timeAgo(c.created_at)}</div>
                                </div>
                                <span class="status-badge ${claimStatusMeta(c.status).cls} sm">${claimStatusMeta(c.status, { short: true }).label}</span>
                            </div>`).join('')}
                    </div>
                </section>
            </div>
            </div>`;
    } catch (err) {
        console.error('Admin panel load failed:', err);
        document.getElementById('admin-panel').innerHTML = '<p style="color:red;padding:20px;">Failed to load admin panel: ' + esc(err.message) + '</p>';
    }
}

let _adminAllReports = [];

async function loadAllItems() {
    const freshRole = await getMyRole();
    if (freshRole !== 'admin') { currentUser.role = freshRole; page('dashboard'); return; }
    currentUser.role = freshRole;
    showLoading('all-items', 'Loading all items...');
    try {
        _adminAllReports = await fetchReports();
        renderAllItems();
    } catch (err) {
        console.error('Load all items failed:', err);
        document.getElementById('all-items').innerHTML = '<p style="color:red;padding:20px;">Failed to load items: ' + esc(err.message) + '</p>';
    }
}

function renderAllItems() {
    const container = document.getElementById('all-items');
    const typeFilter = document.getElementById('adminItemType')?.value || 'all';
    const statusFilter = document.getElementById('adminItemStatus')?.value || 'all';
    const searchVal = (document.getElementById('adminItemSearch')?.value || '').toLowerCase().trim();

    let reports = _adminAllReports;
    if (typeFilter !== 'all') reports = reports.filter(r => r.type === typeFilter);
    if (statusFilter !== 'all') reports = reports.filter(r => r.status === statusFilter);
    if (searchVal) reports = reports.filter(r =>
        r.item_name.toLowerCase().includes(searchVal) ||
        r.user_name.toLowerCase().includes(searchVal) ||
        r.location.toLowerCase().includes(searchVal) ||
        (r.description || '').toLowerCase().includes(searchVal)
    );

    const countEl = document.getElementById('adminItemCount');
    if (countEl) countEl.textContent = `${reports.length} item${reports.length !== 1 ? 's' : ''}`;

    const listEl = document.getElementById('adminItemsList');
    if (!listEl) {
        container.innerHTML = `
            ${adminTabBar('all-items')}
            <h2>All Items</h2>
            <p class="section-subtitle">Manage all reported items in the system</p>
            <div class="admin-filter-bar">
                <select id="adminItemType" onchange="renderAllItems()">
                    <option value="all">All Types</option>
                    <option value="lost">Lost</option>
                    <option value="found">Found</option>
                </select>
                <select id="adminItemStatus" onchange="renderAllItems()">
                    <option value="all">All Status</option>
                    <option value="pending">Pending</option>
                    <option value="claimed">Awaiting Handover</option>
                    <option value="resolved">Resolved</option>
                </select>
                <input type="text" id="adminItemSearch" placeholder="Search by name, owner, location..." oninput="renderAllItems()" />
                <span class="admin-filter-results" id="adminItemCount">${reports.length} items</span>
            </div>
            <div id="adminItemsList"></div>`;
        renderAllItemsList(reports);
        return;
    }
    renderAllItemsList(reports);
}

function renderAllItemsList(reports) {
    const listEl = document.getElementById('adminItemsList');
    if (!listEl) return;
    if (reports.length === 0) {
        listEl.innerHTML = '<div class="empty-state"><p>No items match this filter.</p></div>';
        return;
    }
    listEl.innerHTML = `<div class="cards admin-items-grid">${reports.map(r => {
        const imgHtml = r.image_url
            ? `<img class="admin-item-img" src="${esc(r.image_url)}" alt="${esc(r.item_name)}">`
            : `<div class="admin-item-img placeholder">${r.type === 'lost' ? '🔍' : '📦'}</div>`;
        const dateStr = r.date_reported
            ? new Date(r.date_reported).toLocaleDateString()
            : new Date(r.created_at).toLocaleDateString();
        const statusMeta = reportStatusMeta(r.status);
        return `
            <div class="card">
                <div class="card-badges">
                    <span class="status-badge ${r.type}">${r.type === 'lost' ? 'Lost' : 'Found'}</span>
                    <span class="status-badge ${statusMeta.cls}">${statusMeta.label}</span>
                    ${r.category ? `<span class="category-badge">${esc(r.category)}</span>` : ''}
                </div>
                ${imgHtml}
                <h4>${esc(r.item_name)}</h4>
                <p><strong>Reporter:</strong> ${esc(r.user_name)}</p>
                <p><strong>Location:</strong> ${esc(r.location)}</p>
                <p><strong>Date:</strong> ${esc(dateStr)} &bull; <span style="color:#9ca3af;">${timeAgo(r.created_at)}</span></p>
                ${r.contact_number ? `<p><strong>Contact:</strong> ${esc(r.contact_number)}</p>` : ''}
                <p style="margin-top:8px;color:#374151;">${esc(r.description)}</p>
                ${r.status === 'resolved' && r.resolved_at ? `<p style="color:#22c55e;font-size:0.82rem;margin-top:4px;">Resolved ${timeAgo(r.resolved_at)}</p>` : ''}
                ${r.status === 'claimed' ? `<p style="color:#92400e;font-size:0.82rem;margin-top:4px;">Claim tagged — waiting for physical handover confirmation</p>` : ''}
                <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">
                    <button onclick="openChat(${r.id},'${r.user_id}','${escapeQuotes(r.user_name)}','${escapeQuotes(r.item_name)}')" class="btn-secondary" style="flex:1;min-width:90px;">Message Owner</button>
                    ${r.status === 'pending' ? `<button onclick="markResolved(${r.id},'${r.user_id}')" class="btn-primary" style="flex:1;min-width:90px;">Resolve</button>` : ''}
                    <button onclick="deleteReportAdmin(${r.id})" class="btn-danger" style="flex:1;min-width:90px;">Delete</button>
                </div>
            </div>`;
    }).join('')}</div>`;
}

let _adminClaimsFilter = 'all';
let _adminAllClaims = [];

async function loadClaimsPanel(filter) {
    const freshRole = await getMyRole();
    if (freshRole !== 'admin') { currentUser.role = freshRole; page('dashboard'); return; }
    currentUser.role = freshRole;
    if (filter !== undefined) _adminClaimsFilter = filter;
    showLoading('claims-panel', 'Loading claims...');
    try {
        _adminAllClaims = await fetchClaims();
        renderClaimsPanel();
    } catch (err) {
        console.error('Load claims panel failed:', err);
        document.getElementById('claims-panel').innerHTML = '<p style="color:red;padding:20px;">Failed to load claims: ' + esc(err.message) + '</p>';
    }
}

function filterAdminClaims(f) {
    _adminClaimsFilter = f;
    renderClaimsPanel();
}

function renderClaimsPanel() {
    const container = document.getElementById('claims-panel');
    const all = _adminAllClaims;

    const counts = {
        all: all.length,
        'pending-review': all.filter(c => c.status === 'pending-review').length,
        handover: all.filter(c => isClaimAwaitingHandover(c.status)).length,
        completed: all.filter(c => c.status === 'completed').length,
        denied: all.filter(c => c.status === 'denied').length,
    };

    const filtered = (_adminClaimsFilter === 'all'
        ? [...all]
        : _adminClaimsFilter === 'handover'
        ? all.filter(c => isClaimAwaitingHandover(c.status))
        : all.filter(c => c.status === _adminClaimsFilter))
        // Aging queue: pending reviews float to the top, oldest first (most urgent).
        .sort((a, b) => {
            const aP = a.status === 'pending-review' ? 0 : 1;
            const bP = b.status === 'pending-review' ? 0 : 1;
            if (aP !== bP) return aP - bP;
            if (aP === 0) return new Date(a.created_at) - new Date(b.created_at);
            return new Date(b.created_at) - new Date(a.created_at);
        });

    const tabs = [
        { key: 'all',            label: 'All' },
        { key: 'pending-review', label: 'Needs review' },
        { key: 'handover',       label: 'Awaiting handover' },
        { key: 'completed',      label: 'Completed' },
        { key: 'denied',         label: 'Denied' },
    ];

    const tabsHtml = `
        <div class="admin-filter-tabs">
            ${tabs.map(t => `
                <button class="admin-tab-btn ${_adminClaimsFilter === t.key ? 'active' : ''}"
                        onclick="filterAdminClaims('${t.key}')">
                    ${t.label}
                    <span class="tab-count">${counts[t.key] ?? 0}</span>
                </button>`).join('')}
        </div>`;

    container.innerHTML = `
        ${adminTabBar('claims-panel', { pendingClaims: counts['pending-review'], awaitingHandover: counts.handover })}
        <h2>Claims Review</h2>
        <p class="section-subtitle">Review and manage ownership verification claims</p>
        ${tabsHtml}
        ${filtered.length === 0
            ? '<div class="empty-state"><p>No claims in this category.</p></div>'
            : `<div class="claims-list">${filtered.map(c => renderClaimCard(c)).join('')}</div>`}`;
}

// Returns { score: 0-100, tier: 'strong'|'partial'|'weak', label, sublabel }
function computeConfidence(c) {
    let score;
    if (c.exact_match && !c.vague)      score = 100;
    else if (c.exact_match && c.vague)  score = 70;
    else if (!c.exact_match && !c.vague) score = 35;
    else                                 score = 15;

    const tier     = score >= 80 ? 'strong' : score >= 40 ? 'partial' : 'weak';
    const label    = score >= 80 ? 'Strong match' : score >= 40 ? 'Partial match' : 'Weak match';
    const sublabel = score === 100
        ? 'All 3 verification answers matched and were specific — high confidence this is the true owner.'
        : score === 70
        ? 'Answers matched but were flagged as vague — admin should inspect the description carefully.'
        : score === 35
        ? 'Answers did not match the hashes — description comparison is critical before tagging.'
        : 'Answers did not match and were vague — proceed only with strong external evidence.';
    return { score, tier, label, sublabel };
}

function renderConfidenceMeter(c) {
    const { score, tier, label, sublabel } = computeConfidence(c);
    return `
        <div class="confidence-meter-wrap">
            <div class="confidence-meter-header">
                <span class="confidence-meter-label">Confidence Score</span>
                <span class="confidence-meter-pct ${tier}">${score}% — ${label}</span>
            </div>
            <div class="confidence-meter-track">
                <div class="confidence-meter-fill ${tier}" style="width:${score}%;"></div>
            </div>
            <p class="confidence-sublabel">${sublabel}</p>
        </div>`;
}

function renderClaimCard(c) {
    const claimantInitials = (c.claimant_name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const finderInitials   = (c.report?.user_name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const submittedDate = new Date(c.created_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const daysOld = Math.floor((Date.now() - new Date(c.created_at)) / 86400000);
    const isUrgent = c.status === 'pending-review' && daysOld >= 2;

    const s = claimStatusMeta(c.status);

    const meterBlock = c.status === 'pending-review' ? renderConfidenceMeter(c) : '';

    // ── Side-by-side comparison panel ──────────────────────────────────────
    const r = c.report;
    const comparisonBlock = r ? `
        <div class="claim-comparison">
            <div class="claim-side">
                <div class="claim-side-label found-side">Found Item (reported by finder)</div>
                ${r.image_url ? `<img src="${esc(r.image_url)}" class="claim-side-img" alt="${esc(c.item_name)}">` : ''}
                <p><strong>Description</strong>${esc(r.description)}</p>
                <p><strong>Location Found</strong>${esc(r.location)}</p>
                ${r.category ? `<p><strong>Category</strong>${esc(r.category)}</p>` : ''}
                ${r.date_reported ? `<p><strong>Date Found</strong>${new Date(r.date_reported).toLocaleDateString()}</p>` : ''}
            </div>
            <div class="claim-side">
                <div class="claim-side-label claim-side-l">Claimant Info</div>
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                    <div class="claim-avatar">${esc(claimantInitials)}</div>
                    <div>
                        <strong style="font-size:0.9rem;color:#1a1a2e;">${esc(c.claimant_name)}</strong><br>
                        <span style="font-size:0.78rem;color:#9ca3af;">Submitted ${timeAgo(c.created_at)}</span>
                    </div>
                </div>
                <p><strong>Verification</strong>
                    ${c.exact_match
                        ? '<span style="color:#15803d;font-weight:700;">All 3 answers matched</span>'
                        : '<span style="color:#dc2626;font-weight:700;">Answers did not match</span>'}
                </p>
                ${c.vague ? '<p style="color:#92400e;font-size:0.82rem;font-weight:600;">Flagged: answers were vague</p>' : ''}
                <p style="font-size:0.76rem;color:#9ca3af;margin-top:6px;">Answer contents hidden (Blind Verification Protocol)</p>
            </div>
        </div>` : '';

    // ── Finder contact block ────────────────────────────────────────────────
    const finderBlock = r ? `
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;margin-bottom:14px;">
            <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#15803d;margin-bottom:8px;">Finder (item holder)</div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <div class="claim-avatar" style="background:#dcfce7;color:#15803d;">${esc(finderInitials)}</div>
                <div>
                    <strong style="font-size:0.9rem;color:#1a1a2e;">${esc(r.user_name)}</strong>
                    ${r.contact_number ? `<div style="font-size:0.82rem;color:#6b7280;">${esc(r.contact_number)}</div>` : ''}
                </div>
                <button onclick="openChat(${c.report_id},'${r.user_id}','${escapeQuotes(r.user_name)}','${escapeQuotes(c.item_name)}')"
                        class="btn-secondary" style="margin-left:auto;padding:5px 12px;font-size:0.82rem;">Message Finder</button>
            </div>
        </div>` : '';

    // ── Status banners ──────────────────────────────────────────────────────
    const awaitingBanner = isClaimAwaitingHandover(c.status) ? `
        <div class="claim-awaiting-banner">
            <span>⏳</span>
            <span>Parties connected — waiting for physical handover. Click <strong>Confirm Handover</strong> once the item is returned.</span>
        </div>` : '';

    const successBanner = c.status === 'completed' ? `
        <div class="claim-success-banner">
            <span>✅</span>
            <span>Handover confirmed. <strong>${esc(c.claimant_name)}</strong> received the item from <strong>${esc(r?.user_name || 'finder')}</strong>. Report marked resolved.</span>
        </div>` : '';

    // ── Retrieval code ──────────────────────────────────────────────────────
    const codeBlock = c.retrieval_code ? (() => {
        const expired = c.expires_at && new Date(c.expires_at) < new Date();
        const expiryStr = c.expires_at
            ? new Date(c.expires_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
            : '';
        return `
            <div class="claim-code-block">
                <span style="font-size:0.8rem;color:#7f8c8d;font-weight:600;">Retrieval Code:</span>
                <code>${esc(c.retrieval_code)}</code>
                ${expiryStr ? `<span class="claim-expiry ${expired ? 'expired' : ''}">${expired ? 'Expired' : 'Expires'} ${expiryStr}</span>` : ''}
            </div>`;
    })() : '';

    // ── Action rows (differ per status) ────────────────────────────────────
    const finderUserId = r?.user_id  || '';
    const finderName   = r?.user_name || '';

    let actionsHtml = '';
    if (c.status === 'pending-review') {
        actionsHtml = `
        <div class="claim-actions-row" id="claim-actions-${c.id}">
            <button onclick="adminTagMatch(${c.id},'${finderUserId}','${escapeQuotes(finderName)}')"
                    class="btn-primary" style="flex:1;">Tag as Match</button>
            <button onclick="adminDenyStart(${c.id})" class="btn-danger" style="flex:1;">Deny</button>
            <button onclick="openChat(${c.report_id},'${c.claimant_id}','${escapeQuotes(c.claimant_name)}','${escapeQuotes(c.item_name)}')"
                    class="btn-secondary" style="flex:1;">Message Claimant</button>
        </div>
        <div class="deny-inline-form" id="deny-form-${c.id}">
            <p>Deny this claim — send optional reason to claimant:</p>
            <textarea id="deny-reason-${c.id}" placeholder="Reason (optional — will be sent as a message to the claimant)..."></textarea>
            <div class="deny-inline-form-btns">
                <button onclick="adminDenyConfirm(${c.id}, ${c.report_id}, '${c.claimant_id}', '${escapeQuotes(c.claimant_name)}')"
                        class="btn-danger">Confirm Denial</button>
                <button onclick="adminDenyCancel(${c.id})" class="btn-secondary">Cancel</button>
            </div>
        </div>`;
    } else if (isClaimAwaitingHandover(c.status)) {
        actionsHtml = `
        <div class="claim-actions-row">
            <button onclick="adminConfirmHandover(${c.id}, ${c.report_id}, '${c.finder_id}')"
                    class="btn-primary" style="flex:2;">Confirm Handover — Mark Success</button>
            <button onclick="openChat(${c.report_id},'${c.claimant_id}','${escapeQuotes(c.claimant_name)}','${escapeQuotes(c.item_name)}')"
                    class="btn-secondary" style="flex:1;">Claimant</button>
            ${finderUserId ? `<button onclick="openChat(${c.report_id},'${finderUserId}','${escapeQuotes(finderName)}','${escapeQuotes(c.item_name)}')"
                    class="btn-secondary" style="flex:1;">Finder</button>` : ''}
        </div>`;
    } else {
        actionsHtml = `
        <div class="claim-actions-row">
            <button onclick="openChat(${c.report_id},'${c.claimant_id}','${escapeQuotes(c.claimant_name)}','${escapeQuotes(c.item_name)}')"
                    class="btn-secondary">Message Claimant</button>
            ${finderUserId ? `<button onclick="openChat(${c.report_id},'${finderUserId}','${escapeQuotes(finderName)}','${escapeQuotes(c.item_name)}')"
                    class="btn-secondary">Message Finder</button>` : ''}
        </div>`;
    }

    return `
        <div class="claim-card-v2 status-${c.status}">
            <div class="claim-card-body">
                <div class="claim-card-top">
                    <h4 class="claim-item-name">${esc(c.item_name)}</h4>
                    <span class="status-badge ${s.cls}">${s.label}</span>
                </div>
                <div class="claim-date-row">
                    <span>Submitted ${submittedDate}</span>
                    <span class="time-ago-badge ${isUrgent ? 'urgent' : ''}">${timeAgo(c.created_at)}${isUrgent ? ' — overdue' : ''}</span>
                </div>
                ${awaitingBanner}
                ${successBanner}
                ${meterBlock}
                ${comparisonBlock}
                ${finderBlock}
                ${codeBlock}
                ${actionsHtml}
            </div>
        </div>`;
}

// Step 1 of 2: Admin tags a claim as a match.
// Sets claim → approved, report → claimed, issues retrieval code, connects parties via messages.
// Does NOT resolve the report or award points yet — that happens on Confirm Handover.
async function adminTagMatch(claimId, finderUserId = '', finderName = '') {
    const pickup = (prompt(
        'Tag this claim as a match.\n\n' +
        'Optionally enter a PICKUP LOCATION the claimant will see (e.g. "SAO Office, Admin Bldg"). ' +
        'Leave blank to skip.\n\n' +
        'This issues a retrieval code, notifies both parties, and marks the report "Awaiting Handover". ' +
        'The report is only resolved after handover is confirmed.',
        ''
    ));
    if (pickup === null) return; // cancelled
    const btn = document.querySelector(`#claim-actions-${claimId} .btn-primary`);
    if (btn) { btn.disabled = true; btn.textContent = 'Tagging...'; }
    try {
        const code = generateRetrievalCode();
        const claim = await updateClaim(claimId, {
            status: 'approved',
            retrieval_code: code,
            expires_at: new Date(Date.now() + 48 * 3600000).toISOString(),
            pickup_location: pickup.trim()
        });

        // Mark report "claimed" — not resolved yet
        await updateReport(claim.report_id, { status: 'claimed' });

        const effectiveFinderUserId = finderUserId || claim.finder_id;

        // In-app notifications (durable, unlike chat messages)
        createNotification({
            user_id: claim.claimant_id, type: 'claim-verified',
            title: 'Claim approved — ready for pickup',
            body: `Your claim for "${claim.item_name}" was approved. Code: ${code}.` +
                  (pickup.trim() ? ` Pickup at: ${pickup.trim()}.` : ''),
            link: 'my-claims'
        });
        if (effectiveFinderUserId) {
            createNotification({
                user_id: effectiveFinderUserId, type: 'claim-verified',
                title: 'A claim on your item was approved',
                body: `Hand "${claim.item_name}" to ${claim.claimant_name} after they show code ${code}, then confirm the handover.`,
                link: 'reports'
            });
        }

        toast(`Tagged as match. Code ${code} issued — parties notified.`, 'success');
        loadClaimsPanel();
    } catch (err) {
        alert('Failed to tag claim: ' + err.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Tag as Match'; }
    }
}

// Step 2 of 2: Admin confirms the physical item was handed over.
// Sets claim → completed, report → resolved, awards points to finder.
async function adminConfirmHandover(claimId, reportId, finderId) {
    if (!confirm(
        'Confirm that the physical handover has taken place?\n\n' +
        'This will:\n' +
        '• Mark the claim as Completed\n' +
        '• Mark the report as Resolved\n' +
        '• Award points to the finder\n\n' +
        'This action cannot be undone.'
    )) return;

    // Find the button to give feedback
    const btns = document.querySelectorAll(`[onclick*="adminConfirmHandover(${claimId}"]`);
    btns.forEach(b => { b.disabled = true; b.textContent = 'Confirming...'; });

    try {
        // Secure RPC: marks claim completed, report resolved, awards finder points,
        // and notifies both parties (idempotent — rejects double confirmation).
        await confirmHandoverRpc(claimId);
        toast('Handover confirmed — report resolved and finder awarded points.', 'success');
        loadClaimsPanel();
    } catch (err) {
        toast('Failed to confirm handover: ' + err.message, 'error');
        btns.forEach(b => { b.disabled = false; b.textContent = 'Confirm Handover — Mark Success'; });
    }
}

function adminDenyStart(claimId) {
    const actionsEl = document.getElementById(`claim-actions-${claimId}`);
    const formEl = document.getElementById(`deny-form-${claimId}`);
    if (actionsEl) actionsEl.style.display = 'none';
    if (formEl) { formEl.style.display = 'block'; formEl.querySelector('textarea')?.focus(); }
}

function adminDenyCancel(claimId) {
    const actionsEl = document.getElementById(`claim-actions-${claimId}`);
    const formEl = document.getElementById(`deny-form-${claimId}`);
    if (actionsEl) actionsEl.style.display = '';
    if (formEl) formEl.style.display = 'none';
}

async function adminDenyConfirm(claimId, reportId, claimantId, claimantName) {
    const reason = (document.getElementById(`deny-reason-${claimId}`)?.value || '').trim();
    const confirmBtn = document.querySelector(`#deny-form-${claimId} .btn-danger`);
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Denying...'; }
    try {
        await updateClaim(claimId, { status: 'denied' });
        const claim = _adminAllClaims.find(c => c.id === claimId);
        createNotification({
            user_id: claimantId, type: 'info',
            title: 'Claim denied',
            body: `Your claim${claim ? ` for "${claim.item_name}"` : ''} was denied.${reason ? ' Reason: ' + reason : ''}`,
            link: 'my-claims'
        });
        toast('Claim denied.', 'success');
        loadClaimsPanel();
    } catch (err) {
        toast('Failed to deny claim: ' + err.message, 'error');
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm Denial'; }
    }
}

async function markResolved(reportId, userId) {
    if (!confirm('Mark this report as resolved?\n\nThe reporter/finder will receive +20 points. Use this only for cases handled outside the claim flow.')) return;
    try {
        await updateReport(reportId, {
            status: 'resolved',
            resolved_at: new Date().toISOString()
        });
        await addPoints(userId, POINTS.resolved);
        toast('Report resolved — +20 points awarded.', 'success');
        loadAllItems();
    } catch (err) {
        toast('Failed to resolve: ' + err.message, 'error');
    }
}

async function deleteReportAdmin(reportId) {
    const r = _adminAllReports.find(x => x.id === reportId);
    const name = r ? `"${r.item_name}"` : 'this report';
    if (!confirm(`Delete ${name}?\n\nThis permanently removes the report. This cannot be undone.`)) return;
    try {
        await deleteReport(reportId);
        toast('Report deleted.', 'success');
        loadAllItems();
    } catch (err) {
        toast('Failed to delete: ' + err.message, 'error');
    }
}

let _adminUsers = [];
let _adminUsersSearch = '';
let _adminUsersRole = 'all';

function filterAdminUsersRole(role) {
    _adminUsersRole = role;
    renderAdminUsers();
}

async function loadAdminUsers() {
    const freshRole = await getMyRole();
    if (freshRole !== 'admin') { currentUser.role = freshRole; page('dashboard'); return; }
    currentUser.role = freshRole;
    showLoading('admin-users', 'Loading users...');
    try {
        const [allProfiles, reports] = await Promise.all([fetchAllProfiles(), fetchReports()]);
        _adminUsers = allProfiles;
        // Attach report counts
        const reportCountById = {};
        reports.forEach(r => { reportCountById[r.user_id] = (reportCountById[r.user_id] || 0) + 1; });
        _adminUsers = allProfiles.map(u => ({ ...u, reportCount: reportCountById[u.id] || 0 }));
        renderAdminUsers();
    } catch (err) {
        document.getElementById('admin-users').innerHTML = '<p style="color:red;padding:20px;">Failed to load users: ' + esc(err.message) + '</p>';
    }
}

function renderAdminUsers() {
    const container = document.getElementById('admin-users');
    const q = _adminUsersSearch.toLowerCase();
    let list = _adminUsers;
    if (_adminUsersRole !== 'all') list = list.filter(u => u.role === _adminUsersRole);
    if (q) list = list.filter(u =>
        u.name.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q)
    );

    const totalAdmins = _adminUsers.filter(u => u.role === 'admin').length;
    const totalStudents = _adminUsers.length - totalAdmins;
    const roleChips = [
        { key: 'all',   label: `All (${_adminUsers.length})` },
        { key: 'user',  label: `Students (${totalStudents})` },
        { key: 'admin', label: `Admins (${totalAdmins})` },
    ];
    const rows = list.map(u => `
        <tr>
            <td>
                <strong style="color:#1a1a2e;">${esc(u.name)}</strong><br>
                <span style="color:#9ca3af;font-size:0.8rem;">@${esc(u.username)}</span>
            </td>
            <td style="color:#6b7280;font-size:0.85rem;">${esc(u.email || '—')}</td>
            <td><span class="role-badge ${u.role}">${u.role === 'admin' ? '👑 Admin' : u.role_label || 'Student'}</span></td>
            <td style="font-weight:700;color:#2563eb;">${u.points}</td>
            <td>${u.reportCount}</td>
            <td style="color:#9ca3af;font-size:0.8rem;">${u.contact_number || '—'}</td>
            <td style="color:#9ca3af;font-size:0.8rem;">${u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
        </tr>`).join('');

    container.innerHTML = `
        ${adminTabBar('admin-users')}
        <h2>Users</h2>
        <p class="section-subtitle">${_adminUsers.length} registered account${_adminUsers.length !== 1 ? 's' : ''} &bull; ${totalAdmins} admin${totalAdmins !== 1 ? 's' : ''}</p>
        <div class="admin-role-chips">
            ${roleChips.map(ch => `
                <button class="admin-chip ${_adminUsersRole === ch.key ? 'active' : ''}"
                        onclick="filterAdminUsersRole('${ch.key}')">${ch.label}</button>`).join('')}
        </div>
        <div class="admin-users-search">
            <input type="text" placeholder="Search by name, username, or email..."
                   value="${esc(_adminUsersSearch)}"
                   oninput="_adminUsersSearch=this.value; renderAdminUsers();" />
            <span style="padding:8px 14px;color:#6b7280;font-size:0.88rem;white-space:nowrap;">${list.length} shown</span>
        </div>
        <div class="leaderboard-container">
            <table class="admin-users-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Points</th>
                        <th>Reports</th>
                        <th>Contact</th>
                        <th>Joined</th>
                    </tr>
                </thead>
                <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#9ca3af;padding:20px;">No users found.</td></tr>'}</tbody>
            </table>
        </div>
        <p style="font-size:0.8rem;color:#9ca3af;margin-top:12px;">To change a user's role, edit the <code>profiles.role</code> column directly in your Supabase Table Editor.</p>`;
}

function openReportModalFromNav() { openReportModal(); }

window.onclick = function(event) {
    ['reportModal','claimModal','sightingModal','recoveryModal'].forEach(id => {
        const m = document.getElementById(id);
        if (m && event.target === m) m.style.display = 'none';
    });
    const mm = document.getElementById('messageModal');
    if (mm && event.target === mm) closeMessageModal();
};

function escapeQuotes(str) {
    return (str || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

// Expose functions for inline onclick handlers
const globalFns = {
    showLanding, showLogin, showRegister, show, register, login, logout, page,
    togglePassword, toggleVerificationQuestions, openReportModal, closeReportModal,
    handleImageUpload, submitReport, filterLostItems, filterFoundItems,
    openClaimModal, closeClaimModal, submitClaim, showReportTab,
    openSightingModal, closeSightingModal, handleSightingImageUpload,
    updateSightingMatchPreview, submitSighting,
    confirmSightingHelpful, confirmSightingRecovery, dismissSighting,
    openRecoveryModal, closeRecoveryModal, submitLostRecovery,
    saveSettings, loadClaimsPanel, adminTagMatch, adminConfirmHandover,
    adminDenyStart, adminDenyCancel, adminDenyConfirm,
    filterAdminClaims, renderAllItems,
    loadAdminUsers, renderAdminUsers, filterAdminUsersRole,
    markResolved, deleteReportAdmin, openChat, closeMessageModal,
    sendNewMessage, openConversation, sendMessage, closeChatWindow,
    openReportModalFromNav,
    downloadDashboardInsights,
    openNotifications, loadNotifications, markAllRead,
    loadMyClaims, confirmHandover, copyText
};
Object.assign(window, globalFns);

document.addEventListener('DOMContentLoaded', async () => {
    populateCategorySelect('lostCategoryFilter', true);
    populateCategorySelect('foundCategoryFilter', true);
    populateCategorySelect('reportCategory', false);
    renderPointsInfoGrid();

    document.getElementById('conversationsList')?.addEventListener('click', (e) => {
        const item = e.target.closest('.conversation-item[data-report-id]');
        if (!item) return;
        openConversation(item.dataset.reportId, item.dataset.otherId);
    });

    try {
        const session = await getSession();
        if (session) {
            currentUser = await waitForProfile(session.user.id);
            enterApp();
        }
    } catch (err) {
        console.warn('Session restore failed:', err.message);
        await signOut();
    }
    console.log('🚀 LostFinder ready — fully connected to Supabase');
});
