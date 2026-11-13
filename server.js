
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

const userColumns = db.prepare("PRAGMA table_info(users)").all();
if (!userColumns.some(column => column.name === "bio")) {
    db.exec("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
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

const ANALYSIS_TYPES = {
    tarot: { title: "Tarot Falı" },
    coffee: { title: "Kahve Falı" },
    horoscope: { title: "Burç Yorumu" },
    personal: { title: "Kişisel Analiz" }
};

async function generateGeminiAnalysis(prompt, image) {
    if (!GEMINI_API_KEY) {
        const error = new Error("Gemini API anahtarı sunucuda tanımlı değil. .env dosyasını kontrol edin.");
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": GEMINI_API_KEY
                },
                body: JSON.stringify({
                    systemInstruction: {
                        parts: [{
                            text: "Sen Lunara AI adlı Türkçe spiritüel keşif platformunun deneyimli, dikkatli ve yaratıcı yorumcususun. Daima Türkçe yanıt ver. Üslubun zarif, mistik, empatik ama ölçülü olsun. Yanıtları başlıklarla, anlaşılır ve ayrıntılı yaz. Tarot, kahve falı ve astrolojiyi sembolik/eğlence amaçlı yorumla; kesin gelecek iddiasında bulunma. Sağlık, hukuk, finans gibi önemli konularda kesin tavsiye verme. Kullanıcıyı korkutma, bağımlı kılma veya kesin sonuç vaat etme. Görselde seçilemeyen ayrıntıları uydurma; belirsizliği açıkça belirt."
                        }]
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
            console.error("Gemini API yanıtı:", response.status, result?.error?.message || "Bilinmeyen hata");
            const error = new Error(
                response.status === 429
                    ? "Gemini kullanım sınırına ulaşıldı. Biraz sonra tekrar deneyin."
                    : response.status === 400
                        ? "Gemini isteği kabul etmedi. Girdi bilgilerini kontrol edin."
                        : "AI analiz servisine şu anda ulaşılamıyor."
            );
            error.status = response.status === 429 ? 429 : 502;
            throw error;
        }

        const text = result?.candidates?.[0]?.content?.parts
            ?.map(part => part.text || "")
            .join("\\n")
            .trim();

        if (!text) {
            throw new Error("AI bu analiz için yanıt oluşturamadı. Lütfen tekrar deneyin.");
        }

        return text;
    } catch (error) {
        if (error.name === "AbortError") {
            const timeoutError = new Error("Analiz zaman aşımına uğradı. Lütfen tekrar deneyin.");
            timeoutError.status = 504;
            throw timeoutError;
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
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

    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            message: "Yönetici girişi gereklidir."
        });
    }

    const user = db.prepare("SELECT id, role FROM users WHERE id = ?")
        .get(req.session.userId);

    if (!user || user.role !== "admin") {
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

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({
                success: false,
                message: "E-posta veya şifre hatalı."
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

app.get("/api/member", requireLogin, (req, res) => {
    const user = db.prepare(`
        SELECT id, first_name, last_name, birth_date, email, bio,
               credits, role, created_at
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
        if (type === "tarot") {
            const spread = String(details.spread || "three").slice(0, 20);
            const spreadName = ({ one: "Tek kart", three: "Üç kart (geçmiş-şimdi-olasılık)", love: "Aşk açılımı", celtic: "Kelt haçı" })[spread] || "Üç kart";
            prompt = `Lunara üyesi için ${spreadName} tarot açılımı hazırla. Kartları sembolik olarak sen seç. Her kartın adını, temel sembolizmini ve soruyla bağlantısını açıkla. Sonunda genel tema, üzerinde düşünebileceği noktalar ve olumlu/gerçekçi bir kapanış ver. Kullanıcının sorusu: ${question || "Genel yaşam yolculuğu"}`;
        } else if (type === "coffee") {
            prompt = `Bu fotoğraftaki Türk kahvesi fincanı ve telve izlerini dikkatle incele. Görülebilen şekilleri, fincanın bölümlerini ve sembolik çağrışımlarını birbirinden ayır. En az 4 başlıkla (genel enerji, yakın dönem, ilişkiler, iş/kişisel hedefler) ayrıntılı ama eğlence amaçlı bir kahve falı yorumu yaz. Görselde net olmayan şeyi kesinmiş gibi söyleme. Kullanıcının ek notu: ${question || "Ek not yok"}`;
        } else if (type === "horoscope") {
            const sign = String(details.sign || "").slice(0, 30);
            const period = String(details.period || "daily");
            const periodName = ({ daily: "günlük", weekly: "haftalık", monthly: "aylık" })[period] || "günlük";
            if (!["Koç","Boğa","İkizler","Yengeç","Aslan","Başak","Terazi","Akrep","Yay","Oğlak","Kova","Balık"].includes(sign)) {
                return res.status(400).json({ success: false, message: "Lütfen geçerli bir burç seçin." });
            }
            prompt = `${sign} burcu için ${periodName} astrolojik sembolizm yorumu yaz. Aşk/ilişkiler, iş/üretkenlik, kişisel denge ve günün/haftanın/ayın önerisi başlıklarını kullan. Gerçek zamanlı gezegen konumlarına erişimin olmadığını varsay; belirli transit veya olay uydurma. Yorumu genel ve sembolik tut. Kullanıcının sorusu/notu: ${question || "Genel yorum"}`;
        } else {
            const focus = String(details.focus || "Genel yaşam").slice(0, 80);
            prompt = `Kullanıcı için ${focus} odağında kapsamlı bir kişisel farkındalık analizi yaz. Güçlü yönler, zorlanma alanları, ilişkiler/iletişim, hedefler ve uygulanabilir küçük adımlar başlıklarını kullan. Kullanıcıyı tanımadığın özellikleri kesin gerçek gibi sunma; yorumlarını kullanıcının verdiği bilgilerle sınırla. Kullanıcının paylaştığı bilgi ve sorusu: ${question || "Kendimi daha iyi tanımak istiyorum."}`;
        }

        const content = await generateGeminiAnalysis(prompt, image);

const result = db.prepare(`
    INSERT INTO analyses (user_id, analysis_type, title, content, credits_spent)
    VALUES (?, ?, ?, ?, 0)
`).run(req.session.userId, type, config.title, content);

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
        SELECT a.id, a.user_id, a.analysis_type, a.title,
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
