import streamlit as st
import streamlit.components.v1 as components

# --- SAYFA AYARLARI ---
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
    st.markdown("### ✨ Günün Mistik Enerjisi")
    st.info("🃏 **Günün Kartı: Güneş** - Neşe, başarı ve netlik dolu bir enerji seni sarıyor.")
    st.markdown("<br>" * 4, unsafe_allow_html=True)
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
    col1, col2, col3, col4 = st.columns(4)
    with col1: st.button("✨ Günlük Fal Yorumu", use_container_width=True)
    with col2: st.button("❤️ Aşk & Uyum", use_container_width=True)
    with col3: st.button("💼 Kariyer & Gelecek", use_container_width=True)
    with col4: st.button("🪐 Günün Burç Enerjisi", use_container_width=True)
    
    st.markdown("<br>", unsafe_allow_html=True)

    # --- SOHBET GEÇMİŞİ İLK ATAMA ---
    if "messages" not in st.session_state or len(st.session_state.messages) == 0:
        st.session_state.messages = [
            {
                "role": "assistant",
                "content": "Hoş geldin ruh dostum. Ben Lunara. Yıldızların fısıltıları, kartların gizemi ve evrenin sırlarıyla sana rehberlik etmek için buradayım."
            }
        ]

    # --- MESAJLARI EKRANA YAZDIRMA ---
    for message in st.session_state.messages:
        with st.chat_message(message["role"]):
            st.write(message["content"])

    st.markdown("---")

    # --- MODEL SEÇİMİ VE MİKROFON ALANI ---
    col_mic, col_model = st.columns([1, 2])

    with col_model:
        selected_model = st.selectbox(
            "Yapay Zeka Modeli Seçin:",
            options=[
                "1. 3.5 Flash-Lite (En hızlı yanıtlar)",
                "2. 3.6 Flash (Kapsamlı yardım)",
                "3. 3.1 Pro (Gelişmiş akıl yürütme)",
                "4. Genişletilmiş düşünme (Karmaşık sorunları çözme)"
            ],
            index=1
        )

    with col_mic:
        st.write("🎙️ **Sesli Yazma (Mikrofon):**")
        # Tarayıcı İçi HTML/JS Ses Tanıma Bileşeni
        components.html(
            """
            <div style="display:flex; align-items:center; gap:10px; font-family:sans-serif;">
                <button id="micBtn" style="background-color:#e8bd47; border:none; color:black; padding:8px 16px; border-radius:8px; font-weight:bold; cursor:pointer;">
                    🎙️ Konuşmaya Başla
                </button>
                <span id="status" style="color:#aaa; font-size:12px;"></span>
            </div>
            <script>
                const btn = document.getElementById('micBtn');
                const status = document.getElementById('status');
                
                if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
                    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                    const recognition = new SpeechRecognition();
                    recognition.lang = 'tr-TR';
                    recognition.continuous = false;

                    btn.onclick = () => {
                        recognition.start();
                        status.innerText = "Dinleniyor...";
                        btn.style.backgroundColor = "#ff4b4b";
                    };

                    recognition.onresult = (event) => {
                        const text = event.results[0][0].transcript;
                        status.innerText = "Algılandı!";
                        btn.style.backgroundColor = "#e8bd47";
                        
                        // Streamlit Input Kutusu Bul ve Metni Yazdır
                        const inputs = window.parent.document.querySelectorAll('textarea[data-testid="stChatInputTextArea"]');
                        if (inputs.length > 0) {
                            inputs[0].value = text;
                            inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
                        }
                    };

                    recognition.onerror = () => {
                        status.innerText = "Hata oluştu!";
                        btn.style.backgroundColor = "#e8bd47";
                    };

                    recognition.onend = () => {
                        btn.style.backgroundColor = "#e8bd47";
                    };
                } else {
                    status.innerText = "Tarayıcınız ses tanımayı desteklemiyor.";
                }
            </script>
            """,
            height=50
        )

    # --- SOHBET GİRİŞ KUTUSU ---
    if prompt := st.chat_input("Fal, tarot veya burçlar hakkında bir şey sorun..."):
        # Kullanıcı mesajını ekle
        st.session_state.messages.append({"role": "user", "content": prompt})
        with st.chat_message("user"):
            st.write(prompt)

        # Yapay Zeka Yanıtı
        ai_response = f"[{selected_model.split(' ')[1]}] Yıldızlar '{prompt}' sorunuz hakkında derin bir mesaj veriyor..."
        st.session_state.messages.append({"role": "assistant", "content": ai_response})
        
        with st.chat_message("assistant"):
            st.write(ai_response)
