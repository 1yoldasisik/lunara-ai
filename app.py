import streamlit as st
from groq import Groq

# API Anahtarı Yapılandırması
GROQ_API_KEY = "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"

client = Groq(api_key=GROQ_API_KEY)

st.set_page_config(page_title="Lunara.ai | Mistik Rehber", page_icon="🌙", layout="wide")

# Mistik Tema Tasarımı
st.markdown("""
    <style>
    .stApp { background-color: #0e0b16; color: #e0d6f6; }
    .stChatMessage { background-color: #1b1528; border-radius: 12px; border: 1px solid #4a3b69; margin-bottom: 10px; }
    h1, h2, h3 { color: #d4af37 !important; font-family: 'Georgia', serif; }
    p, label { color: #d8ceef !important; }
    .stButton>button { background-color: #4a3b69; color: #d4af37; border: 1px solid #d4af37; border-radius: 8px; width: 100%; }
    </style>
""", unsafe_allow_html=True)

st.title("🌙 Lunara.ai")
st.caption("Fal, Tarot, Astroloji ve Mistik Rehberiniz")

SYSTEM_PROMPT = """
Sen Lunara adında; fal, tarot, astroloji ve kehanet konularında derin uzmanlığa sahip bilge, zarif ve mistik bir yapay zekasın.

GÖREVLERİN VE SIKI KURALLARIN:
1. ASTROLOJİ: Yalnızca %100 doğru ve geleneksel astroloji bilgilerini kullan. Uydurma terimler veya alakasız semboller ekleme. Burçların elementlerini ve temel niteliklerini eksiksiz ve edebi bir Türkçe ile aktar.
2. TAROT: Yalnızca geleneksel 78 Rider-Waite tarot kartlarını kullan.
3. TÜRKÇE VE DİL KALİTESİ: Akıcı, şiirsel, tekrarsız, kusursuz ve büyüleyici bir Türkçe kullan.
4. ÜSLUP: Mistik, derinlikli ve yol gösterici bir ton benimse. Kendini her zaman Lunara olarak tanıt.
"""

def dinamik_aktif_model_bul():
    """Groq API'den o an aktif olan güncel sohbet modellerini canlı çekip döndürür."""
    try:
        modeller = client.models.list()
        # Görsel/ses/whisper modellerini eleyip metin sohbet modellerini filtresiz listele
        aktif_sohbet_modelleri = [
            m.id for m in modeller.data 
            if not any(x in m.id for x in ["whisper", "vision", "embed", "safetensors"])
        ]
        return aktif_sohbet_modelleri
    except Exception:
        return []

def cevap_uret(messages):
    """Canlı model listesindeki aktif modelleri sırayla dener."""
    aktif_modeller = dinamik_aktif_model_bul()
    
    if not aktif_modeller:
        raise Exception("Groq API'den aktif model listesi çekilemedi. Lütfen API anahtarınızı kontrol edin.")
    
    son_hata = None
    for model_id in aktif_modeller:
        try:
            res = client.chat.completions.create(
                model=model_id,
                messages=messages,
                temperature=0.3
            )
            return res.choices[0].message.content
        except Exception as e:
            son_hata = e
            continue
            
    raise Exception(f"Tüm canlı modeller denenirken hata oluştu: {son_hata}")

tab_chat, tab_astro = st.tabs(["🔮 Mistik Sohbet", "📜 Doğum Haritası Analizi"])

# --- SEKME 1: SOHBET ---
with tab_chat:
    if "messages" not in st.session_state:
        st.session_state["messages"] = [
            {"role": "assistant", "content": "Hoş geldin ruh dostum. Ben Lunara. Yıldızların fısıltıları, kartların gizemi ve evrenin sırlarıyla sana rehberlik etmek için buradayım."}
        ]

    for msg in st.session_state.messages:
        st.chat_message(msg["role"]).write(msg["content"])

    if user_input := st.chat_input("Fal, tarot veya burçlar hakkında bir şey sorun..."):
        st.session_state.messages.append({"role": "user", "content": user_input})
        st.chat_message("user").write(user_input)

        with st.chat_message("assistant"):
            with st.spinner("Lunara evrenin frekanslarına bağlanıyor..."):
                try:
                    groq_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + st.session_state.messages
                    bot_reply = cevap_uret(groq_messages)
                    st.write(bot_reply)
                    st.session_state.messages.append({"role": "assistant", "content": bot_reply})
                except Exception as e:
                    st.error(f"Bağlantı hatası: {e}")

# --- SEKME 2: DOĞUM HARİTASI ---
with tab_astro:
    st.subheader("✨ Kişisel Doğum Haritası Analizi")
    col1, col2 = st.columns(2)
    with col1:
        name = st.text_input("Adınız")
        birth_date = st.date_input("Doğum Tarihiniz")
    with col2:
        birth_time = st.time_input("Doğum Saatiniz")
        birth_place = st.text_input("Doğum Yeriniz")

    sun_sign = st.selectbox("Güneş Burcunuz", ["Bilmeyebilirim", "Koç", "Boğa", "İkizler", "Yengeç", "Aslan", "Başak", "Terazi", "Akrep", "Yay", "Oğlak", "Kova", "Balık"])

    if st.button("Doğum Haritama Bak"):
        if name and birth_place:
            prompt = f"Adı: {name}, Tarih: {birth_date}, Saat: {birth_time}, Yer: {birth_place}, Burç: {sun_sign}. Bu bilgilere göre edebi, derinlikli, eksiksiz ve mistik bir doğum haritası ve kişilik analizi yap."
            with st.spinner("Haritanız çıkarılıyor..."):
                try:
                    res_text = cevap_uret([
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": prompt}
                    ])
                    st.markdown("---")
                    st.write(res_text)
                except Exception as e:
                    st.error(f"Hata oluştu: {e}")
