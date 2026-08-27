import streamlit as st

# Sayfa Yapılandırması
st.set_page_config(
    page_title="Lunara.ai | Mistik Rehber",
    page_icon="🌙",
    layout="wide"
)

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
    
    # Hızlı Butonlar (4'lü Yan Yana Yapı)
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.button("✨ Günlük Fal Yorumu", use_container_width=True)
    with col2:
        st.button("❤️ Aşk & Uyum", use_container_width=True)
    with col3:
        st.button("💼 Kariyer & Gelecek", use_container_width=True)
    with col4:
        st.button("🪐 Günün Burç Enerjisi", use_container_width=True)
    
    st.markdown("<br>", unsafe_allow_html=True)

    # Sohbet Geçmişi Başlatma
    if "messages" not in st.session_state or len(st.session_state.messages) == 0:
        st.session_state.messages = [
            {
                "role": "assistant",
                "content": "Hoş geldin ruh dostum. Ben Lunara. Yıldızların fısıltıları, kartların gizemi ve evrenin sırlarıyla sana rehberlik etmek için buradayım."
            }
        ]

    # Mesajları Ekrana Yazdırma
    for message in st.session_state.messages:
        with st.chat_message(message["role"]):
            st.write(message["content"])

    # Kullanıcı Mesaj Giriş Kutusu
    if prompt := st.chat_input("Fal, tarot veya burçlar hakkında bir şey sorun..."):
        # Kullanıcı mesajını kaydet ve göster
        st.session_state.messages.append({"role": "user", "content": prompt})
        with st.chat_message("user"):
            st.write(prompt)

        # Yapay Zeka Yanıtı (Örnek Yanıt)
        response = f"Yıldızlar '{prompt}' sorunuz hakkında derin bir mesaj veriyor..."
        st.session_state.messages.append({"role": "assistant", "content": response})
        with st.chat_message("assistant"):
            st.write(response)