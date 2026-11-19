
require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");

const app = express();
app.set("trust proxy", 1);
const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
    console.error("HATA: .env dosyasinda en az 32 karakterlik SESSION_SECRET gerekli.");
    process.exit(1);
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

const GMAIL_USER = process.env.GMAIL_USER || "";
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s/g, "");
const APP_BASE_URL = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

let mailTransporter = null;
if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    mailTransporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: GMAIL_USER,
            pass: GMAIL_APP_PASSWORD
        }
    });
}
console.log('[GEMINI KONTROL]', GEMINI_API_KEY.trim() ? 'ANAHTAR YUKLENDI' : 'ANAHTAR YOK');

const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "lunara.sqlite"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        birth_date TEXT NOT NULL,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        credits INTEGER NOT NULL DEFAULT 20,
        role TEXT NOT NULL DEFAULT 'member',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS credit_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_password_reset_user
    ON password_reset_tokens(user_id, expires_at);

    CREATE INDEX IF NOT EXISTS idx_credit_user
    ON credit_transactions(user_id);

    CREATE INDEX IF NOT EXISTS idx_sessions_expiry
    ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        analysis_type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        credits_spent INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_analyses_user_created
    ON analyses(user_id, created_at);

    CREATE TABLE IF NOT EXISTS admin_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_user_id INTEGER NOT NULL,
        target_user_id INTEGER,
        action TEXT NOT NULL,
        details TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (admin_user_id) REFERENCES users(id),
        FOREIGN KEY (target_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_admin_audit_created
    ON admin_audit(created_at);
`);

const analysisColumns = db.prepare("PRAGMA table_info(analyses)").all();
if (!analysisColumns.some(column => column.name === "question")) {
    db.exec("ALTER TABLE analyses ADD COLUMN question TEXT NOT NULL DEFAULT ''");
}
const userColumns = db.prepare("PRAGMA table_info(users)").all();
if (!userColumns.some(column => column.name === "bio")) {
    db.exec("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
}
if (!userColumns.some(column => column.name === "status")) {
    db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
}

class SQLiteSessionStore extends session.Store {
    get(sid, callback) {
        try {
            const row = db.prepare(
                "SELECT sess, expires_at FROM sessions WHERE sid = ?"
            ).get(sid);

            if (!row) return callback(null, null);

            if (row.expires_at <= Date.now()) {
                db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
                return callback(null, null);
            }

            callback(null, JSON.parse(row.sess));
        } catch (error) {
            callback(error);
        }
    }

    set(sid, sess, callback = () => {}) {
        try {
            const expiresAt = sess.cookie && sess.cookie.expires
                ? new Date(sess.cookie.expires).getTime()
                : Date.now() + 7 * 24 * 60 * 60 * 1000;

            db.prepare(`
                INSERT INTO sessions (sid, sess, expires_at)
                VALUES (?, ?, ?)
                ON CONFLICT(sid) DO UPDATE SET
                    sess = excluded.sess,
                    expires_at = excluded.expires_at
            `).run(sid, JSON.stringify(sess), expiresAt);

            callback(null);
        } catch (error) {
            callback(error);
        }
    }

    destroy(sid, callback = () => {}) {
        try {
            db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
            callback(null);
        } catch (error) {
            callback(error);
        }
    }

    touch(sid, sess, callback = () => {}) {
        this.set(sid, sess, callback);
    }
}

db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());

app.disable("x-powered-by");

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"]
        }
    },
    strictTransportSecurity: IS_PRODUCTION ? undefined : false
}));

app.use(express.json({ limit: "8mb" }));

app.use(session({
    name: "lunara.sid",
    secret: SESSION_SECRET,
    store: new SQLiteSessionStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        httpOnly: true,
        secure: IS_PRODUCTION,
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000
    }
}));

app.use(express.static(path.join(__dirname, "public")));

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, message: "Çok fazla kayıt denemesi. Daha sonra tekrar deneyin." }
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, message: "Çok fazla giriş denemesi. Bir süre sonra tekrar deneyin." }
});

const forgotPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 3,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        success: false,
        message: "Çok fazla sıfırlama isteği. Bir süre sonra tekrar deneyin."
    }
});

const contactLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        success: false,
        message: "Çok fazla mesaj gönderdiniz. Lütfen bir saat sonra tekrar deneyin."
    }
});

const resetPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        success: false,
        message: "Çok fazla şifre sıfırlama denemesi. Daha sonra tekrar deneyin."
    }
});

const analysisLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 12,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, message: "Saatlik analiz sınırına ulaştınız. Daha sonra tekrar deneyin." }
});

const { calculateNumerology, validateBirthDate } = require("./lib/numerology");

const ANALYSIS_TYPES = {
    tarot: { title: "Tarot Falı" },
    coffee: { title: "Kahve Falı" },
    horoscope: { title: "Burç Yorumu" },
    numerology: { title: "Numeroloji Analizi" },
    love: { title: "Aşk ve İlişki Analizi" },
    personal: { title: "Kişisel Analiz" },\n    generalfortune: { title: "Genel Fal" },\n    birthchart: { title: "Doğum Haritası" }
};

async function generateGeminiAnalysis(prompt, image) {
    if (!GEMINI_API_KEY) {
        const error = new Error("AI analiz servisi yapılandırılmamış. Lütfen daha sonra tekrar deneyin.");
        error.status = 503;
        throw error;
    }

    const parts = [{ text: prompt }];
    if (image) {
        parts.push({
            inlineData: {
                mimeType: image.mimeType,
                data: image.data
            }
        });
    }

    const configuredFallbacks = String(process.env.GEMINI_FALLBACK_MODELS || "gemini-3.1-flash-lite")
        .split(",")
        .map(model => model.trim())
        .filter(Boolean);
    const modelCandidates = [...new Set([GEMINI_MODEL, ...configuredFallbacks].filter(Boolean))];
    const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);
    const timeoutMs = 30000;
    let lastFailure = null;

    const systemInstruction = "Sen Lunara adlı premium Türkçe spiritüel keşif platformunun deneyimli içerik ve yorum asistanısın. Daima akıcı, özenli ve doğal Türkçe kullan. Marka sesin zarif, gizemli, profesyonel, güven veren ve ölçülüdür; kullanıcıya değer veren, küçümsemeyen bir hitap benimse. Kendini sıradan bir fal sitesi gibi değil, astroloji, tarot ve spiritüel sembolizmden ilham alan modern bir kişisel keşif deneyimi olarak ifade et. Yanıtları anlamlı başlıklarla, akıcı, zengin ve yeterli ayrıntıyla sun; klişe, laubali, küçümseyici, özür dileyen, deneyimi değersizleştiren veya analizlerin değerini düşüren ifadelerden kaçın. Kullanıcıya doğrudan yorum sun; analiz içine otomatik bilimsel geçerlilik, tanı yöntemi değildir, eğlence amaçlıdır, kesin gelecek bilgisi vermez gibi meta uyarı/disclaimer metinleri ekleme. Lunara'nın premium, zarif, kendinden emin ve mistik marka dilini tüm kategorilerde koru. Sembolleri ve temaları yorumla; geleceğe ilişkin garanti veya değişmez kader iddiasında bulunma. Sağlık, hukuk ve finans gibi önemli konularda kesin yönlendirme veya profesyonel tavsiye verme; gerekiyorsa kısa, bağlama uygun ve küçümsemeyen bir güvenlik sınırı belirt. Kullanıcıyı korkutma, bağımlı kılma veya kesin sonuç vaat etme. Görselde seçilemeyen ayrıntıları uydurma; belirsizliği açıkça belirt.";

    for (let index = 0; index < modelCandidates.length; index++) {
        const model = modelCandidates[index];
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            console.log("[GEMINI] Model deneniyor:", model);

            const response = await fetch(
                "https://generativelanguage.googleapis.com/v1beta/models/" +
                    encodeURIComponent(model) + ":generateContent",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-goog-api-key": GEMINI_API_KEY
                    },
                    body: JSON.stringify({
                        systemInstruction: {
                            parts: [{ text: systemInstruction }]
                        },
                        contents: [{ role: "user", parts }],
                        generationConfig: {
                            maxOutputTokens: 2200
                        }
                    }),
                    signal: controller.signal
                }
            );

            const result = await response.json().catch(() => ({}));

            if (!response.ok) {
                const providerMessage = String(result?.error?.message || "Bilinmeyen sağlayıcı hatası")
                    .replace(/[\r\n]+/g, " ")
                    .slice(0, 240);

                console.error("[GEMINI] Model hatası:", model, "HTTP", response.status, providerMessage);

                const canTryNext = retryableStatuses.has(response.status) ||
                    response.status === 404;
                if (canTryNext && index < modelCandidates.length - 1) {
                    lastFailure = { status: response.status, model };
                    console.warn("[GEMINI] Yedek modele geçiliyor.");
                    continue;
                }

                const error = new Error(
                    response.status === 429
                        ? "AI servisi geçici kullanım sınırına ulaştı. Birkaç dakika sonra tekrar deneyin."
                        : response.status === 400
                            ? "Analiz isteği geçersiz. Girdi bilgilerini kontrol edip tekrar deneyin."
                            : response.status === 401 || response.status === 403
                                ? "AI servisine erişim şu anda yapılandırma nedeniyle başarısız."
                                : response.status === 503 || response.status === 500
                                    ? "AI servisleri şu anda yoğun veya geçici olarak kullanılamıyor. Biraz sonra tekrar deneyin."
                                    : "AI analiz servisi şu anda yanıt veremiyor. Lütfen tekrar deneyin."
                );
                error.status = response.status === 429 ? 429 :
                    response.status === 400 ? 400 :
                    response.status === 503 || response.status === 500 ? 503 : 502;
                throw error;
            }

            const generatedText = result?.candidates?.[0]?.content?.parts
                ?.map(part => typeof part.text === "string" ? part.text : "")
                .filter(Boolean)
                .join("\n")
                .trim();

            if (generatedText) {
                console.log("[GEMINI] Analiz başarıyla üretildi:", model);
                return generatedText;
            }

            lastFailure = { status: 502, model };
            console.warn("[GEMINI] Model boş yanıt döndürdü:", model);
            if (index < modelCandidates.length - 1) {
                continue;
            }
        } catch (error) {
            const timedOut = error.name === "AbortError";
            lastFailure = {
                status: timedOut ? 504 : 502,
                model
            };

            console.error(
                "[GEMINI] İstek başarısız:",
                model,
                timedOut ? "Zaman aşımı" : error.name || "Bağlantı hatası"
            );

            if (error.status) {
                throw error;
            }

            if (index < modelCandidates.length - 1) {
                console.warn("[GEMINI] Bağlantı/yanıt hatası nedeniyle yedek model deneniyor.");
                continue;
            }
        } finally {
            clearTimeout(timeout);
        }
    }

    const unavailable = new Error(
        lastFailure?.status === 504
            ? "AI analizi zamanında yanıt vermedi. Lütfen tekrar deneyin."
            : "Ana ve yedek AI modelleri şu anda yanıt veremiyor. Birkaç dakika sonra tekrar deneyin."
    );
    unavailable.status = lastFailure?.status === 504 ? 504 : 503;
    throw unavailable;
}

function requireSameOrigin(req, res, next) {
    const origin = req.get("origin");

    if (!origin) {
        return res.status(403).json({
            success: false,
            message: "Güvenlik kontrolü başarısız."
        });
    }

    try {
        const originUrl = new URL(origin);
        const expectedOrigin = `${req.protocol}://${req.get("host")}`;

        if (originUrl.origin !== expectedOrigin) {
            return res.status(403).json({
                success: false,
                message: "Geçersiz istek kaynağı."
            });
        }

        next();
    } catch {
        return res.status(403).json({
            success: false,
            message: "Geçersiz istek kaynağı."
        });
    }
}

function requireLogin(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            message: "Bu işlem için giriş yapmalısınız."
        });
    }

    const account = db.prepare("SELECT status FROM users WHERE id = ?").get(req.session.userId);
    if (!account || account.status !== "active") {
        return req.session.destroy(() => {
            res.clearCookie("lunara.sid", { httpOnly: true, secure: IS_PRODUCTION, sameSite: "lax" });
            res.status(403).json({
                success: false,
                code: account?.status === "inactive" ? "ACCOUNT_DISABLED" : "ACCOUNT_UNAVAILABLE",
                message: account?.status === "inactive"
                    ? "Hesabınız geçici olarak devre dışı. Giriş ekranından yeniden etkinleştirebilirsiniz."
                    : "Bu hesap artık kullanılamıyor."
            });
        });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            message: "Yönetici girişi gereklidir."
        });
    }

    const user = db.prepare("SELECT id, role, status FROM users WHERE id = ?")
        .get(req.session.userId);

    if (!user || user.role !== "admin" || user.status !== "active") {
        return res.status(403).json({
            success: false,
            message: "Bu alana erişim yetkiniz yok."
        });
    }

    req.adminUserId = user.id;
    next();
}

function writeAdminAudit(adminId, targetId, action, details) {
    db.prepare(`
        INSERT INTO admin_audit (admin_user_id, target_user_id, action, details)
        VALUES (?, ?, ?, ?)
    `).run(adminId, targetId || null, action, details);
}

function publicUser(user) {
    return {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        birthDate: user.birth_date,
        email: user.email,
        bio: user.bio || "",
        role: user.role,
        status: user.status || "active",
        createdAt: user.created_at
    };
}

function regenerateSession(req, userId) {
    return new Promise((resolve, reject) => {
        req.session.regenerate((error) => {
            if (error) return reject(error);

            req.session.userId = userId;

            req.session.save((saveError) => {
                if (saveError) return reject(saveError);
                resolve();
            });
        });
    });
}

app.get("/api/status", (req, res) => {
    res.json({
        success: true,
        name: "Lunara AI",
        message: "Lunara sunucusu çalışıyor."
    });
});

app.get("/api/auth/me", (req, res) => {
    if (!req.session.userId) {
        return res.json({ success: true, user: null });
    }

    const user = db.prepare(`
        SELECT id, first_name, last_name, birth_date,
               email, bio, role, created_at
        FROM users WHERE id = ?
    `).get(req.session.userId);

    if (!user) {
        return req.session.destroy(() => {
            res.json({ success: true, user: null });
        });
    }

    res.json({
        success: true,
        user: publicUser(user)
    });
});

app.post("/api/auth/register", requireSameOrigin, registerLimiter, async (req, res, next) => {
    try {
        const firstName = String(req.body.firstName || "").trim();
        const lastName = String(req.body.lastName || "").trim();
        const birthDate = String(req.body.birthDate || "").trim();
        const email = String(req.body.email || "").trim().toLowerCase();
        const password = String(req.body.password || "");

        if (firstName.length < 2 || firstName.length > 50) {
            return res.status(400).json({
                success: false,
                message: "Ad en az 2, en fazla 50 karakter olmalıdır."
            });
        }

        if (lastName.length < 2 || lastName.length > 50) {
            return res.status(400).json({
                success: false,
                message: "Soyad en az 2, en fazla 50 karakter olmalıdır."
            });
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) ||
            Number.isNaN(Date.parse(birthDate)) ||
            new Date(birthDate).toISOString().slice(0, 10) !== birthDate ||
            birthDate > new Date().toISOString().slice(0, 10)) {
            return res.status(400).json({
                success: false,
                message: "Geçerli bir doğum tarihi girin."
            });
        }

        if (email.length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({
                success: false,
                message: "Geçerli bir e-posta adresi girin."
            });
        }

        if (password.length < 10 || password.length > 72 ||
            !/[a-z]/.test(password) ||
            !/[A-Z]/.test(password) ||
            !/[0-9]/.test(password)) {
            return res.status(400).json({
                success: false,
                message: "Şifre en az 10 karakter olmalı; büyük harf, küçük harf ve rakam içermelidir."
            });
        }

        const existingUser = db.prepare(
            "SELECT id FROM users WHERE email = ?"
        ).get(email);

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "Bu e-posta adresi zaten kayıtlı."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const createUser = db.transaction(() => {
    const result = db.prepare(`
        INSERT INTO users
        (first_name, last_name, birth_date, email, password_hash, credits)
        VALUES (?, ?, ?, ?, ?, 0)
    `).run(firstName, lastName, birthDate, email, passwordHash);

    return Number(result.lastInsertRowid);
});

        let userId;

        try {
            userId = createUser();
        } catch (error) {
            if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
                return res.status(409).json({
                    success: false,
                    message: "Bu e-posta adresi zaten kayıtlı."
                });
            }
            throw error;
        }

        await regenerateSession(req, userId);

        const user = db.prepare(`
            SELECT id, first_name, last_name, birth_date,
                   email, role, created_at
            FROM users WHERE id = ?
        `).get(userId);

        res.status(201).json({
            success: true,
            message: "Lunara üyeliğiniz oluşturuldu.",
            user: publicUser(user)
        });
    } catch (error) {
        next(error);
    }
});

app.post("/api/auth/login", requireSameOrigin, loginLimiter, async (req, res, next) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const password = String(req.body.password || "");

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "E-posta ve şifre gereklidir."
            });
        }

        const user = db.prepare(
            "SELECT * FROM users WHERE email = ?"
        ).get(email);

        if (!user || user.status === "deleted" ||
            !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({
                success: false,
                message: "E-posta veya şifre hatalı."
            });
        }
        if (user.status === "inactive") {
            return res.status(403).json({
                success: false,
                code: "ACCOUNT_DISABLED",
                accountDisabled: true,
                message: "Hesabınız geçici olarak devre dışı. Yeniden etkinleştirmek için aşağıdaki düğmeyi kullanın."
            });
        }
        await regenerateSession(req, user.id);

        res.json({
            success: true,
            message: "Giriş başarılı.",
            user: publicUser(user)
        });
    } catch (error) {
        next(error);
    }
});


app.post("/api/auth/reactivate", requireSameOrigin, loginLimiter, async (req, res, next) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const password = String(req.body.password || "");
        const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
        if (!user || user.status !== "inactive" || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ success: false, message: "E-posta veya şifre hatalı; hesap yeniden etkinleştirilemedi." });
        }
        db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(user.id);
        await regenerateSession(req, user.id);
        const activeUser = db.prepare(`
            SELECT id, first_name, last_name, birth_date, email, bio, credits, role, created_at, status
            FROM users WHERE id = ?
        `).get(user.id);
        res.json({ success: true, message: "Hesabınız yeniden etkinleştirildi.", user: publicUser(activeUser) });
    } catch (error) { next(error); }
});

app.post("/api/auth/logout", requireSameOrigin, (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            return res.status(500).json({
                success: false,
                message: "Çıkış sırasında bir hata oluştu."
            });
        }

        res.clearCookie("lunara.sid", {
            httpOnly: true,
            secure: IS_PRODUCTION,
            sameSite: "lax"
        });

        res.json({
            success: true,
            message: "Güvenli çıkış yapıldı."
        });
    });
});


function destroyUserSessions(userId) {
    const rows = db.prepare("SELECT sid, sess FROM sessions").all();
    const remove = db.prepare("DELETE FROM sessions WHERE sid = ?");
    for (const row of rows) {
        try { if (Number(JSON.parse(row.sess).userId) === Number(userId)) remove.run(row.sid); }
        catch { /* Invalid session data is ignored. */ }
    }
}
function anonymizeAnalysisText(value, personalValues) {
    let result = String(value || "");
    for (const item of personalValues) {
        const needle = String(item || "").trim();
        if (needle.length < 2) continue;
        const lower = result.toLocaleLowerCase("tr-TR");
        const target = needle.toLocaleLowerCase("tr-TR");
        let cursor = 0, index, output = "";
        while ((index = lower.indexOf(target, cursor)) !== -1) {
            output += result.slice(cursor, index) + "[anonim]";
            cursor = index + needle.length;
        }
        if (cursor) result = output + result.slice(cursor);
    }
    return result.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[anonim e-posta]");
}
app.post("/api/member/deactivate", requireSameOrigin, requireLogin, async (req, res, next) => {
    try {
        const password = String(req.body.password || "");
        const user = db.prepare("SELECT id, password_hash, status FROM users WHERE id = ?").get(req.session.userId);
        if (!user || user.status !== "active" || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ success: false, message: "Mevcut şifreniz hatalı." });
        }
        db.prepare("UPDATE users SET status = 'inactive' WHERE id = ?").run(user.id);
        destroyUserSessions(user.id);
        return req.session.destroy(() => {
            res.clearCookie("lunara.sid", { httpOnly: true, secure: IS_PRODUCTION, sameSite: "lax" });
            res.json({ success: true, message: "Hesabınız geçici olarak devre dışı bırakıldı. Yeniden etkinleştirmek için giriş ekranını kullanabilirsiniz." });
        });
    } catch (error) { next(error); }
});
app.post("/api/member/delete-account", requireSameOrigin, requireLogin, async (req, res, next) => {
    try {
        const password = String(req.body.password || ""), confirmation = String(req.body.confirmation || "");
        const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId);
        if (!user || user.status !== "active" || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ success: false, message: "Mevcut şifreniz hatalı." });
        }
        if (confirmation !== "SIL") return res.status(400).json({ success: false, message: "Kalıcı silme işlemi için SIL onayını yazın." });
        const personalValues = [user.email, user.first_name, user.last_name, `${user.first_name} ${user.last_name}`, user.birth_date, user.bio];
        const randomEmail = `deleted-${user.id}-${crypto.randomBytes(12).toString("hex")}@deleted.invalid`;
        const randomPasswordHash = await bcrypt.hash(crypto.randomBytes(48).toString("hex"), 12);
        const anonymizeAccount = db.transaction(() => {
            const rows = db.prepare("SELECT id, title, question, content FROM analyses WHERE user_id = ?").all(user.id);
            const update = db.prepare("UPDATE analyses SET title = ?, question = ?, content = ? WHERE id = ? AND user_id = ?");
            for (const row of rows) update.run(
                anonymizeAnalysisText(row.title, personalValues),
                anonymizeAnalysisText(row.question, personalValues),
                anonymizeAnalysisText(row.content, personalValues), row.id, user.id
            );
            db.prepare("DELETE FROM credit_transactions WHERE user_id = ?").run(user.id);
            db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(user.id);
            db.prepare(`
                UPDATE users SET first_name = 'Silinmiş', last_name = 'Hesap', birth_date = '1900-01-01',
                    email = ?, password_hash = ?, credits = 0, bio = '', role = 'member', status = 'deleted'
                WHERE id = ?
            `).run(randomEmail, randomPasswordHash, user.id);
        });
        anonymizeAccount();
        destroyUserSessions(user.id);
        return req.session.destroy(() => {
            res.clearCookie("lunara.sid", { httpOnly: true, secure: IS_PRODUCTION, sameSite: "lax" });
            res.json({ success: true, message: "Hesabınız kalıcı olarak silindi. Analiz kayıtları kişisel bilgilerden arındırılarak anonim biçimde korundu." });
        });
    } catch (error) { next(error); }
});

app.get("/api/member", requireLogin, (req, res) => {
    const user = db.prepare(`
        SELECT id, first_name, last_name, birth_date, email, bio,
               credits, role, created_at, status
        FROM users WHERE id = ?
    `).get(req.session.userId);

    if (!user) {
        return res.status(404).json({
            success: false,
            message: "Uye bulunamadi."
        });
    }

    res.json({ success: true, user: publicUser(user) });
});

app.put("/api/member/profile", requireSameOrigin, requireLogin, (req, res) => {
    const firstName = String(req.body.firstName || "").trim();
    const lastName = String(req.body.lastName || "").trim();
    const birthDate = String(req.body.birthDate || "").trim();
    const bio = String(req.body.bio || "").trim();

    if (firstName.length < 2 || firstName.length > 50 ||
        lastName.length < 2 || lastName.length > 50) {
        return res.status(400).json({
            success: false,
            message: "Ad ve soyad 2-50 karakter arasinda olmalidir."
        });
    }

    const parsedDate = new Date(birthDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) ||
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== birthDate) {
        return res.status(400).json({
            success: false,
            message: "Gecerli bir dogum tarihi girin."
        });
    }

    if (bio.length > 1000) {
        return res.status(400).json({
            success: false,
            message: "Biyografi en fazla 1000 karakter olabilir."
        });
    }

    db.prepare(`
        UPDATE users
        SET first_name = ?, last_name = ?, birth_date = ?, bio = ?
        WHERE id = ?
    `).run(firstName, lastName, birthDate, bio, req.session.userId);

    const user = db.prepare(`
        SELECT id, first_name, last_name, birth_date, email, bio,
               credits, role, created_at
        FROM users WHERE id = ?
    `).get(req.session.userId);

    res.json({
        success: true,
        message: "Profil bilgileriniz guncellendi.",
        user: publicUser(user)
    });
});

app.put("/api/member/email", requireSameOrigin, requireLogin, async (req, res, next) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const currentPassword = String(req.body.currentPassword || "");

        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({
                success: false,
                message: "Gecerli bir e-posta adresi girin."
            });
        }

        if (!currentPassword) {
            return res.status(400).json({
                success: false,
                message: "Mevcut sifrenizi girmeniz gerekiyor."
            });
        }

        const user = db.prepare(
            "SELECT * FROM users WHERE id = ?"
        ).get(req.session.userId);

        if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
            return res.status(401).json({
                success: false,
                message: "Mevcut sifreniz hatali."
            });
        }

        const existing = db.prepare(
            "SELECT id FROM users WHERE email = ? AND id != ?"
        ).get(email, req.session.userId);

        if (existing) {
            return res.status(409).json({
                success: false,
                message: "Bu e-posta adresi baska bir uyeye ait."
            });
        }

        db.prepare("UPDATE users SET email = ? WHERE id = ?")
            .run(email, req.session.userId);

        const updatedUser = db.prepare(`
            SELECT id, first_name, last_name, birth_date, email, bio,
                   credits, role, created_at
            FROM users WHERE id = ?
        `).get(req.session.userId);

        return res.json({
            success: true,
            message: "E-posta adresiniz guncellendi.",
            user: publicUser(updatedUser)
        });
    } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
            return res.status(409).json({
                success: false,
                message: "Bu e-posta adresi zaten kullaniliyor."
            });
        }
        next(error);
    }
});

app.post("/api/member/password", requireSameOrigin, requireLogin, async (req, res, next) => {
    try {
        const currentPassword = String(req.body.currentPassword || "");
        const newPassword = String(req.body.newPassword || "");

        if (Buffer.byteLength(newPassword, "utf8") < 10 ||
            Buffer.byteLength(newPassword, "utf8") > 72 ||
            !/[a-z]/.test(newPassword) ||
            !/[A-Z]/.test(newPassword) ||
            !/[0-9]/.test(newPassword)) {
            return res.status(400).json({
                success: false,
                message: "Yeni sifre en az 10 karakter olmali; buyuk harf, kucuk harf ve rakam icermelidir."
            });
        }

        const userId = Number(req.session.userId);
        const user = db.prepare(
            "SELECT password_hash FROM users WHERE id = ?"
        ).get(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Uye bulunamadi."
            });
        }

        const matches = await bcrypt.compare(currentPassword, user.password_hash);
        if (!matches) {
            return res.status(400).json({
                success: false,
                message: "Mevcut sifreniz dogru degil."
            });
        }

        const passwordHash = await bcrypt.hash(newPassword, 12);

        const updatePasswordAndRevokeSessions = db.transaction(() => {
            db.prepare(
                "UPDATE users SET password_hash = ? WHERE id = ?"
            ).run(passwordHash, userId);

            const sessions = db.prepare(
                "SELECT sid, sess FROM sessions"
            ).all();

            const deleteSession = db.prepare(
                "DELETE FROM sessions WHERE sid = ?"
            );

            for (const sessionRow of sessions) {
                try {
                    const sessionData = JSON.parse(sessionRow.sess);
                    if (Number(sessionData.userId) === userId) {
                        deleteSession.run(sessionRow.sid);
                    }
                } catch {
                    /* Bozuk oturum kaydi diger uyelerin oturumlarini etkilemez. */
                }
            }
        });

        updatePasswordAndRevokeSessions();

        return req.session.destroy((error) => {
            res.clearCookie("lunara.sid", {
                httpOnly: true,
                secure: IS_PRODUCTION,
                sameSite: "lax"
            });

            if (error) {
                return res.status(500).json({
                    success: false,
                    message: "Sifreniz degistirildi ancak oturum kapatilirken hata olustu. Yeniden giris yapin."
                });
            }

            return res.json({
                success: true,
                message: "Sifreniz degistirildi. Guvenlik nedeniyle tum oturumlar kapatildi; yeni sifrenizle tekrar giris yapin."
            });
        });
    } catch (error) {
        next(error);
    }
});
app.post("/api/analyses", requireSameOrigin, requireLogin, analysisLimiter, async (req, res, next) => {
    try {
        const type = String(req.body.type || "");
        const config = ANALYSIS_TYPES[type];

        if (!config) {
            return res.status(400).json({ success: false, message: "Geçersiz analiz türü." });
        }

        const question = String(req.body.question || "").trim().slice(0, 1200);
        const details = req.body.details && typeof req.body.details === "object"
            ? req.body.details
            : {};

        let image = null;
        if (type === "coffee") {
            const imageData = String(req.body.imageData || "");
            const match = imageData.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
            if (!match) {
                return res.status(400).json({ success: false, message: "Kahve falı için JPG, PNG veya WEBP fincan fotoğrafı yükleyin." });
            }
            const buffer = Buffer.from(match[2], "base64");
            if (!buffer.length || buffer.length > 5 * 1024 * 1024) {
                return res.status(400).json({ success: false, message: "Fotoğraf en fazla 5 MB olmalıdır." });
            }
            image = { mimeType: match[1], data: buffer.toString("base64") };
        }

        let prompt = "";
        if (type === "numerology") {
            const fullName = String(details.fullName || "").trim().slice(0, 120);
            const birthDate = String(details.birthDate || "");
            const validDate = validateBirthDate(birthDate);
            if (fullName.length < 2 || !validDate) {
                return res.status(400).json({ success: false, message: "Numeroloji için geçerli tam ad ve geçmiş bir doğum tarihi girin." });
            }
            const numbers = calculateNumerology(fullName, birthDate);
            const focus = String(details.focus || "Genel kişisel keşif").slice(0, 80);
            prompt = `Lunara için kapsamlı, kişiye özel ve yapılandırılmış bir numeroloji raporu yaz. Sunucu tarafından hesaplanmış sonuçları, ara değerleri ve bileşik sayı göstergelerini aynen kullan; yeniden hesaplama, değiştirme veya uydurma. Her göstergede hesaplama özeti, sembolik anlam, dengeleyici yön ve kısa düşünme sorusu ver. Karmik borç 13, 14, 16, 19 yalnızca hesaplama verisinde varsa bileşik değer olarak ayrıca açıkla; bunları ceza veya kesin kader olarak sunma. Master 11, 22 ve 33 değerlerini master sayı olarak tanımla. Başlıklar: Genel profil; Yaşam Yolu; Doğum Günü; Kader/İfade; Ruh Arzusu; Kişilik; Kişisel Yıl (hesaplama yılını açık yaz); Karmik Borç göstergeleri; Sayılar Arasındaki Ortak Tema (tekrar, uyum ve gerilimleri dengeli ele al); Odak alanına özel yorum; kişisel keşif önerileri. Rapor boyunca Lunara'nın premium, zarif, kendinden emin ve mistik anlatımını koru. Özür dileyen, deneyimi küçülten, bilimsel geçerliliğe dair otomatik uyarı/notlar, tanı yöntemi gibi ifadeler veya raporun değerini düşüren meta açıklamalar ekleme. Yorumları sembolik perspektifle sun; kullanıcıya yol gösteren, güçlü ve dengeli bir dil kullan. Odak: ${focus}. Doğum tarihi: ${birthDate}. Doğum adı: ${fullName}. Hesaplama yılı: ${numbers.calculationYear}. Veriler: ${JSON.stringify(numbers)}`;
        } else if (type === "love") {
            const loveFocus = String(details.focus || "loveLife");
            const loveFocusMap = {
                loveLife: "Aşk hayatım",
                person: "Aklımdaki kişi",
                relationship: "Mevcut ilişkim",
                past: "Geçmiş ilişkim",
                compatibility: "Aşk uyumu",
                journey: "Aşk yolculuğum"
            };
            if (!Object.hasOwn(loveFocusMap, loveFocus)) {
                return res.status(400).json({ success: false, message: "Geçerli bir aşk analizi kategorisi seçin." });
            }
            const partnerName = String(details.partnerName || "").trim().slice(0, 80);
            const partnerBirthDate = String(details.partnerBirthDate || "");
            if (partnerBirthDate && !validateBirthDate(partnerBirthDate)) {
                return res.status(400).json({ success: false, message: "Diğer kişi için geçerli bir doğum tarihi seçin." });
            }
            const focusPrompts = {
                loveLife: "Kullanıcının aşk hayatını genel perspektifte ele al: duygusal beklentiler, ilişki yaklaşımı, tekrar eden temalar, tanışma ve bağ kurma olasılıklarına yönelik sembolik perspektif. Kesin olay veya zaman iddiası verme.",
                person: "Aklındaki kişiyle ilgili durumu, kullanıcının paylaştığı bağlam üzerinden sembolik olarak ele al: iletişim, belirsizlik, yakınlık, karşılıklı beklentiler ve olası yaklaşımlar. Karşı tarafın zihnini veya duygularını kesin olarak bildiğini iddia etme.",
                relationship: "Mevcut ilişkiyi ele al: iletişim, güven, yakınlık, ortak ihtiyaçlar, çatışma dinamikleri, güçlü yönler ve ilişkiyi besleyebilecek somut adımlar.",
                past: "Geçmiş ilişkiyi ele al: bağın izleri, kapanmamış duygular, öğrenilenler, sınırlar ve ileriye dönük kişisel yön. Yeniden birleşme konusunda kesinlik iddiası verme.",
                compatibility: "İki kişi arasındaki uyumu sembolik ve ilişki odaklı ele al: iletişim, ihtiyaçlar, değerler, yakınlık, tamamlayıcılık ve gerilim alanları. Verilen bilgiler yetersizse bunu belirt; doğum tarihinden kişilik hakkında kesin hüküm üretme.",
                journey: "Kullanıcının aşk yolculuğunu ele al: kendi ilişki yaklaşımı, duygusal ihtiyaçları, sınırlar, yeni başlangıçlara hazırlık ve uygulanabilir farkındalık önerileri."
            };
            prompt = `Lunara için ${loveFocusMap[loveFocus]} başlıklı, kapsamlı ve özgün bir aşk/ilişki analizi hazırla. Kategoriye özgü yönergeler: ${focusPrompts[loveFocus]} En az 4-6 anlamlı başlık, derin sembolik yorum, dengeli değerlendirme ve uygulanabilir önerilerle premium anlatım kullan. Başka kişilerin düşünce veya duygularını kesin gerçek gibi sunma; kader, ayrılık, evlilik veya belirli tarihler hakkında kesin hüküm verme. ${loveFocus === "compatibility" ? "Uyum analizinde verilen diğer kişi adı ve doğum tarihi bilgilerini dikkate al, ancak eksik bilgilerden sonuç uydurma." : ""} Seçilen kategori: ${loveFocusMap[loveFocus]}. Diğer kişi: ${partnerName || "Ad verilmedi"}. Diğer kişinin doğum tarihi: ${partnerBirthDate || "Verilmedi"}. Kullanıcının sorusu: ${question || "Ek soru yok"}.`;
        } else if (type === "tarot") {
            const spread = String(details.spread || "three").slice(0, 20);
            const spreadName = ({ one: "Tek kart", three: "Üç kart (geçmiş-şimdi-olasılık)", love: "Aşk açılımı", celtic: "Kelt haçı" })[spread] || "Üç kart";
            prompt = `Lunara üyesi için ${spreadName} tarot açılımı hazırla. Kartları sembolik olarak sen seç. Her kartın adını, temel sembolizmini ve soruyla bağlantısını ayrıntılı biçimde açıkla. Sonunda genel tema, yorumun öne çıkardığı dinamikler, uygulanabilir düşünme önerileri ve güçlü bir kapanış ver. Lunara'nın premium anlatımını koru; meta disclaimer veya deneyimi küçülten not ekleme. Kullanıcının sorusu: ${question || "Genel yaşam yolculuğu"}`;
        } else if (type === "coffee") {
            prompt = `Bu fotoğraftaki Türk kahvesi fincanı ve telve izlerini dikkatle incele. Görülebilen şekilleri, fincanın bölümlerini ve sembolik çağrışımlarını birbirinden ayır. En az 4 başlıkla (genel enerji, yakın dönem, ilişkiler, iş/kişisel hedefler) Lunara'nın premium, zarif, profesyonel ve gizemli marka diliyle kapsamlı, sembolik bir kahve falı yorumu yaz. Görselde net olmayan ayrıntıları uydurma; ancak yorumu meta uyarılarla veya deneyimi küçülten notlarla kesme. Kullanıcının ek notu: ${question || "Ek not yok"}`;
        } else if (type === "horoscope") {
            const sign = String(details.sign || "").slice(0, 30);
            const period = String(details.period || "daily");
            const periodName = ({ daily: "günlük", weekly: "haftalık", monthly: "aylık" })[period] || "günlük";
            if (!["Koç","Boğa","İkizler","Yengeç","Aslan","Başak","Terazi","Akrep","Yay","Oğlak","Kova","Balık"].includes(sign)) {
                return res.status(400).json({ success: false, message: "Lütfen geçerli bir burç seçin." });
            }
            prompt = `${sign} burcu için ${periodName} astrolojik sembolizm yorumu yaz. Aşk/ilişkiler, iş/üretkenlik, kişisel denge ve günün/haftanın/ayın önerisi başlıklarını kullan. Gerçek zamanlı gezegen konumlarına erişimin olmadığını varsay; belirli transit veya olay uydurma. Yorumu zengin, kişiye hitap eden, premium ve sembolik bir anlatımla sun; otomatik meta disclaimer ekleme. Kullanıcının sorusu/notu: ${question || "Genel yorum"}`;
        } else {
            const focus = String(details.focus || "Genel yaşam").slice(0, 80);
            prompt = `Kullanıcı için ${focus} odağında kapsamlı bir kişisel farkındalık analizi yaz. Güçlü yönler, zorlanma alanları, ilişkiler/iletişim, hedefler ve uygulanabilir küçük adımlar başlıklarını kullan. Kullanıcıyı tanımadığın özellikleri kesin gerçek gibi sunma; yorumlarını kullanıcının verdiği bilgilerle sınırla. Lunara'nın kendinden emin ve premium anlatımını koru, otomatik meta disclaimer ekleme. Kullanıcının paylaştığı bilgi ve sorusu: ${question || "Kendimi daha iyi tanımak istiyorum."}`;
        }

        const content = await generateGeminiAnalysis(prompt, image);

const result = db.prepare(`
    INSERT INTO analyses (user_id, analysis_type, title, question, content, credits_spent)
    VALUES (?, ?, ?, ?, ?, 0)
`).run(req.session.userId, type, config.title, question, content);

        res.json({
    success: true,
    message: "Analiziniz hazır.",
    analysis: {
        id: Number(result.lastInsertRowid),
        type,
        title: config.title,
        content
    }
});
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({ success: false, message: error.message });
        }
        next(error);
    }
});

app.get("/api/analyses", requireLogin, (req, res) => {
    const rows = db.prepare(`
        SELECT id, analysis_type, title, content, created_at
        FROM analyses
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 30
    `).all(req.session.userId);

    res.json({
        success: true,
        analyses: rows.map(row => ({
            id: row.id,
            type: row.analysis_type,
            title: row.title,
            content: row.content,
            createdAt: row.created_at
        }))
    });
});

// YÖNETİCİ API'LERİ: Tüm yetki kontrolleri sunucu tarafında yapılır.

app.delete("/api/analyses/:id", requireSameOrigin, requireLogin, (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: "Gecersiz analiz numarasi." });
    }

    const result = db.prepare("DELETE FROM analyses WHERE id = ? AND user_id = ?").run(id, req.session.userId);

    if (result.changes === 0) {
        return res.status(404).json({ success: false, message: "Analiz bulunamadi veya silme yetkiniz yok." });
    }

    res.json({ success: true, message: "Analiz gecmisinden silindi." });
});


app.delete("/api/analyses", requireSameOrigin, requireLogin, (req, res) => {
    const result = db.prepare("DELETE FROM analyses WHERE user_id = ?").run(req.session.userId);

    res.json({
        success: true,
        deletedCount: result.changes,
        message: "Analiz gecmisi temizlendi."
    });
});

app.get("/api/admin/stats", requireAdmin, (req, res) => {
    const users = db.prepare(`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN role = 'member' THEN 1 ELSE 0 END) AS members,
               SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admins
        FROM users
        WHERE status != 'deleted'
    `).get();

    const analyses = db.prepare("SELECT COUNT(*) AS total FROM analyses").get();

    res.json({
        success: true,
        stats: {
            totalUsers: users.total || 0,
            members: users.members || 0,
            admins: users.admins || 0,
            totalAnalyses: analyses.total || 0
        }
    });
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
    const users = db.prepare(`
        SELECT id, first_name, last_name, email, role, created_at
        FROM users
        WHERE status != 'deleted'
        ORDER BY id DESC
        LIMIT 200
    `).all();

    res.json({
        success: true,
        users: users.map(user => ({
            id: user.id,
            firstName: user.first_name,
            lastName: user.last_name,
            email: user.email,
            role: user.role,
            createdAt: user.created_at
        }))
    });
});

app.get("/api/admin/analyses", requireAdmin, (req, res) => {
    const rows = db.prepare(`
        SELECT a.id, a.user_id, a.analysis_type, a.title, a.question, a.content,
               a.created_at,
               u.first_name, u.last_name, u.email
        FROM analyses a
        JOIN users u ON u.id = a.user_id
        ORDER BY a.id DESC
        LIMIT 100
    `).all();

    res.json({ success: true, analyses: rows });
});

app.get("/api/admin/audit", requireAdmin, (req, res) => {
    const rows = db.prepare(`
        SELECT aa.id, aa.action, aa.details, aa.created_at,
               admin.email AS admin_email,
               target.email AS target_email
        FROM admin_audit aa
        JOIN users admin ON admin.id = aa.admin_user_id
        LEFT JOIN users target ON target.id = aa.target_user_id
        ORDER BY aa.id DESC
        LIMIT 100
    `).all();

    res.json({ success: true, audit: rows });
});

app.post("/api/contact", requireSameOrigin, contactLimiter, async (req, res) => {
    if (!mailTransporter) {
        return res.status(503).json({
            success: false,
            message: "İletişim hizmeti şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin."
        });
    }

    const name = String(req.body?.name || "").replace(/[\r\n]+/g, " ").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const subject = String(req.body?.subject || "").replace(/[\r\n]+/g, " ").trim();
    const message = String(req.body?.message || "").trim();
    const honeypot = String(req.body?.website || "").trim();

    // Bot tuzağı: otomatik doldurulan gizli alan doluysa mesajı kabul edilmiş gibi yanıtla.
    if (honeypot) {
        return res.json({
            success: true,
            message: "Mesajınız alındı. Teşekkür ederiz."
        });
    }

    if (
        name.length < 2 || name.length > 80 ||
        email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        subject.length < 3 || subject.length > 120 ||
        message.length < 10 || message.length > 5000
    ) {
        return res.status(400).json({
            success: false,
            message: "Lütfen tüm alanları doğru doldurun. Mesajınız 10–5000 karakter olmalıdır."
        });
    }

    try {
        await mailTransporter.sendMail({
            from: GMAIL_USER,
            to: "yoldas.isik@gmail.com",
            replyTo: { name, address: email },
            subject: "[Lunara İletişim] " + subject,
            text: [
                "Lunara iletişim formundan yeni mesaj geldi.",
                "",
                "Gönderen: " + name,
                "E-posta: " + email,
                "Konu: " + subject,
                "",
                "Mesaj:",
                message
            ].join("\n")
        });

        return res.json({
            success: true,
            message: "Mesajınız başarıyla gönderildi. En kısa sürede sizinle iletişime geçeceğiz."
        });
    } catch (error) {
        console.error("İletişim mesajı e-postası gönderilemedi.");
        return res.status(503).json({
            success: false,
            message: "Mesaj şu anda gönderilemedi. Lütfen daha sonra tekrar deneyin."
        });
    }
});

app.post("/api/auth/forgot-password", requireSameOrigin, forgotPasswordLimiter, async (req, res) => {
    const genericMessage = "Eğer bu e-posta adresi kayıtlıysa, şifre sıfırlama bağlantısı gönderilecektir.";
    const email = String(req.body?.email || "").trim().toLowerCase();

    if (!mailTransporter) {
        return res.status(503).json({
            success: false,
            message: "E-posta hizmeti şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin."
        });
    }

    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.json({ success: true, message: genericMessage });
    }

    const user = db.prepare(
        "SELECT id, email FROM users WHERE email = ?"
    ).get(email);

    if (!user) {
        return res.json({ success: true, message: genericMessage });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const now = Date.now();
    const expiresAt = now + 30 * 60 * 1000;

    try {
        const saveToken = db.transaction(() => {
            db.prepare(
                "DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL"
            ).run(user.id);

            db.prepare(`
                INSERT INTO password_reset_tokens
                (user_id, token_hash, expires_at, created_at)
                VALUES (?, ?, ?, ?)
            `).run(user.id, tokenHash, expiresAt, now);
        });

        saveToken();

        const resetUrl = new URL("/", APP_BASE_URL);
        resetUrl.searchParams.set("resetToken", token);

        await mailTransporter.sendMail({
            from: GMAIL_USER,
            to: user.email,
            subject: "Lunara - Şifre Sıfırlama",
            text:
                "Lunara hesabınız için şifre sıfırlama talebi aldık. " +
                "Yeni şifrenizi belirlemek için bu bağlantıyı açın: " +
                resetUrl.toString() +
                "\n\nBağlantı 30 dakika geçerlidir. Talebi siz yapmadıysanız bu e-postayı dikkate almayın.",
            html: `
                <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;background:#10091c;color:#f5effb;border:1px solid #55436a;border-radius:12px">
                    <h1 style="color:#d9b66f">☾ LUNARA</h1>
                    <h2>Şifre sıfırlama</h2>
                    <p>Lunara hesabınız için şifre sıfırlama talebi aldık.</p>
                    <p style="margin:28px 0">
                        <a href="${resetUrl.toString()}" style="background:#d9b66f;color:#201426;padding:13px 22px;text-decoration:none;border-radius:6px;font-weight:bold">Yeni Şifre Belirle</a>
                    </p>
                    <p>Bu bağlantı 30 dakika geçerlidir.</p>
                    <p>Bu talebi siz yapmadıysanız e-postayı dikkate almayın.</p>
                </div>
            `
        });

        return res.json({ success: true, message: genericMessage });
    } catch (error) {
        db.prepare(
            "DELETE FROM password_reset_tokens WHERE token_hash = ?"
        ).run(tokenHash);

        console.error("Şifre sıfırlama e-postası gönderilemedi.");
        return res.status(503).json({
            success: false,
            message: "E-posta gönderilemedi. Bir süre sonra tekrar deneyin."
        });
    }
});

app.post("/api/auth/reset-password", requireSameOrigin, resetPasswordLimiter, async (req, res, next) => {
    try {
        const token = String(req.body?.token || "");
        const password = String(req.body?.password || "");

        if (!/^[a-f0-9]{64}$/i.test(token)) {
            return res.status(400).json({
                success: false,
                message: "Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş."
            });
        }

        if (
            password.length < 10 ||
            password.length > 72 ||
            Buffer.byteLength(password, "utf8") > 72 ||
            !/[a-z]/.test(password) ||
            !/[A-Z]/.test(password) ||
            !/[0-9]/.test(password)
        ) {
            return res.status(400).json({
                success: false,
                message: "Şifre en az 10 karakter olmalı; büyük harf, küçük harf ve rakam içermelidir. En fazla 72 bayt kullanılabilir."
            });
        }

        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        const passwordHash = await bcrypt.hash(password, 12);
        const now = Date.now();

        const resetPassword = db.transaction(() => {
            const resetRecord = db.prepare(`
                SELECT user_id
                FROM password_reset_tokens
                WHERE token_hash = ?
                  AND used_at IS NULL
                  AND expires_at > ?
            `).get(tokenHash, now);

            if (!resetRecord) return null;

            db.prepare(
                "UPDATE users SET password_hash = ? WHERE id = ?"
            ).run(passwordHash, resetRecord.user_id);

            db.prepare(`
                UPDATE password_reset_tokens
                SET used_at = ?
                WHERE user_id = ? AND used_at IS NULL
            `).run(now, resetRecord.user_id);

            return Number(resetRecord.user_id);
        });

        const userId = resetPassword();

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş."
            });
        }

        /* Yalnızca şifresi değişen üyeye ait oturumları geçersiz kıl. */
        const sessions = db.prepare(
            "SELECT sid, sess FROM sessions"
        ).all();

        const deleteSession = db.prepare(
            "DELETE FROM sessions WHERE sid = ?"
        );

        const removeUserSessions = db.transaction(() => {
            for (const sessionRow of sessions) {
                try {
                    const sessionData = JSON.parse(sessionRow.sess);
                    if (Number(sessionData.userId) === userId) {
                        deleteSession.run(sessionRow.sid);
                    }
                } catch {
                    /* Bozuk oturum kaydı diğer üyelerin oturumlarını etkilemez. */
                }
            }
        });

        removeUserSessions();

        if (Number(req.session?.userId) === userId) {
            return req.session.destroy((error) => {
                res.clearCookie("lunara.sid", {
                    httpOnly: true,
                    secure: IS_PRODUCTION,
                    sameSite: "lax"
                });

                if (error) {
                    return res.status(500).json({
                        success: false,
                        message: "Şifre değişti ancak oturum kapatılırken hata oluştu. Yeniden giriş yapın."
                    });
                }

                return res.json({
                    success: true,
                    message: "Şifreniz değiştirildi. Yeni şifrenizle giriş yapabilirsiniz."
                });
            });
        }

        return res.json({
            success: true,
            message: "Şifreniz değiştirildi. Yeni şifrenizle giriş yapabilirsiniz."
        });
    } catch (error) {
        next(error);
    }
});

app.use("/api", (req, res) => {
    res.status(404).json({
        success: false,
        message: "API adresi bulunamadı."
    });
});

app.use((error, req, res, next) => {
    console.error("Sunucu hatası:", error.message);

    if (res.headersSent) return next(error);

    const status = error.status || 500;

    res.status(status).json({
        success: false,
        message: status === 400
            ? "Geçersiz istek."
            : "Sunucuda bir hata oluştu."
    });
});

app.listen(PORT, () => {
    console.log("--------------------------------");
    console.log("       LUNARA AI BASLATILDI");
    console.log("--------------------------------");
    console.log(`Web sitesi: http://localhost:${PORT}`);
    console.log("SQLite veritabanı hazır.");
    console.log("Sunucuyu durdurmak için CTRL + C");
});
