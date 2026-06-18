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
import { createClaim, fetchClaims, updateClaim, submitClaimRpc } from './js/services/claims.js';
import { uploadReportImage, uploadSightingImage } from './js/services/storage.js';
import {
    fetchUserMessages, fetchConversationMessages, sendMessage as sendMessageToDb,
    markMessagesAsRead, fetchMessageCount, subscribeToMessages
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
    openChat, openMessageModal, closeMessageModal, sendNewMessage,
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
        await signOut();
        currentUser = null;
        showLanding();
    }
}

function updateSidebar() {
    if (!currentUser) return;

    const sidebar = document.getElementById('sidebar');
    const initials = getUserInitials(currentUser.name);
    const adminLinks = currentUser.role === 'admin' ? `
        <a onclick="page('admin-panel')" data-admin-link><span class="nav-icon">👑</span> Admin</a>
    ` : '';

    sidebar.innerHTML = `
        <div class="sidebar-header">
            <div class="sidebar-logo"></div>
            <h2>LostFinder</h2>
        </div>
        <div class="user-profile">
            <div class="sidebar-avatar-initials">${esc(initials)}</div>
            <div class="user-info">
                <p class="user-name">${esc(currentUser.name)}${currentUser.role === 'admin' ? ' 👑' : ''}</p>
                <p class="user-points">⭐ <span id="currentUserPoints">${currentUser.points}</span> pts</p>
            </div>
        </div>
        <nav class="sidebar-nav">
            <a onclick="page('dashboard')" class="active"><span class="nav-icon"></span> Dashboard</a>
            <a onclick="page('lost')"><span class="nav-icon"></span> Lost Items</a>
            <a onclick="page('found')"><span class="nav-icon"></span> Found Items</a>
            <a onclick="page('reports')"><span class="nav-icon"></span> My Reports</a>
            <a onclick="page('messages')"><span class="nav-icon"></span> Messages</a>
            <a onclick="page('leaderboard')"><span class="nav-icon"></span> Leaderboard</a>
            ${adminLinks}
            <a onclick="page('settings')"><span class="nav-icon"></span> Settings</a>
            <a onclick="logout()" class="logout-btn"><span class="nav-icon"></span> Logout</a>
        </nav>
    `;
}

const ADMIN_PAGES = ['admin-panel', 'all-items', 'claims-panel', 'admin-users'];

function page(id) {
    if (ADMIN_PAGES.includes(id) && currentUser?.role !== 'admin') {
        id = 'dashboard';
    }

    document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));
    document.querySelectorAll('main section').forEach(s => s.classList.add('hidden'));

    if (ADMIN_PAGES.includes(id) && !document.getElementById(id)) {
        const sec = document.createElement('section');
        sec.id = id;
        sec.className = 'hidden';
        document.querySelector('.main').appendChild(sec);
    }

    const section = document.getElementById(id);
    if (section) section.classList.remove('hidden');

    if (ADMIN_PAGES.includes(id)) {
        // Highlight the single "Admin" sidebar link for every admin sub-page
        document.querySelector('[data-admin-link]')?.classList.add('active');
    } else {
        document.querySelectorAll('.sidebar-nav a').forEach(link => {
            if (link.textContent.toLowerCase().includes(id.replace(/-/g, ' '))) {
                link.classList.add('active');
            }
        });
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
            const all = await fetchReports();
            const lostPending = all.filter(r => r.type === 'lost' && r.status === 'pending').length;
            const foundPending = all.filter(r => r.type === 'found' && r.status === 'pending').length;
            const resolved = all.filter(r => r.status === 'resolved').length;

            document.getElementById('myLostCount').textContent = lostPending;
            document.getElementById('myFoundCount').textContent = foundPending;
            document.getElementById('myResolvedCount').textContent = resolved;
            document.getElementById('dashLostLabel').textContent = 'Total Lost';
            document.getElementById('dashFoundLabel').textContent = 'Total Found';
            document.getElementById('dashResolvedLabel').textContent = 'Total Resolved';
            document.getElementById('dashboardMatches').innerHTML = '';

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
                    lost_label: 'Total Lost (pending)',
                    lost_count: lostPending,
                    found_label: 'Total Found (pending)',
                    found_count: foundPending,
                    resolved_label: 'Total Resolved',
                    resolved_count: resolved,
                    points: currentUser.points
                },
                smart_matches: [],
                sightings_received: [],
                sightings_submitted: [],
                my_reports: [],
                platform_reports: all.map(r => ({
                    id: r.id,
                    type: r.type,
                    item_name: r.item_name,
                    category: r.category,
                    location: r.location,
                    description: r.description,
                    status: r.status,
                    user_name: r.user_name,
                    created_at: r.created_at,
                    resolved_at: r.resolved_at || null
                }))
            };
        } else {
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
        }
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
            alert(`✅ Verification Successful! Ownership Confirmed!\n\n🎟️ Your One-Time Retrieval Code:\n\n    ${result.retrieval_code}\n\nPresent this code to claim your item. Code is valid for 48 hours.`);
            loadFoundItems();
            loadDashboard();
        } else if (result.vague) {
            alert('⚠️ Your answers seem too brief. Your claim has been flagged for Admin Review.');
        } else {
            alert('⚠️ Answers did not match exactly. Your claim has been sent for Admin Review.');
        }
    } catch (err) {
        console.error('submitClaim failed:', err);
        alert('❌ Failed to submit claim: ' + err.message);
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
    } catch (err) {
        console.error('Load my reports failed:', err);
        showEmpty('myLostReports', 'Could not load reports.');
        showEmpty('myFoundReports', 'Could not load reports.');
    }
}

function renderSightingsBlock(sightings, reportStatus) {
    const reportPending = reportStatus === 'pending';
    return `
        <div class="sightings-block">
            <h5>👁️ ${sightings.length} sighting tip${sightings.length === 1 ? '' : 's'}</h5>
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
        </div>`;
}

function renderReportsList(containerId, reports, sightingsByReport = {}) {
    const container = document.getElementById(containerId);
    if (reports.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No items reported yet.</p></div>';
        return;
    }
    container.innerHTML = reports.map(r => {
        const imgHtml = r.image_url
            ? `<img src="${esc(r.image_url)}" alt="${esc(r.item_name)}" style="max-width:100%;border-radius:8px;margin-bottom:12px;">` : '';
        return `
            <div class="card">
                <div class="card-badges">
                    <span class="status-badge ${r.status}">${r.status === 'resolved' ? '✅ Resolved' : '⏳ Pending'}</span>
                    ${r.category ? `<span class="category-badge">${esc(r.category)}</span>` : ''}
                </div>
                ${imgHtml}
                <h4>${esc(r.item_name)}</h4>
                <p><strong>📍</strong> ${esc(r.location)}</p>
                <p><strong>📅</strong> ${r.date_reported || new Date(r.created_at).toLocaleDateString()}</p>
                <p style="margin-top:8px;">${esc(r.description)}</p>
                ${r.type === 'found' && r.verify_hashes ? '<p style="color:#27ae60;font-size:0.85rem;margin-top:4px;">🔒 Verification questions set</p>' : ''}
                ${r.type === 'lost' && r.status === 'pending' ? `
                    <button onclick="openRecoveryModal(${r.id})" class="btn-primary" style="margin-top:12px;padding:8px 16px;">
                        ✅ Mark Item Recovered
                    </button>` : ''}
                ${r.type === 'lost' && sightingsByReport[r.id]?.length ? renderSightingsBlock(sightingsByReport[r.id], r.status) : ''}
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
        const [allProfiles, reports, messages, claims] = await Promise.all([
            fetchAllProfiles(), fetchReports(), fetchMessageCount(), fetchClaims()
        ]);
        const users = allProfiles.filter(u => u.role === 'user');

        const stats = {
            users: users.length,
            admins: allProfiles.filter(u => u.role === 'admin').length,
            reports: reports.length,
            lost: reports.filter(r => r.type === 'lost' && r.status === 'pending').length,
            found: reports.filter(r => r.type === 'found' && r.status === 'pending').length,
            claimed: reports.filter(r => r.status === 'claimed').length,
            resolved: reports.filter(r => r.status === 'resolved').length,
            messages,
            pendingClaims:    claims.filter(c => c.status === 'pending-review').length,
            awaitingHandover: claims.filter(c => c.status === 'approved').length,
            completedClaims:  claims.filter(c => c.status === 'completed').length,
            totalPoints: users.reduce((s, u) => s + u.points, 0)
        };
        const topUsers = [...users].sort((a, b) => b.points - a.points).slice(0, 5);
        const recentReports = [...reports].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6);
        const recentClaims  = [...claims].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);

        const claimStatusLabel = s => ({
            'pending-review': 'Pending',
            'auto-approved':  'Auto-OK',
            'approved':       'Awaiting Handover',
            'completed':      'Completed',
            'denied':         'Denied',
        }[s] || s);
        const claimStatusCls = s => ({
            'pending-review': 'found',
            'auto-approved':  'resolved',
            'approved':       'claimed',
            'completed':      'resolved',
            'denied':         'lost',
        }[s] || 'found');
        const reportStatusLabel = s => ({
            'pending':  'Pending',
            'claimed':  'Awaiting Handover',
            'resolved': 'Resolved',
        }[s] || s);
        const reportStatusCls = s => s === 'claimed' ? 'claimed' : s;

        const pendingAlert = stats.pendingClaims > 0 ? `
            <div class="admin-alert" onclick="page('claims-panel')" style="cursor:pointer;">
                <span class="alert-icon">🔐</span>
                <div class="alert-body">
                    <strong>${stats.pendingClaims} claim${stats.pendingClaims > 1 ? 's' : ''} need${stats.pendingClaims === 1 ? 's' : ''} your review.</strong>
                    Open Claims Review to tag or deny.
                </div>
                <span class="alert-badge">${stats.pendingClaims} pending</span>
            </div>` : '';

        const handoverAlert = stats.awaitingHandover > 0 ? `
            <div class="admin-alert" onclick="page('claims-panel')" style="cursor:pointer;background:#fffbeb;border-color:#fcd34d;">
                <span class="alert-icon">⏳</span>
                <div class="alert-body">
                    <strong>${stats.awaitingHandover} claim${stats.awaitingHandover > 1 ? 's' : ''} tagged — awaiting physical handover.</strong>
                    Confirm once the item has been returned.
                </div>
                <span class="alert-badge" style="background:#f59e0b;">${stats.awaitingHandover} awaiting</span>
            </div>` : '';

        document.getElementById('admin-panel').innerHTML = `
            ${adminTabBar('admin-panel', { pendingClaims: stats.pendingClaims, awaitingHandover: stats.awaitingHandover })}

            <h2>Admin Dashboard</h2>
            <p class="section-subtitle">Campus-wide overview — ICCT Colleges Cainta</p>

            ${pendingAlert}
            ${handoverAlert}

            <div class="stats-cards">
                ${[
                    ['blue',   '👤', 'Total Users',       stats.users,           'admin-users'],
                    ['green',  '📊', 'Total Reports',      stats.reports,         'all-items'],
                    ['purple', '🔍', 'Active Lost',        stats.lost,            'all-items'],
                    ['blue',   '✅', 'Active Found',       stats.found,           'all-items'],
                    ['blue',   '⏳', 'Awaiting Handover',  stats.claimed,         'all-items'],
                    ['green',  '🎯', 'Resolved',           stats.resolved,        'all-items'],
                    ['purple', '🔐', 'Pending Claims',     stats.pendingClaims,   'claims-panel'],
                    ['green',  '✔️', 'Completed Claims',   stats.completedClaims, 'claims-panel'],
                    ['blue',   '💬', 'Messages',           stats.messages,        'messages'],
                    ['green',  '⭐', 'Total Points',       stats.totalPoints,     'leaderboard'],
                ].map(([color, icon, label, value, nav]) => `
                    <div class="stat-card ${color}" style="cursor:pointer;" onclick="page('${nav}')">
                        <div class="stat-icon">${icon}</div>
                        <div class="stat-info"><h4>${label}</h4><p class="stat-number">${value}</p></div>
                    </div>`).join('')}
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:40px;">
                <div>
                    <div class="activity-section-header">
                        <h3>Recent Reports</h3>
                        <button class="btn-secondary" style="padding:5px 12px;font-size:0.82rem;" onclick="page('all-items')">View all</button>
                    </div>
                    <div class="activity-feed">
                        ${recentReports.length === 0 ? '<p style="color:#9ca3af;font-size:0.9rem;">No reports yet.</p>' :
                        recentReports.map(r => `
                            <div class="activity-item type-${r.type}">
                                <div class="activity-dot type-${r.type}"></div>
                                <div class="activity-body">
                                    <strong>${esc(r.item_name)}</strong>
                                    <div class="activity-meta">${r.type === 'lost' ? 'Lost' : 'Found'} by ${esc(r.user_name)} &bull; ${timeAgo(r.created_at)}</div>
                                </div>
                                <span class="status-badge ${reportStatusCls(r.status)}" style="font-size:0.75rem;">${reportStatusLabel(r.status)}</span>
                            </div>`).join('')}
                    </div>
                </div>
                <div>
                    <div class="activity-section-header">
                        <h3>Recent Claims</h3>
                        <button class="btn-secondary" style="padding:5px 12px;font-size:0.82rem;" onclick="page('claims-panel')">View all</button>
                    </div>
                    <div class="activity-feed">
                        ${recentClaims.length === 0 ? '<p style="color:#9ca3af;font-size:0.9rem;">No claims yet.</p>' :
                        recentClaims.map(c => `
                            <div class="activity-item type-claim">
                                <div class="activity-dot type-claim"></div>
                                <div class="activity-body">
                                    <strong>${esc(c.item_name)}</strong>
                                    <div class="activity-meta">By ${esc(c.claimant_name)} &bull; ${timeAgo(c.created_at)}</div>
                                </div>
                                <span class="status-badge ${claimStatusCls(c.status)}" style="font-size:0.75rem;">${claimStatusLabel(c.status)}</span>
                            </div>`).join('')}
                    </div>
                </div>
            </div>

            <div>
                <h3 style="margin-bottom:16px;">Top Contributors</h3>
                <div class="leaderboard-container">
                    <table class="leaderboard-table">
                        <thead><tr><th>Rank</th><th>Name</th><th>Username</th><th>Points</th><th>Reports</th></tr></thead>
                        <tbody>
                            ${topUsers.map((u, i) => `
                                <tr>
                                    <td>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                                    <td>${esc(u.name)}</td>
                                    <td style="color:#7f8c8d;">${esc(u.username)}</td>
                                    <td style="font-weight:700;color:#2563eb;">${u.points}</td>
                                    <td>${reports.filter(r => r.user_id === u.id).length}</td>
                                </tr>`).join('')}
                        </tbody>
                    </table>
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
    listEl.innerHTML = `<div class="cards">${reports.map(r => {
        const imgHtml = r.image_url
            ? `<img src="${esc(r.image_url)}" alt="${esc(r.item_name)}" style="max-width:100%;border-radius:8px;margin-bottom:12px;">`
            : '';
        const dateStr = r.date_reported
            ? new Date(r.date_reported).toLocaleDateString()
            : new Date(r.created_at).toLocaleDateString();
        return `
            <div class="card">
                <div class="card-badges">
                    <span class="status-badge ${r.type}">${r.type === 'lost' ? 'Lost' : 'Found'}</span>
                    <span class="status-badge ${r.status}">
                        ${r.status === 'claimed' ? 'Awaiting Handover' : r.status}
                    </span>
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
        'auto-approved':  all.filter(c => c.status === 'auto-approved').length,
        approved:         all.filter(c => c.status === 'approved').length,
        completed:        all.filter(c => c.status === 'completed').length,
        denied:           all.filter(c => c.status === 'denied').length,
    };

    const filtered = _adminClaimsFilter === 'all'
        ? all
        : all.filter(c => c.status === _adminClaimsFilter);

    const tabs = [
        { key: 'all',           label: 'All' },
        { key: 'pending-review', label: 'Pending Review' },
        { key: 'auto-approved', label: 'Auto-Approved' },
        { key: 'approved',      label: 'Tagged / Awaiting' },
        { key: 'completed',     label: 'Completed' },
        { key: 'denied',        label: 'Denied' },
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
        ${adminTabBar('claims-panel', { pendingClaims: counts['pending-review'], awaitingHandover: counts['approved'] })}
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

    const statusMap = {
        'pending-review': { label: 'Pending Review',     cls: 'found' },
        'auto-approved':  { label: 'Auto-Approved',      cls: 'resolved' },
        'approved':       { label: 'Tagged — Awaiting Handover', cls: 'found' },
        'completed':      { label: 'Handover Confirmed', cls: 'resolved' },
        'denied':         { label: 'Denied',             cls: 'lost' },
    };
    const s = statusMap[c.status] || { label: c.status, cls: 'found' };

    // ── Confidence meter (only shown before the claim is settled) ───────────
    const meterBlock = (c.status === 'pending-review' || c.status === 'auto-approved')
        ? renderConfidenceMeter(c)
        : '';

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
    const awaitingBanner = c.status === 'approved' ? `
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
    } else if (c.status === 'approved') {
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
    if (!confirm(
        'Tag this claim as a match?\n\n' +
        'This will:\n' +
        '• Issue a retrieval code for the claimant\n' +
        '• Message both the finder and claimant to coordinate pickup\n' +
        '• Mark the report as "Awaiting Handover"\n\n' +
        'The report will only be marked resolved after you confirm the physical handover.'
    )) return;
    const btn = document.querySelector(`#claim-actions-${claimId} .btn-primary`);
    if (btn) { btn.disabled = true; btn.textContent = 'Tagging...'; }
    try {
        const code = generateRetrievalCode();
        const claim = await updateClaim(claimId, {
            status: 'approved',
            retrieval_code: code,
            expires_at: new Date(Date.now() + 48 * 3600000).toISOString()
        });

        // Mark report "claimed" — not resolved yet
        await updateReport(claim.report_id, { status: 'claimed' });

        const effectiveFinderUserId = finderUserId || claim.finder_id;
        const effectiveFinderName   = finderName   || 'the finder';

        // Notify claimant
        try {
            await sendMessageToDb({
                report_id: claim.report_id,
                receiver_id: claim.claimant_id,
                message:
                    `✅ Your claim for "${claim.item_name}" has been tagged as a match by the admin.\n\n` +
                    `Your retrieval code is: ${code}\n` +
                    `(Valid for 48 hours)\n\n` +
                    `The item is currently held by ${effectiveFinderName}. ` +
                    `Please coordinate with them to arrange pickup and show this code when collecting the item.`
            });
        } catch (_) { /* non-blocking */ }

        // Notify finder
        if (effectiveFinderUserId) {
            try {
                await sendMessageToDb({
                    report_id: claim.report_id,
                    receiver_id: effectiveFinderUserId,
                    message:
                        `🔗 The admin has tagged a claim for "${claim.item_name}" as a match.\n\n` +
                        `The claimant is: ${claim.claimant_name}.\n` +
                        `Please wait for them to contact you and verify their retrieval code before releasing the item.\n\n` +
                        `Once the handover is done, notify the admin so the case can be closed.`
                });
            } catch (_) { /* non-blocking */ }
        }

        alert(
            `Tagged as match!\n\n` +
            `Retrieval Code: ${code} (48 hours)\n\n` +
            `${claim.claimant_name} and ${effectiveFinderName} have been messaged.\n\n` +
            `Come back here and click "Confirm Handover" once the physical exchange has happened.`
        );
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
        const claim = await updateClaim(claimId, { status: 'completed' });
        await updateReport(reportId, {
            status: 'resolved',
            resolved_at: new Date().toISOString()
        });
        await addPoints(finderId || claim.finder_id, POINTS.resolved);

        // Success messages to both parties
        try {
            await sendMessageToDb({
                report_id: reportId,
                receiver_id: claim.claimant_id,
                message:
                    `🎉 The case for "${claim.item_name}" has been successfully closed!\n\n` +
                    `The admin has confirmed that you received the item. Thank you for using the LostFinder system.`
            });
        } catch (_) { /* non-blocking */ }

        if (finderId) {
            try {
                await sendMessageToDb({
                    report_id: reportId,
                    receiver_id: finderId,
                    message:
                        `🎉 The case for "${claim.item_name}" has been successfully closed!\n\n` +
                        `The admin confirmed the handover to ${claim.claimant_name}. ` +
                        `You have been awarded ${POINTS.resolved} points. Thank you for being honest!`
                });
            } catch (_) { /* non-blocking */ }
        }

        alert(`✅ Handover confirmed! Report is now resolved and finder earned +${POINTS.resolved} points.`);
        loadClaimsPanel();
    } catch (err) {
        alert('Failed to confirm handover: ' + err.message);
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

        if (reason) {
            try {
                await sendMessageToDb({
                    report_id: reportId,
                    receiver_id: claimantId,
                    message: `Your claim was denied by admin. Reason: ${reason}`
                });
            } catch (_) { /* message failure is non-blocking */ }
        }

        loadClaimsPanel();
    } catch (err) {
        alert('Failed to deny claim: ' + err.message);
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm Denial'; }
    }
}

function denyClaim(claimId) {
    adminDenyStart(claimId);
}

async function markResolved(reportId, userId) {
    if (!confirm('Mark as resolved? Finder gets +20 bonus points!')) return;
    try {
        await updateReport(reportId, {
            status: 'resolved',
            resolved_at: new Date().toISOString()
        });
        await addPoints(userId, POINTS.resolved);
        alert('✅ Resolved! Finder earned +20 points.');
        loadAllItems();
    } catch (err) {
        alert('❌ Failed to resolve: ' + err.message);
    }
}

async function deleteReportAdmin(reportId) {
    if (!confirm('Delete this report?')) return;
    try {
        await deleteReport(reportId);
        alert('✅ Report deleted');
        loadAllItems();
    } catch (err) {
        alert('❌ Failed to delete: ' + err.message);
    }
}

let _adminUsers = [];
let _adminUsersSearch = '';

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
    const list = q
        ? _adminUsers.filter(u =>
            u.name.toLowerCase().includes(q) ||
            u.username.toLowerCase().includes(q) ||
            (u.email || '').toLowerCase().includes(q)
          )
        : _adminUsers;

    const admins = list.filter(u => u.role === 'admin').length;
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
        <p class="section-subtitle">${_adminUsers.length} registered account${_adminUsers.length !== 1 ? 's' : ''} &bull; ${admins} admin${admins !== 1 ? 's' : ''}</p>
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
    saveSettings, loadClaimsPanel, adminTagMatch, adminConfirmHandover, denyClaim,
    adminDenyStart, adminDenyCancel, adminDenyConfirm,
    filterAdminClaims, renderAllItems,
    loadAdminUsers, renderAdminUsers,
    markResolved, deleteReportAdmin, openMessageModal, openChat, closeMessageModal,
    sendNewMessage, openConversation, sendMessage, closeChatWindow,
    openReportModalFromNav, openClaimModal,
    downloadDashboardInsights
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
