import os
import streamlit as st
from groq import Groq

# Sayfa Yapılandırması
st.set_page_config(
    page_title="Lunara.ai | Mistik Rehber",
    page_icon="🌙",
    layout="wide"
)

# API Anahtarı Tanımlaması
GROQ_API_KEY = "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"

# Groq API Bağlantısı Güvenli Kontrolü
groq_api_key = GROQ_API_KEY

if not groq_api_key:
    if "GROQ_API_KEY" in os.environ:
        groq_api_key = os.environ["GROQ_API_KEY"]
    else:
        try:
            groq_api_key = st.secrets.get("GROQ_API_KEY")
        except Exception:
            groq_api_key = None

if groq_api_key:
    client = Groq(api_key=groq_api_key)
else:
    client = None

# --- SIDEBAR (SOL PANEL) ---
with st.sidebar:
    st.title("🌙 Lunara.ai")
    st.caption("Astroloji & Kehanet Rehberi")
    
    st.markdown("---")
    
    # Günün Mistik Enerjisi Alanı
    st.markdown("### ✨ Günün Mistik Enerjisi")
    st.info("🃏 **Günün Kartı: Güneş** - Neşe, başarı ve netlik dolu bir enerji seni sarıyor.")
    
    st.markdown("<br>" * 5, unsafe_allow_html=True)
    
    # Sohbet Geçmişini Temizle Butonu
    if st.button("🗑️ Sohbet Geçmişini Temizle", use_container_width=True):
        st.session_state.messages = []
        st.rerun()

# --- ANA EKRAN ---
st.title("🌙 Lunara.ai | Mistik Rehber")
st.caption("Kişiselleştirilmiş Yapay Zeka Fal, Tarot ve Astroloji Danışmanı")

# Sekme Yapısı
tab1, tab2, tab3, tab4 = st.tabs([
    "🔮 Mistik Sohbet", 
    "📜 Doğum Haritası Analizi", 
    "🃏 3 Kart Tarot Açılımı", 
    "☕ Kahve Falı & Rüyalar"
])

with tab1:
    st.markdown("### ✨ Hızlı Mistik Sorular")
    
    # Hızlı Butonlar ve İşlevleri
    prompt_to_send = None
    col1, col2, col3, col4 = st.columns(4)
    
    with col1:
        if st.button("✨ Günlük Fal Yorumu", use_container_width=True):
            prompt_to_send = "Bana bugüne özel genel bir mistik fal yorumu ve rehberlik yapar mısın?"
    with col2:
        if st.button("❤️ Aşk & Uyum", use_container_width=True):
            prompt_to_send = "Aşk hayatım ve ilişkilerdeki enerjim hakkında mistik bir değerlendirme yapar mısın?"
    with col3:
        if st.button("💼 Kariyer & Gelecek", use_container_width=True):
            prompt_to_send = "Kariyerim, maddi durumum ve geleceğimle ilgili yıldızların tavsiyesi nedir?"
    with col4:
        if st.button("🪐 Günün Burç Enerjisi", use_container_width=True):
            prompt_to_send = "Bugünün gökyüzü konumları ve gezegen enerjileri bana nasıl yansıyor?"
    
    st.markdown("<br>", unsafe_allow_html=True)

    # Sohbet Geçmişi Başlatma
    if "messages" not in st.session_state or len(st.session_state.messages) == 0:
        st.session_state.messages = [
            {
                "role": "assistant",
                "content": "Hoş geldin. Ben Lunara. Yıldızların fısıltıları, kartların gizemi ve evrenin sırlarıyla sana rehberlik etmek için buradayım."
            }
        ]

    # Kullanıcı Manuel Giriş Yaparsa Algıla
    if user_chat_input := st.chat_input("Fal, tarot veya burçlar hakkında bir şey sorun..."):
        prompt_to_send = user_chat_input

    # Mesajları Ekrana Yazdırma
    for message in st.session_state.messages:
        with st.chat_message(message["role"]):
            st.write(message["content"])

    # Bir Soru Tetiklendiğinde Çalışacak Alan (Girdi veya Buton)
    if prompt_to_send:
        # Kullanıcı mesajını ekle
        st.session_state.messages.append({"role": "user", "content": prompt_to_send})
        with st.chat_message("user"):
            st.write(prompt_to_send)

        # Groq API ile Cevap Üretme
        if client:
            with st.chat_message("assistant"):
                try:
                    completion = client.chat.completions.create(
                        model="llama-3.3-70b-versatile",
                        messages=[
                            {
                                "role": "system",
                                "content": "Sen Lunara adında bilge, mistik, empatik ve nazik bir tarot/astroloji danışmanısın. Kullanıcılara sıcak ve gizemli bir tonla rehberlik ediyorsun."
                            }
                        ] + [
                            {"role": m["role"], "content": m["content"]}
                            for m in st.session_state.messages
                        ],
                        temperature=0.7,
                        max_tokens=1024,
                    )
                    response = completion.choices[0].message.content
                    st.write(response)
                    st.session_state.messages.append({"role": "assistant", "content": response})
                    st.rerun()
                except Exception as e:
                    st.error(f"Yanıt üretilirken bir hata oluştu: {e}")
        else:
            st.error("API Anahtarı bulunamadı! Lütfen geçerli bir Groq API anahtarı girin.")
