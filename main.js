// ============ LOCAL STORAGE DATA MANAGEMENT ============
function getData(key) {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
}
function saveData(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
}

// ============ CONFIG ============
let currentUser = null;
let currentChatReportId = null;
let currentChatOtherUserId = null;
let uploadedImageBase64 = '';
const WEEKLY_REPORT_LIMIT = 3;

// ============ SYNONYM DICTIONARY (for smart matching) ============
const SYNONYMS = {
    'wallet': ['purse', 'billfold', 'cardholder'],
    'phone': ['cellphone', 'smartphone', 'mobile', 'cellular'],
    'bag': ['backpack', 'knapsack', 'sack', 'pouch', 'tote'],
    'laptop': ['notebook', 'computer', 'pc', 'macbook'],
    'glasses': ['eyeglasses', 'spectacles', 'shades', 'sunglasses'],
    'key': ['keys', 'keychain', 'keyholder'],
    'umbrella': ['parasol', 'brolly'],
    'charger': ['adapter', 'cable', 'cord'],
    'id': ['identification', 'student id', 'school id', 'idcard'],
    'notebook': ['journal', 'notes', 'pad'],
    'earphones': ['earbuds', 'headphones', 'airpods', 'headset'],
    'jacket': ['coat', 'hoodie', 'sweater', 'cardigan'],
    'shoes': ['sneakers', 'rubber shoes', 'footwear', 'sandals', 'slippers'],
    'pen': ['ballpen', 'marker', 'pencil'],
    'book': ['textbook', 'module', 'workbook'],
    'watch': ['timepiece', 'wristwatch'],
    'ring': ['band', 'jewelry'],
    'necklace': ['chain', 'jewelry', 'pendant'],
    'folder': ['binder', 'envelope', 'portfolio'],
};
const STOP_WORDS = new Set(['a','an','the','is','it','its','was','were','this','that',
    'with','and','or','in','on','at','to','of','for','by','i','my','your','their']);

// ============ SIMPLE HASH (for blind verification) ============
function simpleHash(str) {
    if (!str) return '';
    // Normalize: lowercase, trim, collapse spaces
    const normalized = str.toLowerCase().trim().replace(/\s+/g, ' ');
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
        const chr = normalized.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0;
    }
    return 'H' + Math.abs(hash).toString(36).toUpperCase();
}

// ============ LEVENSHTEIN DISTANCE ============
function levenshtein(a, b) {
    a = a.toLowerCase().trim();
    b = b.toLowerCase().trim();
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) =>
        Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i-1] === b[j-1]
                ? dp[i-1][j-1]
                : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
        }
    }
    return dp[m][n];
}

function stringSimilarity(a, b) {
    if (!a || !b) return 0;
    a = a.toLowerCase().trim();
    b = b.toLowerCase().trim();
    if (a === b) return 1;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    const dist = levenshtein(a, b);
    return Math.max(0, 1 - dist / maxLen);
}

// ============ KEYWORD EXTRACTION ============
function extractKeywords(text) {
    if (!text) return [];
    return text.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

function expandWithSynonyms(keywords) {
    const expanded = new Set(keywords);
    keywords.forEach(kw => {
        Object.entries(SYNONYMS).forEach(([base, syns]) => {
            if (kw === base || syns.includes(kw)) {
                expanded.add(base);
                syns.forEach(s => expanded.add(s));
            }
        });
    });
    return Array.from(expanded);
}

// ============ SMART MATCHING ENGINE ============
// Weights: Name 40%, Location 30%, Keywords 30%
function calculateMatchScore(lostReport, foundReport) {
    // Name similarity (40%)
    const nameSim = stringSimilarity(lostReport.item_name, foundReport.item_name);
    const nameScore = nameSim >= 0.8 ? nameSim : nameSim * 0.5; // partial credit if below threshold

    // Location match (30%)
    let locScore = 0;
    const lostLoc = (lostReport.location || '').toLowerCase().trim();
    const foundLoc = (foundReport.location || '').toLowerCase().trim();
    if (lostLoc && foundLoc) {
        if (lostLoc === foundLoc) {
            locScore = 1;
        } else if (lostLoc.includes(foundLoc) || foundLoc.includes(lostLoc)) {
            locScore = 0.5; // partial match
        } else {
            const locSim = stringSimilarity(lostLoc, foundLoc);
            locScore = locSim >= 0.7 ? locSim * 0.5 : 0;
        }
    }

    // Keyword match (30%)
    const lostKws = expandWithSynonyms(extractKeywords(
        (lostReport.item_name || '') + ' ' + (lostReport.description || '') + ' ' + (lostReport.category || '')
    ));
    const foundKws = expandWithSynonyms(extractKeywords(
        (foundReport.item_name || '') + ' ' + (foundReport.description || '') + ' ' + (foundReport.category || '')
    ));

    let kwScore = 0;
    if (lostKws.length > 0 && foundKws.length > 0) {
        const matchedKws = lostKws.filter(k => foundKws.includes(k));
        kwScore = matchedKws.length / Math.max(lostKws.length, foundKws.length);
    }

    const total = (nameScore * 0.40) + (locScore * 0.30) + (kwScore * 0.30);
    return Math.round(total * 100);
}

// Match indicator: Green 85-100%, Yellow 50-84%, Red 0-49% (hidden from users)
function getMatchBadge(score) {
    if (score >= 85) return `<span class="match-badge match-high">🟢 High Match (${score}%)</span>`;
    if (score >= 50) return `<span class="match-badge match-possible">🟡 Possible Match (${score}%)</span>`;
    return ''; // Red / low match hidden from regular users
}

// ============ FIND MATCHES FOR A LOST REPORT ============
function findMatches(lostReport) {
    const foundReports = getData('reports').filter(r => r.type === 'found' && r.status === 'pending');
    const matches = foundReports
        .map(f => ({ report: f, score: calculateMatchScore(lostReport, f) }))
        .filter(m => m.score >= 50) // only show possible/high matches
        .sort((a, b) => b.score - a.score);
    return matches;
}

// ============ ADMIN ACCOUNT ============
function initializeAdminAccount() {
    const users = getData('users');
    const adminIndex = users.findIndex(u => u.username === 'admin');
    if (adminIndex === -1) {
        users.push({
            id: 1, username: 'admin', password: btoa('admin123'),
            email: 'admin@icct.edu.ph', name: 'Admin User',
            role: 'admin', points: 0, contact_number: '',
            createdAt: new Date().toISOString()
        });
    } else {
        users[adminIndex].password = btoa('admin123');
    }
    saveData('users', users);
}

// ============ VALIDATION ============
function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function validatePassword(p) { return p.length >= 6; }
function validateUsername(u) { return u.length >= 3 && /^[a-zA-Z0-9_]+$/.test(u); }

// ============ WEEKLY SPAM PREVENTION ============
function getWeeklyReportCount(userId) {
    const reports = getData('reports').filter(r => r.userId === userId);
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    return reports.filter(r => new Date(r.created_at) >= oneWeekAgo).length;
}

// ============ NAVIGATION ============
function showLanding() {
    document.getElementById('landing-page').classList.remove('hidden');
    document.getElementById('login').classList.add('hidden');
    document.getElementById('register').classList.add('hidden');
    document.getElementById('app').classList.add('hidden');
}
function showLogin() {
    document.getElementById('landing-page').classList.add('hidden');
    document.getElementById('login').classList.remove('hidden');
}
function show(id) {
    document.querySelectorAll('.form-box').forEach(e => e.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

// ============ AUTH ============
function register() {
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const username = document.getElementById('regUsername').value.trim();
    const role = document.getElementById('regRole').value.trim();
    const idNumber = document.getElementById('regIdNumber').value.trim();
    const contact = document.getElementById('regContact').value.trim();
    const password = document.getElementById('regPassword').value;
    const rpass = document.getElementById('regRpass').value;

    if (!name || !email || !username || !password || !idNumber) {
        alert('❌ Please fill in all required fields (Name, Email, Username, School ID, Password)');
        return;
    }
    if (!validateEmail(email)) {
        alert('❌ Invalid email format! Example: user@icct.edu.ph');
        return;
    }
    if (!validateUsername(username)) {
        alert('❌ Username must be at least 3 characters (letters, numbers, underscore only)');
        return;
    }
    if (!validatePassword(password)) {
        alert('❌ Password must be at least 6 characters');
        return;
    }
    if (password !== rpass) {
        alert('❌ Passwords do not match!');
        return;
    }

    const users = getData('users');
    if (users.find(u => u.username === username)) {
        alert('❌ Username already taken. Please choose another.');
        return;
    }
    if (users.find(u => u.email === email)) {
        alert('❌ Email already registered. Please login instead.');
        return;
    }
    if (users.find(u => u.id_number === idNumber)) {
        alert('❌ School ID already registered.');
        return;
    }

    users.push({
        id: Date.now(), name, email, username,
        password: btoa(password),
        id_number: idNumber,
        contact_number: contact,
        role_label: role || 'Student',
        role: 'user', points: 0,
        createdAt: new Date().toISOString()
    });
    saveData('users', users);
    alert('✅ Account created! Welcome to LostFinder! You can now login.');
    show('login');
    ['regName','regEmail','regUsername','regRole','regIdNumber','regContact','regPassword','regRpass']
        .forEach(id => { document.getElementById(id).value = ''; });
}

function login() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!username || !password) {
        alert('❌ Please enter username and password');
        return;
    }

    const users = getData('users');
    const user = users.find(u =>
        (u.username.toLowerCase() === username.toLowerCase() || u.email.toLowerCase() === username.toLowerCase())
        && u.password === btoa(password)
    );

    if (user) {
        currentUser = user;
        document.getElementById('login').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        updateSidebar();
        page('dashboard');
        document.getElementById('loginUsername').value = '';
        document.getElementById('loginPassword').value = '';
    } else {
        alert('❌ Invalid username or password.\n\nAdmin login: admin / admin123');
    }
}

function logout() {
    if (confirm('Are you sure you want to logout?')) {
        currentUser = null;
        showLanding();
    }
}

// ============ SIDEBAR ============
function updateSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const adminLinks = currentUser.role === 'admin' ? `
        <a onclick="page('admin-panel')"><span class="nav-icon"></span> Admin Panel</a>
        <a onclick="page('all-items')"><span class="nav-icon"></span> All Items</a>
        <a onclick="page('claims-panel')"><span class="nav-icon"></span> Claims Review</a>
    ` : '';

    sidebar.innerHTML = `
        <div class="sidebar-header">
            <div class="sidebar-logo"></div>
            <h2>LostFinder</h2>
        </div>
        <div class="user-profile">
            <div class="user-avatar">👨🏻</div>
            <div class="user-info">
                <p class="user-name">${currentUser.name}${currentUser.role === 'admin' ? ' 👑' : ''}</p>
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

function page(id) {
    document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));
    document.querySelectorAll('main section').forEach(s => s.classList.add('hidden'));

    // Dynamically create admin sections if needed
    if ((id === 'admin-panel' || id === 'all-items' || id === 'claims-panel') && !document.getElementById(id)) {
        const sec = document.createElement('section');
        sec.id = id;
        sec.className = 'hidden';
        document.querySelector('.main').appendChild(sec);
    }

    const section = document.getElementById(id);
    if (section) section.classList.remove('hidden');

    document.querySelectorAll('.sidebar-nav a').forEach(link => {
        if (link.textContent.toLowerCase().includes(id.replace(/-/g, ' '))) {
            link.classList.add('active');
        }
    });

    if (id === 'dashboard') loadDashboard();
    if (id === 'lost') loadLostItems();
    if (id === 'found') loadFoundItems();
    if (id === 'reports') loadMyReports();
    if (id === 'leaderboard') loadLeaderboard();
    if (id === 'messages') loadConversations();
    if (id === 'settings') loadSettings();
    if (id === 'all-items') loadAllItems();
    if (id === 'admin-panel') loadAdminPanel();
    if (id === 'claims-panel') loadClaimsPanel();
}

// ============ REPORT MODAL ============
function toggleVerificationQuestions() {
    const type = document.getElementById('reportType').value;
    const vs = document.getElementById('verificationSection');
    const dl = document.getElementById('reportDateLabel');
    dl.textContent = type === 'found' ? 'Date Found' : 'Date Lost';
    type === 'found' ? vs.classList.remove('hidden') : vs.classList.add('hidden');
}

function openReportModal() {
    document.getElementById('reportModal').style.display = 'flex';
    uploadedImageBase64 = '';
    document.getElementById('imagePreview').innerHTML = '';
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
    const reader = new FileReader();
    reader.onload = e => {
        uploadedImageBase64 = e.target.result;
        document.getElementById('imagePreview').innerHTML =
            `<img src="${e.target.result}" style="max-width:200px;max-height:200px;border-radius:8px;margin-top:10px;">`;
    };
    reader.readAsDataURL(file);
}

function submitReport() {
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

    // Spam prevention: weekly limit
    const weeklyCount = getWeeklyReportCount(currentUser.id);
    if (weeklyCount >= WEEKLY_REPORT_LIMIT) {
        alert(`❌ Weekly report limit reached (${WEEKLY_REPORT_LIMIT} reports per week).\n\nThis helps maintain data quality and prevent spam. Please try again next week.`);
        return;
    }

    // Verification hashing for found items
    let verifyHashes = null;
    if (type === 'found') {
        const q1 = document.getElementById('verifyQ1').value.trim();
        const q2 = document.getElementById('verifyQ2').value.trim();
        const q3 = document.getElementById('verifyQ3').value.trim();
        if (!q1 || !q2 || !q3) {
            alert('❌ Please answer all 3 verification questions for found items.\n\nThese help verify the true owner during claims.');
            return;
        }
        verifyHashes = {
            q1: simpleHash(q1),
            q2: simpleHash(q2),
            q3: simpleHash(q3)
        };
    }

    const reports = getData('reports');
    const newReport = {
        id: Date.now(),
        userId: currentUser.id,
        userName: currentUser.name,
        type, category, item_name: itemName,
        location, date_reported: date,
        description,
        image_url: uploadedImageBase64,
        verify_hashes: verifyHashes,
        contact_number: currentUser.contact_number || '',
        status: 'pending',
        created_at: new Date().toISOString()
    };
    reports.push(newReport);
    saveData('reports', reports);

    // Points
    const points = type === 'lost' ? 5 : 10;
    currentUser.points += points;
    const users = getData('users');
    const ui = users.findIndex(u => u.id === currentUser.id);
    users[ui] = currentUser;
    saveData('users', users);

    const remaining = WEEKLY_REPORT_LIMIT - (weeklyCount + 1);
    alert(`✅ Report submitted!\n\n🎉 +${points} points earned!\n⭐ Total: ${currentUser.points} pts\n\n📊 Weekly reports remaining: ${remaining}/${WEEKLY_REPORT_LIMIT}`);
    closeReportModal();

    // Auto-run matching for lost reports
    if (type === 'lost') {
        const matches = findMatches(newReport);
        if (matches.length > 0) {
            const topMatch = matches[0];
            setTimeout(() => {
                alert(`🎯 Smart Match Found!\n\nWe found a possible match for your lost item:\n"${topMatch.report.item_name}" at ${topMatch.report.location}\nMatch Score: ${topMatch.score}%\n\nCheck "Found Items" to view it!`);
            }, 300);
        }
    }

    ['reportItemName','reportLocation','reportDescription','verifyQ1','verifyQ2','verifyQ3'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    uploadedImageBase64 = '';

    page(type === 'lost' ? 'lost' : 'found');
}

// ============ DASHBOARD ============
function loadDashboard() {
    if (currentUser.role === 'admin') {
        const all = getData('reports');
        document.getElementById('myLostCount').textContent = all.filter(r => r.type === 'lost' && r.status === 'pending').length;
        document.getElementById('myFoundCount').textContent = all.filter(r => r.type === 'found' && r.status === 'pending').length;
        document.getElementById('myResolvedCount').textContent = all.filter(r => r.status === 'resolved').length;
        document.querySelector('#dashboard .stat-card.blue h4').textContent = 'Total Lost';
        document.querySelector('#dashboard .stat-card.green h4').textContent = 'Total Found';
        document.querySelector('#dashboard .stat-card.purple h4').textContent = 'Total Resolved';
        document.getElementById('dashboardMatches').innerHTML = '';
    } else {
        const mine = getData('reports').filter(r => r.userId === currentUser.id);
        document.getElementById('myLostCount').textContent = mine.filter(r => r.type === 'lost').length;
        document.getElementById('myFoundCount').textContent = mine.filter(r => r.type === 'found').length;
        document.getElementById('myResolvedCount').textContent = mine.filter(r => r.status === 'resolved').length;
        document.querySelector('#dashboard .stat-card.blue h4').textContent = 'My Lost Items';
        document.querySelector('#dashboard .stat-card.green h4').textContent = 'My Found Items';
        document.querySelector('#dashboard .stat-card.purple h4').textContent = 'Resolved';

        // Show smart matches for user's pending lost items
        const myLost = mine.filter(r => r.type === 'lost' && r.status === 'pending');
        const matchesContainer = document.getElementById('dashboardMatches');
        const allMatches = [];
        myLost.forEach(lr => {
            findMatches(lr).forEach(m => allMatches.push({ lost: lr, found: m.report, score: m.score }));
        });

        if (allMatches.length > 0) {
            matchesContainer.innerHTML = `
                <div class="matches-section">
                    <h3>🎯 Smart Matches Found</h3>
                    <p style="color:#7f8c8d;margin-bottom:16px;">We found potential matches for your lost items!</p>
                    ${allMatches.slice(0, 3).map(m => `
                        <div class="match-card">
                            <div class="match-info">
                                <span class="match-lost-label">Lost: <strong>${m.lost.item_name}</strong></span>
                                <span style="margin:0 8px;color:#ccc;">→</span>
                                <span class="match-found-label">Found: <strong>${m.found.item_name}</strong></span>
                                <span style="margin-left:8px;color:#7f8c8d;font-size:0.9rem;">📍 ${m.found.location}</span>
                            </div>
                            ${getMatchBadge(m.score)}
                            <button onclick="openClaimModal(${m.found.id})" class="btn-primary" style="margin-top:8px;padding:8px 16px;font-size:0.9rem;">
                                🔐 Claim This Item
                            </button>
                        </div>
                    `).join('')}
                </div>
            `;
        } else {
            matchesContainer.innerHTML = '';
        }
    }
}

// ============ LOST ITEMS ============
function loadLostItems() {
    renderLostItems(getData('reports').filter(r => r.type === 'lost' && r.status === 'pending'));
}

function filterLostItems() {
    const q = document.getElementById('lostSearch').value.toLowerCase();
    const cat = document.getElementById('lostCategoryFilter').value;
    const all = getData('reports').filter(r => r.type === 'lost' && r.status === 'pending');
    const filtered = all.filter(r => {
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
        container.innerHTML = '<div class="empty-state"><p>No lost items found.</p></div>';
        return;
    }
    container.innerHTML = reports.map(r => {
        const imgHtml = r.image_url
            ? `<img src="${r.image_url}" alt="${r.item_name}" class="item-image">`
            : `<div class="item-image-placeholder">🔍</div>`;
        const isOwner = r.userId === currentUser.id;
        return `
            <div class="card">
                <div class="card-badges">
                    <span class="status-badge lost">Lost</span>
                    ${r.category ? `<span class="category-badge">${r.category}</span>` : ''}
                </div>
                ${imgHtml}
                <h4>${r.item_name}</h4>
                <p><strong>📍</strong> ${r.location}</p>
                <p><strong>👤</strong> ${r.userName}</p>
                <p><strong>📅</strong> ${r.date_reported || new Date(r.created_at).toLocaleDateString()}</p>
                <p style="margin-top:8px;">${r.description}</p>
                ${!isOwner ? `
                    <button onclick="openMessageModal(${r.id}, ${r.userId}, '${escapeQuotes(r.userName)}', '${escapeQuotes(r.item_name)}')" class="btn-secondary" style="margin-top:8px;">
                        💬 Message Owner
                    </button>` : '<p style="color:#7f8c8d;font-size:0.9rem;margin-top:8px;">📌 This is your item</p>'}
            </div>`;
    }).join('');
}

// ============ FOUND ITEMS ============
function loadFoundItems() {
    renderFoundItems(getData('reports').filter(r => r.type === 'found' && r.status === 'pending'));
}

function filterFoundItems() {
    const q = document.getElementById('foundSearch').value.toLowerCase();
    const cat = document.getElementById('foundCategoryFilter').value;
    const all = getData('reports').filter(r => r.type === 'found' && r.status === 'pending');
    const filtered = all.filter(r => {
        const matchQ = !q || r.item_name.toLowerCase().includes(q) ||
            r.location.toLowerCase().includes(q) ||
            (r.description || '').toLowerCase().includes(q);
        const matchCat = !cat || r.category === cat;
        return matchQ && matchCat;
    });
    renderFoundItems(filtered);
}

function renderFoundItems(reports) {
    const container = document.getElementById('foundItemsContainer');
    if (reports.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No found items at the moment.</p></div>';
        return;
    }

    // For each found item, compute match score against current user's lost items
    const myLost = currentUser.role !== 'admin'
        ? getData('reports').filter(r => r.userId === currentUser.id && r.type === 'lost' && r.status === 'pending')
        : [];

    container.innerHTML = reports.map(r => {
        const imgHtml = r.image_url
            ? `<img src="${r.image_url}" alt="${r.item_name}" class="item-image">`
            : `<div class="item-image-placeholder">✅</div>`;
        const isOwner = r.userId === currentUser.id;

        // Best match score against any of user's lost items
        let badgeHtml = '';
        if (myLost.length > 0) {
            const bestScore = Math.max(...myLost.map(lr => calculateMatchScore(lr, r)));
            badgeHtml = getMatchBadge(bestScore);
        }

        return `
            <div class="card">
                <div class="card-badges">
                    <span class="status-badge found">Found</span>
                    ${r.category ? `<span class="category-badge">${r.category}</span>` : ''}
                </div>
                ${badgeHtml}
                ${imgHtml}
                <h4>${r.item_name}</h4>
                <p><strong>📍</strong> ${r.location}</p>
                <p><strong>👤</strong> Found by: ${r.userName}</p>
                <p><strong>📅</strong> ${r.date_reported || new Date(r.created_at).toLocaleDateString()}</p>
                <p style="margin-top:8px;">${r.description}</p>
                ${!isOwner ? `
                    <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
                        ${r.verify_hashes ? `
                            <button onclick="openClaimModal(${r.id})" class="btn-primary" style="flex:1;padding:10px;">
                                🔐 Claim
                            </button>` : ''}
                        <button onclick="openMessageModal(${r.id}, ${r.userId}, '${escapeQuotes(r.userName)}', '${escapeQuotes(r.item_name)}')" class="btn-secondary" style="flex:1;padding:10px;">
                            💬 Message
                        </button>
                    </div>` : '<p style="color:#7f8c8d;font-size:0.9rem;margin-top:8px;">📌 You found this item</p>'}
            </div>`;
    }).join('');
}

// ============ BLIND VERIFICATION / CLAIM ============
function openClaimModal(reportId) {
    const reports = getData('reports');
    const report = reports.find(r => r.id === reportId);
    if (!report) return;
    if (!report.verify_hashes) {
        alert('This item has no verification questions set. Contact the finder via Messages.');
        return;
    }

    document.getElementById('claimItemTitle').textContent = `Item: "${report.item_name}" found at ${report.location}`;
    document.getElementById('claimReportId').value = reportId;
    ['claimQ1','claimQ2','claimQ3'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('claimModal').style.display = 'flex';
}

function closeClaimModal() {
    document.getElementById('claimModal').style.display = 'none';
}

function submitClaim() {
    const reportId = parseInt(document.getElementById('claimReportId').value);
    const a1 = document.getElementById('claimQ1').value.trim();
    const a2 = document.getElementById('claimQ2').value.trim();
    const a3 = document.getElementById('claimQ3').value.trim();

    if (!a1 || !a2 || !a3) {
        alert('❌ Please answer all verification questions');
        return;
    }

    // Vague answer check (5 words or less for ALL answers combined — flag for admin review)
    const totalWords = (a1 + ' ' + a2 + ' ' + a3).trim().split(/\s+/).length;
    const isVague = totalWords <= 5;

    const reports = getData('reports');
    const report = reports.find(r => r.id === reportId);
    if (!report || !report.verify_hashes) return;

    const h1 = simpleHash(a1), h2 = simpleHash(a2), h3 = simpleHash(a3);
    const exactMatch = h1 === report.verify_hashes.q1 && h2 === report.verify_hashes.q2 && h3 === report.verify_hashes.q3;

    const claims = getData('claims');
    const newClaim = {
        id: Date.now(),
        report_id: reportId,
        item_name: report.item_name,
        finder_id: report.userId,
        claimant_id: currentUser.id,
        claimant_name: currentUser.name,
        answer_hashes: { q1: h1, q2: h2, q3: h3 },
        exact_match: exactMatch,
        vague: isVague,
        status: exactMatch ? 'auto-approved' : 'pending-review',
        created_at: new Date().toISOString()
    };
    claims.push(newClaim);
    saveData('claims', claims);

    closeClaimModal();

    if (exactMatch) {
        // Auto-approve: generate one-time retrieval code
        const code = 'LF-' + Math.random().toString(36).substring(2, 8).toUpperCase();
        newClaim.retrieval_code = code;
        const idx = claims.length - 1;
        claims[idx] = newClaim;
        saveData('claims', claims);

        // Award +20 to finder
        const users = getData('users');
        const fi = users.findIndex(u => u.id === report.userId);
        if (fi !== -1) { users[fi].points += 20; saveData('users', users); }

        // Mark report resolved
        const ri = reports.findIndex(r => r.id === reportId);
        reports[ri].status = 'resolved';
        reports[ri].resolved_at = new Date().toISOString();
        saveData('reports', reports);

        alert(`✅ Verification Successful! Ownership Confirmed!\n\n🎟️ Your One-Time Retrieval Code:\n\n    ${code}\n\nPresent this code to claim your item. Code is valid for 48 hours.`);
    } else if (isVague) {
        alert('⚠️ Your answers seem too brief. Your claim has been flagged for Admin Review.\n\nAn administrator will verify your claim manually and contact you.');
    } else {
        alert('⚠️ Answers did not match exactly. Your claim has been sent for Admin Review.\n\nAn administrator will compare answers and make a decision.');
    }
}

// ============ MY REPORTS ============
function loadMyReports() {
    const mine = getData('reports').filter(r => r.userId === currentUser.id);
    const lost = mine.filter(r => r.type === 'lost');
    const found = mine.filter(r => r.type === 'found');
    document.getElementById('lostTabCount').textContent = lost.length;
    document.getElementById('foundTabCount').textContent = found.length;

    const weekly = getWeeklyReportCount(currentUser.id);
    const remaining = WEEKLY_REPORT_LIMIT - weekly;
    document.getElementById('weeklyLimitInfo').innerHTML = `
        <div class="weekly-info-bar">
            📊 Weekly Reports: <strong>${weekly}/${WEEKLY_REPORT_LIMIT}</strong> used &nbsp;|&nbsp; 
            <strong>${remaining}</strong> remaining this week
            ${remaining === 0 ? '<span class="limit-warning"> ⚠️ Limit reached</span>' : ''}
        </div>`;

    renderReportsList('myLostReports', lost);
    renderReportsList('myFoundReports', found);
}

function renderReportsList(containerId, reports) {
    const container = document.getElementById(containerId);
    if (reports.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No items reported yet.</p></div>';
        return;
    }
    container.innerHTML = reports.map(r => {
        const imgHtml = r.image_url
            ? `<img src="${r.image_url}" alt="${r.item_name}" style="max-width:100%;border-radius:8px;margin-bottom:12px;">` : '';
        return `
            <div class="card">
                <div class="card-badges">
                    <span class="status-badge ${r.status}">${r.status === 'resolved' ? '✅ Resolved' : '⏳ Pending'}</span>
                    ${r.category ? `<span class="category-badge">${r.category}</span>` : ''}
                </div>
                ${imgHtml}
                <h4>${r.item_name}</h4>
                <p><strong>📍</strong> ${r.location}</p>
                <p><strong>📅</strong> ${r.date_reported || new Date(r.created_at).toLocaleDateString()}</p>
                <p style="margin-top:8px;">${r.description}</p>
                ${r.type === 'found' && r.verify_hashes ? '<p style="color:#27ae60;font-size:0.85rem;margin-top:4px;">🔒 Verification questions set</p>' : ''}
            </div>`;
    }).join('');
}

function showReportTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.currentTarget.classList.add('active');
    document.getElementById('lostReports').classList.toggle('hidden', tab !== 'lost');
    document.getElementById('foundReports').classList.toggle('hidden', tab !== 'found');
}

// ============ LEADERBOARD ============
function loadLeaderboard() {
    const users = getData('users').filter(u => u.role === 'user').sort((a, b) => b.points - a.points);
    const reports = getData('reports');
    const table = document.getElementById('leaderboardTable');
    if (users.length === 0) {
        table.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;">No users yet</td></tr>';
        return;
    }
    table.innerHTML = users.map((user, i) => {
        const rank = i + 1;
        const icon = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
        const badge = user.points >= 100 ? '⭐ Hero' : user.points >= 50 ? '💫 Helper' : user.points >= 20 ? '✨ Contributor' : '🌟 Beginner';
        const rCount = reports.filter(r => r.userId === user.id).length;
        const isMe = currentUser && user.id === currentUser.id;
        return `
            <tr style="${isMe ? 'background:#f0f4ff;font-weight:600;' : ''}">
                <td style="font-size:1.5rem;">${icon}</td>
                <td>${user.name} ${isMe ? '<span style="color:#2563eb;">(You)</span>' : ''}</td>
                <td style="font-weight:700;color:#2563eb;">${user.points}</td>
                <td>${rCount}</td>
                <td>${badge}</td>
            </tr>`;
    }).join('');
}

// ============ SETTINGS ============
function loadSettings() {
    document.getElementById('settingsName').value = currentUser.name;
    document.getElementById('settingsEmail').value = currentUser.email;
    document.getElementById('settingsUsername').value = currentUser.username;
    document.getElementById('settingsContact').value = currentUser.contact_number || '';
}

function saveSettings() {
    const name = document.getElementById('settingsName').value.trim();
    const contact = document.getElementById('settingsContact').value.trim();
    if (!name) { alert('❌ Name cannot be empty'); return; }

    const users = getData('users');
    const ui = users.findIndex(u => u.id === currentUser.id);
    users[ui].name = name;
    users[ui].contact_number = contact;
    currentUser.name = name;
    currentUser.contact_number = contact;
    saveData('users', users);
    updateSidebar();
    alert('✅ Settings saved successfully!');
}

// ============ ADMIN PANEL ============
function loadAdminPanel() {
    if (currentUser.role !== 'admin') { page('dashboard'); return; }
    const users = getData('users').filter(u => u.role === 'user');
    const reports = getData('reports');
    const messages = getData('messages');
    const claims = getData('claims');

    const stats = {
        users: users.length,
        reports: reports.length,
        lost: reports.filter(r => r.type === 'lost' && r.status === 'pending').length,
        found: reports.filter(r => r.type === 'found' && r.status === 'pending').length,
        resolved: reports.filter(r => r.status === 'resolved').length,
        messages: messages.length,
        pendingClaims: claims.filter(c => c.status === 'pending-review').length,
        totalPoints: users.reduce((s, u) => s + u.points, 0)
    };
    const topUsers = [...users].sort((a, b) => b.points - a.points).slice(0, 5);

    document.getElementById('admin-panel').innerHTML = `
        <h2>🛡️ Admin Dashboard</h2>
        <p class="section-subtitle">System Overview and Statistics</p>
        <div class="stats-cards">
            ${[
                ['blue','👤','Total Users', stats.users],
                ['green','📊','Total Reports', stats.reports],
                ['purple','🔍','Active Lost', stats.lost],
                ['blue','✅','Active Found', stats.found],
                ['green','🎯','Resolved', stats.resolved],
                ['purple','🔐','Pending Claims', stats.pendingClaims],
                ['blue','💬','Messages', stats.messages],
                ['green','⭐','Total Points', stats.totalPoints]
            ].map(([color, icon, label, value]) => `
                <div class="stat-card ${color}">
                    <div class="stat-icon">${icon}</div>
                    <div class="stat-info"><h4>${label}</h4><p class="stat-number">${value}</p></div>
                </div>`).join('')}
        </div>
        <div style="margin-top:40px;">
            <h3>🏆 Top Contributors</h3>
            <div class="leaderboard-container" style="margin-top:20px;">
                <table class="leaderboard-table">
                    <thead><tr><th>Rank</th><th>Name</th><th>Username</th><th>Points</th><th>Reports</th></tr></thead>
                    <tbody>
                        ${topUsers.map((u, i) => `
                            <tr>
                                <td>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                                <td>${u.name}</td><td>${u.username}</td>
                                <td style="font-weight:700;color:#2563eb;">${u.points}</td>
                                <td>${reports.filter(r => r.userId === u.id).length}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
}

// ============ ALL ITEMS (ADMIN) ============
function loadAllItems() {
    if (currentUser.role !== 'admin') { page('dashboard'); return; }
    const reports = getData('reports');
    const container = document.getElementById('all-items');
    container.innerHTML = `
        <h2>📋 All Items</h2>
        <p class="section-subtitle">Manage all reported items in the system</p>
        ${reports.length === 0 ? '<div class="empty-state"><p>No items in system.</p></div>' : `
        <div class="cards">
            ${reports.map(r => {
                const imgHtml = r.image_url ? `<img src="${r.image_url}" alt="${r.item_name}" style="max-width:100%;border-radius:8px;margin-bottom:12px;">` : '';
                return `
                    <div class="card">
                        <div class="card-badges">
                            <span class="status-badge ${r.type}">${r.type === 'lost' ? 'Lost' : 'Found'}</span>
                            <span class="status-badge ${r.status}">${r.status}</span>
                            ${r.category ? `<span class="category-badge">${r.category}</span>` : ''}
                        </div>
                        ${imgHtml}
                        <h4>${r.item_name}</h4>
                        <p><strong>👤</strong> ${r.userName}</p>
                        <p><strong>📍</strong> ${r.location}</p>
                        <p><strong>📅</strong> ${r.date_reported || new Date(r.created_at).toLocaleDateString()}</p>
                        <p style="margin-top:8px;">${r.description}</p>
                        <div style="display:flex;gap:8px;margin-top:12px;">
                            ${r.status === 'pending' ? `<button onclick="markResolved(${r.id},${r.userId})" class="btn-primary" style="flex:1;">✅ Resolve</button>` : ''}
                            <button onclick="deleteReport(${r.id})" class="btn-danger" style="flex:1;">🗑️ Delete</button>
                        </div>
                    </div>`;
            }).join('')}
        </div>`}`;
}

// ============ CLAIMS REVIEW (ADMIN) ============
function loadClaimsPanel() {
    if (currentUser.role !== 'admin') { page('dashboard'); return; }
    const claims = getData('claims');
    const container = document.getElementById('claims-panel');

    container.innerHTML = `
        <h2>🔐 Claims Review</h2>
        <p class="section-subtitle">Review and manage verification claims</p>
        ${claims.length === 0 ? '<div class="empty-state"><p>No claims submitted yet.</p></div>' : `
        <div class="claims-list">
            ${claims.map(c => `
                <div class="claim-card">
                    <div class="claim-header">
                        <strong>${c.item_name}</strong>
                        <span class="status-badge ${c.status === 'auto-approved' ? 'resolved' : c.status === 'approved' ? 'resolved' : c.status === 'denied' ? 'lost' : 'found'}">
                            ${c.status === 'auto-approved' ? '✅ Auto-Approved' : c.status === 'approved' ? '✅ Approved' : c.status === 'denied' ? '❌ Denied' : '⏳ Pending Review'}
                        </span>
                    </div>
                    <p><strong>👤 Claimant:</strong> ${c.claimant_name}</p>
                    <p><strong>📅 Submitted:</strong> ${new Date(c.created_at).toLocaleString()}</p>
                    ${c.vague ? '<p style="color:#e67e22;">⚠️ Flagged: Vague answers</p>' : ''}
                    ${c.exact_match ? '<p style="color:#27ae60;">✅ Hash match confirmed</p>' : '<p style="color:#e74c3c;">❌ Hash mismatch</p>'}
                    ${c.retrieval_code ? `<p><strong>🎟️ Retrieval Code:</strong> <code>${c.retrieval_code}</code></p>` : ''}
                    <p style="font-size:0.8rem;color:#95a5a6;">⚠️ Answer contents hidden per Blind Verification Protocol</p>
                    ${c.status === 'pending-review' ? `
                        <div style="display:flex;gap:8px;margin-top:12px;">
                            <button onclick="approveClaim(${c.id})" class="btn-primary" style="flex:1;">✅ Approve</button>
                            <button onclick="denyClaim(${c.id})" class="btn-danger" style="flex:1;">❌ Deny</button>
                        </div>` : ''}
                </div>`).join('')}
        </div>`}`;
}

function approveClaim(claimId) {
    if (!confirm('Approve this claim and generate a retrieval code?')) return;
    const claims = getData('claims');
    const ci = claims.findIndex(c => c.id === claimId);
    if (ci === -1) return;

    const code = 'LF-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    claims[ci].status = 'approved';
    claims[ci].retrieval_code = code;
    saveData('claims', claims);

    // Mark report resolved + award points to finder
    const reports = getData('reports');
    const ri = reports.findIndex(r => r.id === claims[ci].report_id);
    if (ri !== -1) {
        reports[ri].status = 'resolved';
        reports[ri].resolved_at = new Date().toISOString();
        saveData('reports', reports);
        const users = getData('users');
        const fi = users.findIndex(u => u.id === reports[ri].userId);
        if (fi !== -1) { users[fi].points += 20; saveData('users', users); }
    }

    alert(`✅ Claim approved!\n\n🎟️ Retrieval Code: ${code}`);
    loadClaimsPanel();
}

function denyClaim(claimId) {
    if (!confirm('Deny this claim?')) return;
    const claims = getData('claims');
    const ci = claims.findIndex(c => c.id === claimId);
    if (ci !== -1) { claims[ci].status = 'denied'; saveData('claims', claims); }
    alert('❌ Claim denied.');
    loadClaimsPanel();
}

function markResolved(reportId, userId) {
    if (!confirm('Mark as resolved? Finder gets +20 bonus points!')) return;
    const reports = getData('reports');
    const ri = reports.findIndex(r => r.id === reportId);
    if (ri === -1) return;
    reports[ri].status = 'resolved';
    reports[ri].resolved_at = new Date().toISOString();
    saveData('reports', reports);
    const users = getData('users');
    const ui = users.findIndex(u => u.id === userId);
    if (ui !== -1) { users[ui].points += 20; saveData('users', users); }
    alert('✅ Resolved! Finder earned +20 points.');
    loadAllItems();
}

function deleteReport(reportId) {
    if (!confirm('Delete this report?')) return;
    saveData('reports', getData('reports').filter(r => r.id !== reportId));
    alert('✅ Report deleted');
    loadAllItems();
}

// ============ MESSAGING ============
function openMessageModal(reportId, receiverId, receiverName, itemName) {
    if (!document.getElementById('messageModal')) {
        const modal = document.createElement('div');
        modal.id = 'messageModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <span class="close" onclick="closeMessageModal()">✖</span>
                <h3>Send Message</h3>
                <p>About: <strong id="messageItemName"></strong></p>
                <p>To: <strong id="messageReceiverName"></strong></p>
                <div class="form-group">
                    <label>Your Message</label>
                    <textarea id="newMessageText" placeholder="Type your message..." rows="5"></textarea>
                </div>
                <input type="hidden" id="messageReportId">
                <input type="hidden" id="messageReceiverId">
                <button class="btn-primary btn-block" onclick="sendNewMessage()">Send Message</button>
            </div>`;
        document.body.appendChild(modal);
    }
    document.getElementById('messageReportId').value = reportId;
    document.getElementById('messageReceiverId').value = receiverId;
    document.getElementById('messageReceiverName').textContent = receiverName;
    document.getElementById('messageItemName').textContent = itemName;
    document.getElementById('newMessageText').value = '';
    document.getElementById('messageModal').style.display = 'flex';
}

function closeMessageModal() {
    const m = document.getElementById('messageModal');
    if (m) m.style.display = 'none';
}

function sendNewMessage() {
    const reportId = parseInt(document.getElementById('messageReportId').value);
    const receiverId = parseInt(document.getElementById('messageReceiverId').value);
    const message = document.getElementById('newMessageText').value.trim();
    if (!message) { alert('❌ Please enter a message'); return; }

    const messages = getData('messages');
    messages.push({
        id: Date.now(), report_id: reportId,
        sender_id: currentUser.id, sender_name: currentUser.name,
        receiver_id: receiverId, message,
        created_at: new Date().toISOString(), is_read: false
    });
    saveData('messages', messages);
    alert('✅ Message sent!');
    closeMessageModal();
    page('messages');
}

function loadConversations() {
    const messages = getData('messages');
    const reports = getData('reports');
    const map = new Map();

    messages.forEach(msg => {
        const isSender = msg.sender_id === currentUser.id;
        const otherId = isSender ? msg.receiver_id : msg.sender_id;
        const key = `${msg.report_id}-${otherId}`;
        if (!map.has(key) || new Date(msg.created_at) > new Date(map.get(key).last_message_at)) {
            const report = reports.find(r => r.id === msg.report_id);
            const users = getData('users');
            const other = users.find(u => u.id === otherId);
            map.set(key, {
                report_id: msg.report_id,
                other_user_id: otherId,
                other_user_name: other ? other.name : (isSender ? 'User' : msg.sender_name),
                item_name: report ? report.item_name : 'Item',
                report_type: report ? report.type : 'lost',
                last_message: msg.message,
                last_message_at: msg.created_at
            });
        }
    });

    const conversations = Array.from(map.values()).sort((a, b) =>
        new Date(b.last_message_at) - new Date(a.last_message_at));
    const container = document.getElementById('conversationsList');

    if (conversations.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding:40px 20px;"><p>No conversations yet</p></div>';
        return;
    }
    container.innerHTML = conversations.map(c => `
        <div class="conversation-item" onclick="openConversation(${c.report_id}, ${c.other_user_id})">
            <div style="font-weight:600;margin-bottom:4px;">${c.other_user_name}</div>
            <div style="font-size:0.85rem;color:#7f8c8d;margin-bottom:4px;">
                ${c.report_type === 'lost' ? '🔍' : '✅'} ${c.item_name}
            </div>
            <div style="font-size:0.85rem;color:#95a5a6;">
                ${c.last_message.substring(0, 50)}${c.last_message.length > 50 ? '...' : ''}
            </div>
        </div>`).join('');
}

function openConversation(reportId, otherUserId) {
    currentChatReportId = reportId;
    currentChatOtherUserId = otherUserId;
    document.getElementById('chatEmpty').classList.add('hidden');
    document.getElementById('chatWindow').classList.remove('hidden');
    loadMessages();
}

function loadMessages() {
    if (!currentChatReportId) return;
    const messages = getData('messages').filter(m =>
        m.report_id === currentChatReportId &&
        ((m.sender_id === currentUser.id && m.receiver_id === currentChatOtherUserId) ||
         (m.sender_id === currentChatOtherUserId && m.receiver_id === currentUser.id))
    );
    if (messages.length === 0) return;

    const report = getData('reports').find(r => r.id === currentChatReportId);
    const users = getData('users');
    const other = users.find(u => u.id === currentChatOtherUserId);

    document.getElementById('chatUserName').textContent = other ? other.name : 'User';
    document.getElementById('chatItemName').textContent = report ? `About: ${report.item_name}` : 'About: Item';

    const container = document.getElementById('chatMessages');
    container.innerHTML = messages.map(m => `
        <div class="message ${m.sender_id === currentUser.id ? 'sent' : 'received'}">
            <div class="message-bubble">${m.message}</div>
            <div class="message-time">${new Date(m.created_at).toLocaleString()}</div>
        </div>`).join('');
    container.scrollTop = container.scrollHeight;
}

function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    if (!message) return;
    const messages = getData('messages');
    messages.push({
        id: Date.now(), report_id: currentChatReportId,
        sender_id: currentUser.id, sender_name: currentUser.name,
        receiver_id: currentChatOtherUserId, message,
        created_at: new Date().toISOString(), is_read: false
    });
    saveData('messages', messages);
    input.value = '';
    loadMessages();
    loadConversations();
}

function closeChatWindow() {
    document.getElementById('chatWindow').classList.add('hidden');
    document.getElementById('chatEmpty').classList.remove('hidden');
    currentChatReportId = null;
    currentChatOtherUserId = null;
}

// ============ MODALS ============
function openReportModalFromNav() { openReportModal(); }
function closeModal() { document.getElementById('modal').style.display = 'none'; }

window.onclick = function(event) {
    ['reportModal','claimModal','modal'].forEach(id => {
        const m = document.getElementById(id);
        if (m && event.target === m) m.style.display = 'none';
    });
    const mm = document.getElementById('messageModal');
    if (mm && event.target === mm) closeMessageModal();
};

// ============ UTILITY ============
function escapeQuotes(str) {
    return (str || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
    initializeAdminAccount();
    console.log('🚀 LostFinder initialized!');
    console.log('🔐 Admin: admin / admin123');
    console.log('✅ Smart Matching Engine: Active');
    console.log('🔒 Blind Verification Protocol: Active');
});
 