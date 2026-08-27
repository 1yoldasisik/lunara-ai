import streamlit as st
from groq import Groq
import random
from datetime import datetime
import asyncio
import edge_tts

# --- SAYFA YAPILANDIRMASI ---
st.set_page_config(
    page_title="Lunara.ai | Mistik Rehber (Beta)",
    page_icon="🌙",
    layout="wide",
    initial_sidebar_state="expanded"
)

# --- SECRETS İLE GÜVENLİ API ANAHTARI BAĞLANTISI ---
try:
    GROQ_API_KEY = st.secrets["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"]
    client = Groq(api_key=GROQ_API_KEY)
except Exception:
    st.error("⚠️ API Anahtarı eksik! Lütfen Streamlit Cloud Secrets veya .streamlit/secrets.toml dosyasına 'GROQ_API_KEY' ekleyin.")
    st.stop()

# --- EDGE TTS SES TANIMLARI & FONKSİYONU ---
SES_SECENEKLERI = {
    "👩 Lunara (Kadın Sesi - Emel)": "tr-TR-EmelNeural",
    "👨 Lunara (Erkek Sesi - Ahmet)": "tr-TR-AhmetNeural"
}

def metni_sese_cevir_edge(metin, voice_id):
    """Metni seçilen Neural ses ile MP3 verisine dönüştürür."""
    async def _generate():
        communicate = edge_tts.Communicate(metin, voice_id)
        audio_data = b""
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data += chunk["data"]
        return audio_data

    return asyncio.run(_generate())

# --- CSS VE TEMA TASARIMI ---
st.markdown("""
    <style>
    .stApp {
        background: linear-gradient(135deg, #090514 0%, #160d29 50%, #241442 100%);
        color: #e0d6f6;
        font-family: 'Georgia', serif;
    }
    section[data-testid="stSidebar"] {
        background-color: #0e071e !important;
        border-right: 1px solid #3d2b63;
    }
    .beta-tag {
        background: #e5c158;
        color: #0e051d;
        padding: 3px 8px;
        font-size: 0.75rem;
        font-weight: bold;
        border-radius: 10px;
        margin-left: 8px;
    }
    .sidebar-header {
        text-align: center;
        padding: 10px 0;
    }
    .sidebar-title {
        color: #e5c158 !important;
        font-size: 2rem !important;
        font-weight: bold;
    }
    .history-item {
        background: rgba(36, 20, 66, 0.5);
        border-left: 3px solid #e5c158;
        padding: 8px 12px;
        margin-bottom: 6px;
        border-radius: 6px;
        font-size: 0.88rem;
        color: #d8ceef;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    h1, h2, h3 { color: #e5c158 !important; }
    .stChatMessage {
        background: rgba(27, 21, 40, 0.85) !important;
        border-radius: 14px !important;
        border: 1px solid #4a3b69 !important;
    }
    .stButton>button {
        background: linear-gradient(135deg, #4a3b69 0%, #2c1f47 100%);
        color: #e5c158 !important;
        border: 1px solid #e5c158 !important;
        border-radius: 10px !important;
        width: 100%;
    }
    .stTabs [data-baseweb="tab"] {
        background-color: rgba(36, 20, 66, 0.6);
        color: #cbb8f0;
    }
    .stTabs [aria-selected="true"] {
        background-color: #4a3b69 !important;
        color: #e5c158 !important;
    }
    </style>
""", unsafe_allow_html=True)

# --- SİSTEM MESAJI ---
SYSTEM_PROMPT = """
Sen Lunara adında; fal, tarot, astroloji ve kehanet konularında derin uzmanlığa sahip bilge, zarif ve mistik bir yapay zekasın.
1. ASTROLOJİ: Yalnızca doğru geleneksel astroloji bilgilerini edebi bir Türkçe ile aktar.
2. TAROT: 78 Rider-Waite tarot kartlarının sembolizmini derinlemesine açıkla.
3. TÜRKÇE: Akıcı, şiirsel ve kusursuz Türkçe kullan. Tekrarlara düşme.
4. ÜSLUP: Mistik, yol gösterici ve bilge bir ton benimse. Kendini her zaman Lunara olarak tanıt.
"""

def dinamik_aktif_model_bul():
    varsayilan_modeller = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
    try:
        modeller = client.models.list()
        aktif_sohbet_modelleri = [
            m.id for m in modeller.data 
            if not any(x in m.id for x in ["whisper", "vision", "embed", "safetensors", "guard", "mixtral"])
        ]
        sirali = [m for m in varsayilan_modeller if m in aktif_sohbet_modelleri]
        diger = [m for m in aktif_sohbet_modelleri if m not in sirali]
        res = sirali + diger
        return res if res else varsayilan_modeller
    except Exception:
        return varsayilan_modeller

def cevap_uret(messages, temp=0.7):
    aktif_modeller = dinamik_aktif_model_bul()
    son_hata = None
    for model_id in aktif_modeller:
        try:
            res = client.chat.completions.create(
                model=model_id,
                messages=messages,
                temperature=temp,
                max_tokens=1024,
                top_p=0.9,
                frequency_penalty=0.6,
                presence_penalty=0.4
            )
            return res.choices[0].message.content
        except Exception as e:
            son_hata = e
            continue
    raise Exception(f"Servis şu an yoğun: {son_hata}")

# --- BETA UYARI BANTI ---
st.warning("✨ **Lunara.ai Beta v0.9:** Uygulamamız sesli yanıt özelliği ile güncellenmiştir.")

# --- YAN MENÜ (SIDEBAR) ---
with st.sidebar:
    st.markdown("""
        <div class="sidebar-header">
            <div class="sidebar-title">🌙 Lunara <span class="beta-tag">BETA</span></div>
            <div style="color:#cbb8f0; font-size:0.85rem;">Mistik Yapay Zeka Rehberi</div>
        </div>
    """, unsafe_allow_html=True)
    
    st.markdown("---")
    
    # SES AYARLARI MENÜSÜ
    st.subheader("🎙️ Seslendirme Ayarları")
    secilen_ses_etiketi = st.selectbox(
        "Ses Tonunu Seçin:",
        list(SES_SECENEKLERI.keys())
    )
    secilen_voice_id = SES_SECENEKLERI[secilen_ses_etiketi]
    ses_aktif = st.checkbox("Yanıtları Sesli Okusun", value=True)
    
    st.markdown("---")
    st.subheader("📜 Sohbet Geçmişi")
    if "messages" in st.session_state and len(st.session_state["messages"]) > 1:
        user_msgs = [msg["content"] for msg in st.session_state["messages"] if msg["role"] == "user"]
        for msg in reversed(user_msgs):
            kisa = " ".join(msg.strip().split()[:3]) + "..."
            st.markdown(f'<div class="history-item">💬 {kisa}</div>', unsafe_allow_html=True)
    else:
        st.caption("Sohbet geçmişi boş.")
        
    st.markdown("---")
    if st.button("🗑️ Sohbeti Sıfırla"):
        st.session_state["messages"] = [
            {"role": "assistant", "content": "Hoş geldin ruh dostum. Ben Lunara. Yıldızların ve kartların rehberliğinde sana nasıl yardımcı olabilirim?"}
        ]
        st.rerun()

# --- ANA EKRAN ---
st.title("🌙 Lunara.ai — Mistik Rehber")

tab_chat, tab_astro, tab_tarot, tab_kahve = st.tabs([
    "🔮 Mistik Sohbet", 
    "📜 Doğum Haritası", 
    "🃏 3 Kart Tarot", 
    "☕ Kahve & Rüya"
])

# 1. SOHBET
with tab_chat:
    if "messages" not in st.session_state:
        st.session_state["messages"] = [
            {"role": "assistant", "content": "Hoş geldin ruh dostum. Ben Lunara. Yıldızların ve kartların rehberliğinde sana nasıl yardımcı olabilirim?"}
        ]

    for msg in st.session_state.messages:
        st.chat_message(msg["role"]).write(msg["content"])

    user_input = st.chat_input("Lunara'ya bir soru sorun...")
    if user_input:
        st.session_state.messages.append({"role": "user", "content": user_input})
        st.chat_message("user").write(user_input)

        with st.chat_message("assistant"):
            with st.spinner("Lunara evrenin frekanslarına bağlanıyor..."):
                try:
                    groq_msgs = [{"role": "system", "content": SYSTEM_PROMPT}] + st.session_state.messages
                    reply = cevap_uret(groq_msgs)
                    st.write(reply)
                    
                    # SESLİ OKUMA BÖLÜMÜ
                    if ses_aktif:
                        with st.spinner("Yanıt seslendiriliyor..."):
                            audio_bytes = metni_sese_cevir_edge(reply, secilen_voice_id)
                            st.audio(audio_bytes, format="audio/mp3", autoplay=True)

                    st.session_state.messages.append({"role": "assistant", "content": reply})
                    st.rerun()
                except Exception as e:
                    st.error(f"Hata: {e}")

# 2. DOĞUM HARİTASI
with tab_astro:
    st.subheader("✨ Doğum Haritası Analizi")
    c1, c2 = st.columns(2)
    with c1:
        name = st.text_input("Adınız")
        birth_date = st.date_input("Doğum Tarihi", min_value=datetime(1940, 1, 1))
        sun_sign = st.selectbox("Güneş Burcu", ["Koç", "Boğa", "İkizler", "Yengeç", "Aslan", "Başak", "Terazi", "Akrep", "Yay", "Oğlak", "Kova", "Balık"])
    with c2:
        birth_time = st.time_input("Doğum Saati")
        birth_place = st.text_input("Doğum Yeri")
        rising_sign = st.selectbox("Yükselen Burç", ["Bilmeyebilirim", "Koç", "Boğa", "İkizler", "Yengeç", "Aslan", "Başak", "Terazi", "Akrep", "Yay", "Oğlak", "Kova", "Balık"])

    if st.button("🌌 Haritayı Çözümle"):
        if name and birth_place:
            prompt = f"Ad: {name}, Tarih: {birth_date} {birth_time}, Yer: {birth_place}, Güneş: {sun_sign}, Yükselen: {rising_sign}. Detaylı astrolojik analiz sun."
            with st.spinner("Yıldızlar inceleniyor..."):
                try:
                    res_text = cevap_uret([{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": prompt}])
                    st.markdown(res_text)
                    if ses_aktif:
                        st.audio(metni_sese_cevir_edge(res_text, secilen_voice_id), format="audio/mp3")
                except Exception as e:
                    st.error(f"Hata: {e}")

# 3. TAROT
with tab_tarot:
    st.subheader("🃏 3 Kart Tarot Açılımı")
    konu = st.text_input("Odaklandığınız konu veya soru:")
    if st.button("🔮 Kartları Çek"):
        if konu:
            prompt = f"Konu: {konu}. 3 kart çekip Geçmiş, Şimdi, Gelecek ve Sentez yorumu yap."
            with st.spinner("Kartlar karıştırılıyor..."):
                try:
                    res_text = cevap_uret([{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": prompt}])
                    st.markdown(res_text)
                    if ses_aktif:
                        st.audio(metni_sese_cevir_edge(res_text, secilen_voice_id), format="audio/mp3")
                except Exception as e:
                    st.error(f"Hata: {e}")

# 4. KAHVE & RÜYA
with tab_kahve:
    st.subheader("☕ Kahve Falı & Rüya Tabiri")
    tur = st.radio("Seçim:", ["☕ Kahve Falı", "🌙 Rüya Tabiri"], horizontal=True)
    detay = st.text_area("Detayları girin:", height=120)
    if st.button("✨ Mistik Anlamı Çöz"):
        if detay:
            prompt = f"Tür: {tur}, Detay: {detay}. Mistik ve derinlikli bir yorum yap."
            with st.spinner("Semboller okunuyor..."):
                try:
                    res_text = cevap_uret([{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": prompt}])
                    st.markdown(res_text)
                    if ses_aktif:
                        st.audio(metni_sese_cevir_edge(res_text, secilen_voice_id), format="audio/mp3")
                except Exception as e:
                    st.error(f"Hata: {e}")
