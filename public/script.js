
const notification = document.getElementById("notification");
const authModal = document.getElementById("authModal");

let notificationTimer;

function showMessage(message) {
    notification.textContent = message;
    notification.classList.add("show");

    clearTimeout(notificationTimer);

    notificationTimer = setTimeout(() => {
        notification.classList.remove("show");
    }, 3000);
}

async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    const responseText = await response.text();
    let data;

    try {
        data = responseText ? JSON.parse(responseText) : {};
    } catch {
        if (!response.ok && [502, 503, 504].includes(response.status)) {
            throw new Error("AI analiz servisi geçici olarak yanıt veremiyor. Lütfen birkaç dakika sonra tekrar deneyin.");
        }
        throw new Error("Sunucudan geçersiz yanıt alındı (HTTP " + response.status + ").");
    }

    if (!response.ok) {
        throw new Error(data.message || "Bir hata oluştu.");
    }

    return data;
}

function updateMemberUI(user) {
    const guestActions = document.getElementById("guestActions");
    const memberActions = document.getElementById("memberActions");
    const adminOpenButton = document.getElementById("adminOpenButton");

    if (!user) {
        guestActions.classList.remove("hidden");
        memberActions.classList.add("hidden");

        if (adminOpenButton) {
            adminOpenButton.classList.add("hidden");
        }
        return;
    }

    guestActions.classList.add("hidden");
    memberActions.classList.remove("hidden");

    document.getElementById("headerUserName").textContent =
        `${user.firstName} ${user.lastName}`;


    if (adminOpenButton) {
        adminOpenButton.classList.toggle("hidden", user.role !== "admin");
    }
}

function openAuth(mode = "login") {
    authModal.classList.remove("hidden");
    switchAuth(mode);
    document.body.style.overflow = "hidden";
}

function closeAuth() {
    authModal.classList.add("hidden");
    document.body.style.overflow = "";
}

function switchAuth(mode) {
    const isLogin = mode === "login";
    const isRegister = mode === "register";
    const isForgot = mode === "forgot";
    const isReset = mode === "reset";
    const tabs = authModal.querySelector(".auth-tabs");

    tabs.classList.toggle("hidden", isForgot || isReset);
    document.getElementById("loginForm").classList.toggle("hidden", !isLogin);
    document.getElementById("registerForm").classList.toggle("hidden", !isRegister);
    document.getElementById("forgotPasswordForm").classList.toggle("hidden", !isForgot);
    document.getElementById("resetPasswordForm").classList.toggle("hidden", !isReset);

    document.getElementById("loginTab").classList.toggle("active", isLogin);
    document.getElementById("registerTab").classList.toggle("active", isRegister);
}

async function loadCurrentUser() {
    try {
        const data = await apiRequest("/api/auth/me", {
            method: "GET",
            headers: {}
        });

        updateMemberUI(data.user);
    } catch (error) {
        console.error("Üyelik bilgisi alınamadı:", error);
        updateMemberUI(null);
    }
}

document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;

    try {
        const data = await apiRequest("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password })
        });

        updateMemberUI(data.user);
        document.getElementById("loginForm").reset();
        closeAuth();
        showMessage(`Hoş geldin ${data.user.firstName}!`);
    } catch (error) {
        showMessage(error.message);
    }
});

document.getElementById("registerForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const firstName = document.getElementById("firstName").value.trim();
    const lastName = document.getElementById("lastName").value.trim();
    const birthDate = document.getElementById("birthDate").value;
    const email = document.getElementById("registerEmail").value.trim();
    const password = document.getElementById("registerPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (password !== confirmPassword) {
        showMessage("Şifreler birbiriyle eşleşmiyor.");
        return;
    }

    try {
        const data = await apiRequest("/api/auth/register", {
            method: "POST",
            body: JSON.stringify({
                firstName,
                lastName,
                birthDate,
                email,
                password
            })
        });

        updateMemberUI(data.user);
        document.getElementById("registerForm").reset();
        closeAuth();

        showMessage("Üyeliğin oluşturuldu! Lunara'daki tüm analizler ücretsiz.");
    } catch (error) {
        showMessage(error.message);
    }
});

let pendingResetToken = "";

document.getElementById("forgotPasswordForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("forgotEmail").value.trim();

    try {
        const data = await apiRequest("/api/auth/forgot-password", {
            method: "POST",
            body: JSON.stringify({ email })
        });

        document.getElementById("forgotPasswordForm").reset();
        switchAuth("login");
        showMessage(data.message);
    } catch (error) {
        showMessage(error.message);
    }
});

document.getElementById("resetPasswordForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const password = document.getElementById("resetPassword").value;
    const confirmation = document.getElementById("resetPasswordConfirm").value;

    if (password !== confirmation) {
        showMessage("Şifreler birbiriyle eşleşmiyor.");
        return;
    }

    if (!pendingResetToken) {
        showMessage("Sıfırlama bağlantısı bulunamadı. E-postanızdan yeni bağlantı isteyin.");
        switchAuth("forgot");
        return;
    }

    try {
        const data = await apiRequest("/api/auth/reset-password", {
            method: "POST",
            body: JSON.stringify({
                token: pendingResetToken,
                password
            })
        });

        pendingResetToken = "";
        document.getElementById("resetPasswordForm").reset();
        switchAuth("login");
        showMessage(data.message);
    } catch (error) {
        showMessage(error.message);
    }
});

async function logout() {
    try {
        await apiRequest("/api/auth/logout", {
            method: "POST",
            body: JSON.stringify({})
        });

        updateMemberUI(null);
        showMessage("Güvenli çıkış yapıldı.");
    } catch (error) {
        showMessage(error.message);
    }
}

const analysisModal = document.getElementById("analysisModal");

const titles = {
    tarot: "Tarot Falı",
    coffee: "Kahve Falı",
    horoscope: "Burçlar",
    birthchart: "Doğum Haritası",
    love: "Aşk Falı",
    numerology: "Numeroloji",
    general: "Genel Fal",
    personal: "Kişisel Analiz"
};

function openFeature(featureName) {
    const memberVisible = !document
        .getElementById("memberActions")
        .classList.contains("hidden");

    if (!memberVisible) {
        showMessage("Bu özelliği kullanmak için önce giriş yapmalısın.");
        openAuth("login");
        return;
    }

    const normalized = String(featureName).toLocaleLowerCase("tr-TR");
    const featureTypes = {
        "tarot falı": "tarot",
        "kahve falı": "coffee",
        "burçlar": "horoscope",
        "doğum haritası": "birthchart",
        "aşk falı": "love",
        "numeroloji": "numerology",
        "genel fal": "general",
        "kişisel analiz": "personal"
    };
    const type = featureTypes[normalized] || "personal";
    document.getElementById("analysisForm").reset();
    document.getElementById("analysisType").value = type;
    const featureTitles = {
        tarot: "Tarot Falı",
        coffee: "Kahve Falı",
        horoscope: "Burçlar",
        birthchart: "Doğum Haritası",
        love: "Aşk Falı",
        numerology: "Numeroloji",
        general: "Genel Fal",
        personal: "Kişisel Analiz"
    };
    document.getElementById("analysisTitle").textContent = featureTitles[type] || "Kişisel Analiz";
    document.getElementById("analysisDescription").textContent =
        "Gemini yapay zekâsı ile hazırlanan sana özel sembolik yorum.";
    const personalTypes = ["birthchart", "love", "numerology", "general", "personal"];
    ["tarot", "coffee", "horoscope", "personal"].forEach(name => {
        document.getElementById(name + "Fields").classList.toggle(
            "hidden",
            name === "personal" ? !personalTypes.includes(type) : name !== type
        );
    });
    const questionLabel = document.querySelector('label[for="personalQuestion"]');
    const questionInput = document.getElementById("personalQuestion");
    const prompts = {
        birthchart: {
            label: "Doğum tarihi, saati ve doğum yeri",
            placeholder: "Doğum tarihini, mümkünse kesin doğum saatini ve doğduğun şehir/ülkeyi yaz. Saat bilinmiyorsa belirt."
        },
        love: {
            label: "Aşk hayatın ve merak ettiğin konu",
            placeholder: "İlişki durumunu ve aşk hayatında merak ettiğin konuyu anlat..."
        },
        numerology: {
            label: "Ad-soyad ve doğum tarihi",
            placeholder: "Numeroloji yorumu için kullanmak istediğin ad-soyadını ve doğum tarihini yaz..."
        },
        general: {
            label: "Yorumlanmasını istediğin konu (isteğe bağlı)",
            placeholder: "Aşk, iş, aile veya genel yaşam hakkında merak ettiğin konuyu yaz..."
        },
        personal: {
            label: "Kendin hakkında paylaşmak istediklerin",
            placeholder: "Sorunu, hedefini veya üzerinde düşündüğün konuyu anlat..."
        }
    };
    questionLabel.textContent = prompts[type]?.label || prompts.personal.label;
    questionInput.placeholder = prompts[type]?.placeholder || prompts.personal.placeholder;
    questionInput.required = type !== "general";
    document.getElementById("analysisForm").classList.remove("hidden");
    document.getElementById("analysisLoading").classList.add("hidden");
    document.getElementById("analysisResult").classList.add("hidden");
    document.getElementById("lunaraAudioPlayer").classList.add("hidden");
    analysisModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    loadAnalysisHistory();
}

function closeAnalysisModal() {
    stopLunaraAudio();
    analysisModal.classList.add("hidden");
    document.body.style.overflow = "";
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Fotoğraf okunamadı."));
        reader.readAsDataURL(file);
    });
}

let analysisHistoryCache = [];

async function loadAnalysisHistory() {
    const container = document.getElementById("analysisHistoryList");
    try {
        const data = await apiRequest("/api/analyses", { method: "GET", headers: {} });
        analysisHistoryCache = data.analyses || [];
        if (!analysisHistoryCache.length) {
            container.innerHTML = '<p class="analysis-hint">Henüz analiz geçmişin yok.</p>';
            return;
        }
        container.innerHTML = analysisHistoryCache.map(item => `
            <div class="history-item-row">
                <button type="button" class="history-item" data-history-id="${item.id}">
                    <span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.createdAt)}</small></span>
                    <span aria-hidden="true"></span>
                </button>
                <button type="button" class="history-delete-button" data-delete-history-id="${item.id}" aria-label="Analizi sil" title="Analizi sil">Sil</button>
            </div>
        `).join("");
    } catch (error) {
        container.textContent = error.message;
    }
}

function showAnalysisResult(analysis) {
    stopLunaraAudio();
    document.getElementById("analysisForm").classList.add("hidden");
    document.getElementById("analysisLoading").classList.add("hidden");
    document.getElementById("analysisResult").classList.remove("hidden");
    document.getElementById("lunaraAudioPlayer").classList.remove("hidden");
    document.getElementById("analysisResultTitle").textContent = analysis.title;
    document.getElementById("analysisResultContent").textContent = analysis.content;
    document.getElementById("lunaraAudioStatus").textContent = "Analizini mistik atmosferde dinle";
    document.getElementById("analysisSpeakButton").disabled = !("speechSynthesis" in window);
    document.getElementById("analysisPauseButton").disabled = true;
    document.getElementById("analysisStopButton").disabled = true;
}

let lunaraUtterance = null;
let lunaraSpeechActive = false;
let lunaraAudioContext = null;
let lunaraAmbientMaster = null;
let lunaraAmbientNodes = [];

function startLunaraAmbient() {
    if (!document.getElementById("analysisMusicToggle").checked) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
        document.getElementById("lunaraAudioStatus").textContent = "Tarayıcı arka plan müziğini desteklemiyor.";
        return;
    }
    if (!lunaraAudioContext) {
        lunaraAudioContext = new AudioContextClass();
        lunaraAmbientMaster = lunaraAudioContext.createGain();
        lunaraAmbientMaster.gain.value = 0;
        lunaraAmbientMaster.connect(lunaraAudioContext.destination);

        // Telifsiz, tarayıcı içinde üretilen yumuşak kozmik ambient katmanları.
        [110, 164.81, 220].forEach((frequency, index) => {
            const oscillator = lunaraAudioContext.createOscillator();
            const layerGain = lunaraAudioContext.createGain();
            const filter = lunaraAudioContext.createBiquadFilter();
            oscillator.type = "sine";
            oscillator.frequency.value = frequency;
            oscillator.detune.value = index === 1 ? -5 : index === 2 ? 4 : 0;
            filter.type = "lowpass";
            filter.frequency.value = 520;
            layerGain.gain.value = index === 0 ? 0.42 : index === 1 ? 0.25 : 0.12;
            oscillator.connect(filter);
            filter.connect(layerGain);
            layerGain.connect(lunaraAmbientMaster);
            oscillator.start();
            lunaraAmbientNodes.push(oscillator);
        });
    }
    lunaraAudioContext.resume();
    const volume = Number(document.getElementById("analysisMusicVolume").value);
    lunaraAmbientMaster.gain.setTargetAtTime(volume, lunaraAudioContext.currentTime, 1.8);
}

function stopLunaraAmbient() {
    if (!lunaraAudioContext || !lunaraAmbientMaster) return;
    lunaraAmbientMaster.gain.setTargetAtTime(0, lunaraAudioContext.currentTime, 0.35);
}

function stopLunaraAudio() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    lunaraUtterance = null;
    lunaraSpeechActive = false;
    stopLunaraAmbient();
    const pauseButton = document.getElementById("analysisPauseButton");
    const stopButton = document.getElementById("analysisStopButton");
    const status = document.getElementById("lunaraAudioStatus");
    if (pauseButton) {
        pauseButton.disabled = true;
        pauseButton.textContent = "Duraklat";
    }
    if (stopButton) stopButton.disabled = true;
    if (status) status.textContent = "Sesli okuma durduruldu.";
}

function playLunaraAnalysis() {
    if (!("speechSynthesis" in window)) {
        showMessage("Tarayıcınız Türkçe sesli okumayı desteklemiyor.");
        return;
    }
    const text = document.getElementById("analysisResultContent").textContent.trim();
    if (!text) return;
    if (window.speechSynthesis.paused && lunaraUtterance) {
        window.speechSynthesis.resume();
        startLunaraAmbient();
        document.getElementById("lunaraAudioStatus").textContent = "Sesli analiz devam ediyor…";
        document.getElementById("analysisPauseButton").textContent = "Duraklat";
        return;
    }

    window.speechSynthesis.cancel();
    lunaraUtterance = new SpeechSynthesisUtterance(text);
    lunaraUtterance.lang = "tr-TR";
    lunaraUtterance.rate = 0.94;
    lunaraUtterance.pitch = 1;
    lunaraUtterance.volume = Number(document.getElementById("analysisSpeechVolume").value);
    const voices = window.speechSynthesis.getVoices();
    const turkishVoice = voices.find(voice => voice.lang && voice.lang.toLowerCase().startsWith("tr"));
    if (turkishVoice) lunaraUtterance.voice = turkishVoice;
    lunaraUtterance.onstart = () => {
        lunaraSpeechActive = true;
        document.getElementById("lunaraAudioStatus").textContent = "Analizin seslendiriliyor…";
        document.getElementById("analysisPauseButton").disabled = false;
        document.getElementById("analysisStopButton").disabled = false;
        document.getElementById("analysisPauseButton").textContent = "Duraklat";
    };
    lunaraUtterance.onend = () => {
        lunaraSpeechActive = false;
        stopLunaraAmbient();
        document.getElementById("lunaraAudioStatus").textContent = "Sesli analiz tamamlandı.";
        document.getElementById("analysisPauseButton").disabled = true;
        document.getElementById("analysisStopButton").disabled = true;
    };
    lunaraUtterance.onerror = event => {
        if (event.error === "canceled" || event.error === "interrupted") return;
        lunaraSpeechActive = false;
        stopLunaraAmbient();
        document.getElementById("lunaraAudioStatus").textContent = "Seslendirme başlatılamadı.";
    };
    startLunaraAmbient();
    window.speechSynthesis.speak(lunaraUtterance);
}

document.getElementById("analysisSpeakButton").addEventListener("click", playLunaraAnalysis);
document.getElementById("analysisPauseButton").addEventListener("click", () => {
    if (!lunaraSpeechActive) return;
    if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        startLunaraAmbient();
        document.getElementById("analysisPauseButton").textContent = "Duraklat";
        document.getElementById("lunaraAudioStatus").textContent = "Sesli analiz devam ediyor…";
    } else {
        window.speechSynthesis.pause();
        stopLunaraAmbient();
        document.getElementById("analysisPauseButton").textContent = "Devam Et";
        document.getElementById("lunaraAudioStatus").textContent = "Sesli analiz duraklatıldı.";
    }
});
document.getElementById("analysisStopButton").addEventListener("click", stopLunaraAudio);
document.getElementById("analysisMusicToggle").addEventListener("change", event => {
    if (event.target.checked && lunaraSpeechActive) startLunaraAmbient();
    else stopLunaraAmbient();
});
document.getElementById("analysisSpeechVolume").addEventListener("input", event => {
    if (lunaraUtterance) lunaraUtterance.volume = Number(event.target.value);
});
document.getElementById("analysisMusicVolume").addEventListener("input", event => {
    if (lunaraAmbientMaster && lunaraSpeechActive && document.getElementById("analysisMusicToggle").checked) {
        lunaraAmbientMaster.gain.setTargetAtTime(Number(event.target.value), lunaraAudioContext.currentTime, 0.2);
    }
});

document.getElementById("analysisForm").addEventListener("submit", async event => {
    event.preventDefault();
    const type = document.getElementById("analysisType").value;
    const submit = document.getElementById("analysisSubmit");
    let question = "";
    const details = {};
    let imageData = "";

    if (type === "tarot") {
        question = document.getElementById("tarotQuestion").value.trim();
        details.spread = document.getElementById("tarotSpread").value;
    } else if (type === "coffee") {
        question = document.getElementById("coffeeQuestion").value.trim();
        const file = document.getElementById("coffeeImage").files[0];
        if (!file) return showMessage("Lütfen kahve fincanının fotoğrafını seçin.");
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
            return showMessage("Yalnızca JPG, PNG veya WEBP fotoğraf yükleyebilirsiniz.");
        }
        if (file.size > 5 * 1024 * 1024) return showMessage("Fotoğraf en fazla 5 MB olabilir.");
        try { imageData = await fileToDataUrl(file); }
        catch (error) { return showMessage(error.message); }
    } else if (type === "horoscope") {
        details.sign = document.getElementById("horoscopeSign").value;
        details.period = document.getElementById("horoscopePeriod").value;
        question = document.getElementById("horoscopeQuestion").value.trim();
        if (!details.sign) return showMessage("Lütfen burcunu seç.");
    } else {
        details.focus = document.getElementById("personalFocus").value;
        question = document.getElementById("personalQuestion").value.trim();
        if (type !== "general" && !question) {
            return showMessage("Lütfen bu analiz için gerekli bilgileri gir.");
        }
    }

    submit.disabled = true;
    document.getElementById("analysisForm").classList.add("hidden");
    document.getElementById("analysisLoading").classList.remove("hidden");

    try {
        const data = await apiRequest("/api/analyses", {
            method: "POST",
            body: JSON.stringify({ type, question, details, imageData })
        });
        showAnalysisResult(data.analysis);
        await loadAnalysisHistory();
        showMessage(data.message);
    } catch (error) {
        document.getElementById("analysisLoading").classList.add("hidden");
        document.getElementById("analysisForm").classList.remove("hidden");
        showMessage(error.message);
    } finally {
        submit.disabled = false;
    }
});

async function deleteAllAnalysisHistory() {
    if (!analysisHistoryCache.length) {
        showMessage("Silinecek analiz gecmisin bulunmuyor.");
        return;
    }

    const approved = window.confirm("Tum analiz gecmisini silmek istediginize emin misiniz? Bu islem geri alinamaz.");
    if (!approved) return;

    try {
        const data = await apiRequest("/api/analyses", {
            method: "DELETE",
            headers: {}
        });

        showMessage((data.deletedCount || 0) + " analiz silindi.");
        await loadAnalysisHistory();
    } catch (error) {
        showMessage(error.message);
    }
}
async function deleteAnalysisHistory(id) {
    const item = analysisHistoryCache.find(entry => entry.id === id);
    if (!item) return;

    const approved = window.confirm("\"" + item.title + "\" analizini silmek istediginize emin misiniz? Bu islem geri alinamaz.");
    if (!approved) return;

    try {
        await apiRequest("/api/analyses/" + id, {
            method: "DELETE",
            headers: {}
        });

        showMessage("Analiz gecmisinden silindi.");
        await loadAnalysisHistory();
    } catch (error) {
        showMessage(error.message);
    }
}

const deleteAllButton = document.querySelector('[data-action="history-delete-all"]');
if (!deleteAllButton) throw new Error("Tumunu Sil dugmesi bulunamadi.");
deleteAllButton.addEventListener("click", deleteAllAnalysisHistory);

document.getElementById("analysisHistoryList").addEventListener("click", async event => {
    const deleteButton = event.target.closest("[data-delete-history-id]");

    if (deleteButton) {
        const id = Number(deleteButton.dataset.deleteHistoryId);
        if (Number.isSafeInteger(id) && id > 0) {
            await deleteAnalysisHistory(id);
        }
        return;
    }

    const button = event.target.closest("[data-history-id]");
    if (!button) return;

    const item = analysisHistoryCache.find(entry => entry.id === Number(button.dataset.historyId));
    if (item) showAnalysisResult(item);
});

analysisModal.addEventListener("click", event => {
    if (event.target === analysisModal) closeAnalysisModal();
});

authModal.addEventListener("click", (event) => {
    if (event.target === authModal) {
        closeAuth();
    }
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeAuth();
        closeAnalysisModal();
        if (typeof closeAdminPanel === "function") closeAdminPanel();
    }
});

async function checkServer() {
    try {
        const data = await apiRequest("/api/status", {
            method: "GET",
            headers: {}
        });

        console.log("Lunara sunucusu:", data);
    } catch (error) {
        console.error("Sunucu bağlantısı kurulamadı:", error);
    }
}

checkServer();
loadCurrentUser();



// Yönetici paneli: arayüz yalnızca görünürlük sağlar; gerçek yetki sunucudadır.
const adminModal = document.getElementById("adminModal");

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
}

const adminAnalysisCache = new Map();

async function loadAdminPanel() {
    const message = document.getElementById("adminMessage");
    const usersBody = document.getElementById("adminUsersBody");
    const analysesBody = document.getElementById("adminAnalysesBody");
    const statUsers = document.getElementById("statUsers");
    const statAnalyses = document.getElementById("statAnalyses");

    if (message) message.textContent = "Yönetici verileri yükleniyor…";
    if (usersBody) usersBody.innerHTML = '<tr><td colspan="6">Yükleniyor…</td></tr>';
    if (analysesBody) analysesBody.innerHTML = '<tr><td colspan="6">Yükleniyor…</td></tr>';

    const [statsResult, usersResult, analysesResult] = await Promise.allSettled([
        apiRequest("/api/admin/stats", { method: "GET", headers: {} }),
        apiRequest("/api/admin/users", { method: "GET", headers: {} }),
        apiRequest("/api/admin/analyses", { method: "GET", headers: {} })
    ]);

    const errors = [];

    if (statsResult.status === "fulfilled") {
        const stats = statsResult.value.stats || {};
        if (statUsers) statUsers.textContent = stats.totalUsers ?? 0;
        if (statAnalyses) statAnalyses.textContent = stats.totalAnalyses ?? 0;
    } else {
        if (statUsers) statUsers.textContent = "—";
        if (statAnalyses) statAnalyses.textContent = "—";
        errors.push("İstatistikler: " + statsResult.reason.message);
    }

    if (usersResult.status === "fulfilled") {
        const users = usersResult.value.users || [];
        if (usersBody) {
            usersBody.innerHTML = users.map(user => `
                <tr>
                    <td>${user.id}</td>
                    <td>${escapeHtml(user.firstName)} ${escapeHtml(user.lastName)}</td>
                    <td>${escapeHtml(user.email)}</td>
                    <td>${escapeHtml(user.role)}</td>
                    <td>${escapeHtml(user.createdAt)}</td>
                </tr>
            `).join("") || '<tr><td colspan="5">Henüz üye yok.</td></tr>';
        }
    } else {
        if (usersBody) usersBody.innerHTML = '<tr><td colspan="5">' +
            escapeHtml(usersResult.reason.message || "Üye listesi yüklenemedi.") + '</td></tr>';
        errors.push("Üye listesi: " + usersResult.reason.message);
    }

    if (analysesResult.status === "fulfilled") {
        const analyses = analysesResult.value.analyses || [];
        adminAnalysisCache.clear();
        analyses.forEach(item => adminAnalysisCache.set(Number(item.id), item));

        if (analysesBody) {
            analysesBody.innerHTML = analyses.map(item => `
                <tr>
                    <td>${item.id}</td>
                    <td>${escapeHtml(item.first_name)} ${escapeHtml(item.last_name)}<br>${escapeHtml(item.email)}</td>
                    <td>${escapeHtml(item.analysis_type)}</td>
                    <td>${escapeHtml(item.title)}</td>
                    <td>${escapeHtml(item.created_at)}</td>
                    <td><button type="button" class="login-btn" data-admin-analysis-read="${item.id}">Yorumu Oku</button></td>
                </tr>
            `).join("") || '<tr><td colspan="6">Henüz kayıtlı analiz yok.</td></tr>';
        }
    } else {
        if (analysesBody) analysesBody.innerHTML = '<tr><td colspan="6">' +
            escapeHtml(analysesResult.reason.message || "Analizler yüklenemedi.") + '</td></tr>';
        errors.push("Analizler: " + analysesResult.reason.message);
    }

    if (message) message.textContent = errors.length
        ? errors.join(" • ")
        : "Veriler güncellendi.";
    if (errors.some(error => /yetki|yönetici|giriş/i.test(error))) {
        adminModal.classList.add("hidden");
    }
}

function showAdminAnalysis(id) {
    const item = adminAnalysisCache.get(Number(id));
    if (!item) return;

    document.getElementById("adminAnalysisDetailTitle").textContent =
        item.title || "Analiz #" + item.id;
    document.getElementById("adminAnalysisDetailMeta").textContent =
        (item.first_name || "") + " " + (item.last_name || "") +
        " • " + (item.email || "") + " • " + (item.analysis_type || "Analiz") +
        " • " + (item.created_at || "");
    const questionBox = document.getElementById("adminAnalysisDetailQuestion");
    if (questionBox) {
        questionBox.textContent = item.question || "Bu analiz oluşturulurken kullanıcı tarafından ayrı bir soru/not kaydedilmemiş.";
    }
    document.getElementById("adminAnalysisDetailContent").textContent =
        item.content || "Bu analiz kaydında içerik bulunmuyor.";
    document.getElementById("adminAnalysisDetail").classList.remove("hidden");
    document.getElementById("adminAnalysisDetail").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function openAdminPanel() {
    adminModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    loadAdminPanel();
}

function closeAdminPanel() {
    adminModal.classList.add("hidden");
    document.body.style.overflow = "";
}

adminModal.addEventListener("click", event => {
    if (event.target === adminModal) closeAdminPanel();
});

document.addEventListener("click", event => {
    const readButton = event.target.closest("[data-admin-analysis-read]");
    if (readButton) {
        showAdminAnalysis(readButton.dataset.adminAnalysisRead);
        return;
    }
    if (event.target.closest('[data-action="admin-analysis-detail-close"]')) {
        document.getElementById("adminAnalysisDetail")?.classList.add("hidden");
    }
});

// CSP uyumlu tiklama yonetimi

// LUNARA_MEMBER_PANEL_V1
const memberModal = document.getElementById("memberModal");

function memberEscapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;",
        '"': "&quot;", "'": "&#39;"
    })[char]);
}

function memberDate(value) {
    if (!value) return "Tarih yok";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("tr-TR");
}

function closeMemberPanel() {
    memberModal?.classList.add("hidden");
}

async function openMemberPanel() {
    if (!memberModal) return;
    memberModal.classList.remove("hidden");
    await refreshMemberPanel();
}

async function refreshMemberPanel() {
    const historyBox = document.getElementById("memberAnalysisHistoryList");

    if (historyBox) {
        historyBox.innerHTML = '<p class="member-hint">Analizler yukleniyor...</p>';
    }

    try {
        const [profileData, analysisData] = await Promise.all([
            apiRequest("/api/member"),
            apiRequest("/api/analyses")
        ]);

        const user = profileData.user;
        document.getElementById("memberFirstName").value = user.firstName || "";
        document.getElementById("memberLastName").value = user.lastName || "";
        document.getElementById("memberBirthDate").value = user.birthDate || "";
        document.getElementById("memberNewEmail").value = user.email || "";
        document.getElementById("memberBio").value = user.bio || "";
        document.getElementById("memberSummaryEmail").textContent = user.email || "";

        if (typeof updateMemberUI === "function") {
            updateMemberUI(user);
        }

        const analyses = analysisData.analyses || [];
        window.lunaraMemberAnalyses = analyses;

        if (!analyses.length) {
            historyBox.innerHTML = '<p class="member-hint">Henuz kayitli analiziniz bulunmuyor.</p>';
        } else {
            historyBox.innerHTML = analyses.map(item => `
                <div class="member-history-item">
                    <div class="member-history-main">
                        <strong>${memberEscapeHTML(item.title || item.type || "Analiz")}</strong>
                        <span>${memberEscapeHTML(item.type || "Analiz")}  ${memberEscapeHTML(memberDate(item.createdAt))}</span>
                    </div>
                    <div class="member-history-actions">
                        <button type="button" class="login-btn" data-member-analysis-open="${Number(item.id)}">Ac</button>
                        <button type="button" class="member-delete-btn" data-member-analysis-delete="${Number(item.id)}">Sil</button>
                    </div>
                </div>
            `).join("");
        }
    } catch (error) {
        if (historyBox) {
            historyBox.innerHTML = '<p class="member-hint">Panel bilgileri yuklenemedi. Oturumunuzu kontrol edip tekrar deneyin.</p>';
        }
        showMessage(error.message || "Uye paneli yuklenemedi.");
    }
}

document.getElementById("memberProfileForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const status = document.getElementById("memberProfileStatus");
    const payload = {
        firstName: document.getElementById("memberFirstName").value.trim(),
        lastName: document.getElementById("memberLastName").value.trim(),
        birthDate: document.getElementById("memberBirthDate").value,
        bio: document.getElementById("memberBio").value
    };

    try {
        const result = await apiRequest("/api/member/profile", {
            method: "PUT",
            body: JSON.stringify(payload)
        });
        if (typeof updateMemberUI === "function") updateMemberUI(result.user);
        document.getElementById("memberSummaryEmail").textContent = result.user.email;
        status.textContent = result.message || "Profil kaydedildi.";
        showMessage(result.message || "Profil guncellendi.");
    } catch (error) {
        status.textContent = error.message || "Profil kaydedilemedi.";
        showMessage(status.textContent);
    }
});

document.getElementById("memberEmailForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    const status = document.getElementById("memberEmailStatus");
    const email = document.getElementById("memberNewEmail").value.trim();
    const currentPassword = document.getElementById("memberEmailPassword").value;

    try {
        const result = await apiRequest("/api/member/email", {
            method: "PUT",
            body: JSON.stringify({ email, currentPassword })
        });

        document.getElementById("memberNewEmail").value = result.user.email;
        document.getElementById("memberEmailPassword").value = "";
        document.getElementById("memberSummaryEmail").textContent = result.user.email;

        if (typeof updateMemberUI === "function") updateMemberUI(result.user);

        status.textContent = result.message || "E-posta adresiniz degistirildi.";
        showMessage(status.textContent);
    } catch (error) {
        status.textContent = error.message || "E-posta degistirilemedi.";
        showMessage(status.textContent);
    }
});

document.getElementById("memberPasswordForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const status = document.getElementById("memberPasswordStatus");
    const currentPassword = document.getElementById("memberCurrentPassword").value;
    const newPassword = document.getElementById("memberNewPassword").value;
    const confirmPassword = document.getElementById("memberConfirmPassword").value;

    if (newPassword !== confirmPassword) {
        status.textContent = "Yeni sifreler birbiriyle ayni degil.";
        return;
    }

    try {
        const result = await apiRequest("/api/member/password", {
            method: "POST",
            body: JSON.stringify({ currentPassword, newPassword })
        });
        status.textContent = result.message || "Sifre degistirildi.";
        document.getElementById("memberPasswordForm").reset();
        showMessage(result.message || "Sifreniz degistirildi.");
    } catch (error) {
        status.textContent = error.message || "Sifre degistirilemedi.";
        showMessage(status.textContent);
    }
});

document.addEventListener("click", async event => {
    const action = event.target.closest("[data-member-action]");
    if (action) {
        if (action.dataset.memberAction === "open") openMemberPanel();
        if (action.dataset.memberAction === "close") closeMemberPanel();
        if (action.dataset.memberAction === "refresh") refreshMemberPanel();

        if (action.dataset.memberAction === "delete-all") {
            const analyses = window.lunaraMemberAnalyses || [];

            if (!analyses.length) {
                showMessage("Silinecek analiz gecmisiniz bulunmuyor.");
                return;
            }

            if (!window.confirm("Tum analiz gecmisinizi silmek istediginize emin misiniz? Bu islem geri alinamaz.")) {
                return;
            }

            try {
                const result = await apiRequest("/api/analyses", {
                    method: "DELETE"
                });

                showMessage((result.deletedCount || 0) + " analiz silindi.");
                await refreshMemberPanel();
                if (typeof loadAnalysisHistory === "function") {
                    await loadAnalysisHistory();
                }
            } catch (error) {
                showMessage(error.message || "Analiz gecmisi silinemedi.");
            }
        }
    }

    const openAnalysis = event.target.closest("[data-member-analysis-open]");
    if (openAnalysis) {
        const id = Number(openAnalysis.dataset.memberAnalysisOpen);
        const item = (window.lunaraMemberAnalyses || []).find(entry => Number(entry.id) === id);
        if (item && typeof showAnalysisResult === "function") {
            closeMemberPanel();
            showAnalysisResult(item);
            const resultModal = document.getElementById("analysisModal");
            if (resultModal) resultModal.classList.remove("hidden");
            document.body.style.overflow = "hidden";
        }
    }

    const deleteAnalysis = event.target.closest("[data-member-analysis-delete]");
    if (deleteAnalysis) {
        const id = Number(deleteAnalysis.dataset.memberAnalysisDelete);
        if (!Number.isInteger(id) || id < 1) return;
        if (!confirm("Bu analiz gecmis kaydini silmek istiyor musunuz?")) return;

        try {
            await apiRequest("/api/analyses/" + id, { method: "DELETE" });
            showMessage("Analiz gecmisi silindi.");
            await refreshMemberPanel();
            if (typeof loadAnalysisHistory === "function") await loadAnalysisHistory();
        } catch (error) {
            showMessage(error.message || "Analiz silinemedi.");
        }
    }
});

memberModal?.addEventListener("click", event => {
    if (event.target === memberModal) closeMemberPanel();
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeMemberPanel();
});


document.addEventListener("click", (event) => {
    const element = event.target.closest("[data-action], [data-feature]");
    if (!element) return;

    if (element.dataset.feature) {
        openFeature(element.dataset.feature);
        return;
    }

    switch (element.dataset.action) {
        case "auth":
            openAuth(element.dataset.authMode);
            break;

        case "logout":
            logout();
            break;

        case "close-auth":
            closeAuth();
            break;

        case "switch-auth":
            switchAuth(element.dataset.authMode);
            break;

        case "forgot-password":
            switchAuth("forgot");
            break;

        case "back-to-login":
            switchAuth("login");
            break;

        case "admin-open":
            openAdminPanel();
            break;

        case "admin-close":
            closeAdminPanel();
            break;

        case "admin-refresh":
            loadAdminPanel();
            break;

        case "analysis-close":
            closeAnalysisModal();
            break;

        case "analysis-new":
            stopLunaraAudio();
            document.getElementById("analysisResult").classList.add("hidden");
            document.getElementById("analysisForm").classList.remove("hidden");
            break;

        case "history-refresh":
            loadAnalysisHistory();
            break;
    }
});



// E-posta bağlantısından gelen tek kullanımlık tokenı al.
(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("resetToken");

    if (token) {
        pendingResetToken = token;
        window.history.replaceState(
            null,
            "",
            window.location.pathname + window.location.hash
        );
        openAuth("reset");
    }
})();
