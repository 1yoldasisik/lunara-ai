import os
import streamlit as st
from groq import Groq

# Sayfa Yapılandırması
st.set_page_config(
    page_title="Lunara.ai | Mistik Rehber",
    page_icon="🌙",
    layout="wide"
)

# --- API ANAHTARI YÖNETİMİ ---
GROQ_API_KEY = "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"

groq_api_key = None
try:
    if "GROQ_API_KEY" in st.secrets:
        groq_api_key = st.secrets["GROQ_API_KEY"]
except Exception:
    pass

if not groq_api_key:
    groq_api_key = os.environ.get("GROQ_API_KEY", GROQ_API_KEY)

# Groq İstemcisi Başlatma
if groq_api_key:
    client = Groq(api_key=groq_api_key)
else:
    client = None


def get_active_groq_model(groq_client):
    """
    Groq API üzerindeki güncel ve aktif Llama modellerini sorgular.
    Yayından kalkan modellerde 400 hatası almamak için dinamik seçim yapar.
    """
    priority_models = [
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
        "llama3-70b-8192",
        "llama3-8b-8192"
    ]
    try:
        available_models = [m.id for m in groq_client.models.list().data]
        for pm in priority_models:
            if pm in available_models:
                return pm
        llama_models = [m for m in available_models if "llama" in m.lower()]
        return llama_models[0] if llama_models else available_models[0]
    except Exception:
        return "llama-3.3-70b-versatile"


def send_prompt_to_ai(prompt_text, system_instruction):
    """Merkezi AI Yanıt Üretme ve State Yönetimi"""
    if not client:
        st.error("🔑 API Anahtarı bulunamadı! Lütfen geçerli bir GROQ_API_KEY tanımlayın.")
        return

    st.session_state.messages.append({"role": "user", "content": prompt_text})

    with st.chat_message("assistant"):
        try:
            active_model = get_active_groq_model(client)
            completion = client.chat.completions.create(
                model=active_model,
                messages=[{"role": "system", "content": system_instruction}] + [
                    {"role": m["role"], "content": m["content"]}
                    for m in st.session_state.messages
                ],
                temperature=0.7,
                max_tokens=500  # API limitlerini aşmamak için 500 olarak sabitlendi
            )
            response = completion.choices[0].message.content
            st.session_state.messages.append({"role": "assistant", "content": response})
            st.rerun()
        except Exception as e:
            st.error(f"Yanıt üretilirken bir hata oluştu: {e}")


# --- SIDEBAR (SOL PANEL) ---
with st.sidebar:
    st.title("🌙 Lunara.ai")
    st.caption("Astroloji & Kehanet Rehberi")

    st.markdown("---")
    st.markdown("### ✨ Günün Mistik Enerjisi")
    st.info("🃏 **Günün Kartı: Güneş** - Neşe, başarı ve netlik dolu bir enerji seni sarıyor.")
    st.markdown("<br>" * 3, unsafe_allow_html=True)

    if st.button("🗑️ Sohbet Geçmişini Temizle", use_container_width=True):
        st.session_state.messages = []
        st.rerun()

# --- ANA EKRAN ---
st.title("🌙 Lunara.ai | Mistik Rehber")
st.caption("Kişiselleştirilmiş Yapay Zeka Fal, Tarot ve Astroloji Danışmanı")

# State Başlatma
if "messages" not in st.session_state:
    st.session_state.messages = [
        {
            "role": "assistant",
            "content": "Hoş geldin. Ben Lunara. Yıldızların fısıltıları, kartların gizemi ve evrenin sırlarıyla sana rehberlik etmek için buradayım."
        }
    ]

# 4 Ana Sekme Yapısı
tab1, tab2, tab3, tab4 = st.tabs([
    "🔮 Mistik Sohbet", 
    "📜 Doğum Haritası Analizi", 
    "🃏 3 Kart Tarot Açılımı", 
    "☕ Kahve Falı & Rüyalar"
])

SYSTEM_PROMPT = "Sen Lunara adında bilge, mistik, empatik ve nazik bir tarot/astroloji danışmanısın. Kullanıcılara sıcak ve gizemli bir tonla rehberlik ediyorsun."

# ==================== 1. SEKME: MİSTİK SOHBET ====================
with tab1:
    st.markdown("### ✨ Hızlı Mistik Sorular")

    col1, col2, col3, col4 = st.columns(4)

    # Hızlı Butonlar (1, 2, 3, 4)
    with col1:
        if st.button("✨ Günlük Fal Yorumu", use_container_width=True):
            send_prompt_to_ai("Bana bugüne özel genel bir mistik fal yorumu ve rehberlik yapar mısın?", SYSTEM_PROMPT)

    with col2:
        if st.button("❤️ Aşk & Uyum", use_container_width=True):
            send_prompt_to_ai("Aşk hayatım ve ilişkilerdeki enerjim hakkında mistik bir değerlendirme yapar mısın?", SYSTEM_PROMPT)

    with col3:
        if st.button("💼 Kariyer & Gelecek", use_container_width=True):
            send_prompt_to_ai("Kariyerim, maddi durumum ve geleceğimle ilgili yıldızların tavsiyesi nedir?", SYSTEM_PROMPT)

    with col4:
        if st.button("🪐 Günün Burç Enerjisi", use_container_width=True):
            send_prompt_to_ai("Bugünün gökyüzü konumları ve gezegen enerjileri bana nasıl yansıyor?", SYSTEM_PROMPT)

    st.markdown("<br>", unsafe_allow_html=True)

    # Geçmiş Mesajları Listeleme
    for message in st.session_state.messages:
        with st.chat_message(message["role"]):
            st.write(message["content"])

    # Metin Girişi
    if user_chat_input := st.chat_input("Fal, tarot veya burçlar hakkında bir şey sorun..."):
        send_prompt_to_ai(user_chat_input, SYSTEM_PROMPT)


# ==================== 2. SEKME: DOĞUM HARİTASI ====================
with tab2:
    st.markdown("### 📜 Doğum Haritası Derin Analizi")
    st.write("Yıldızların doğduğun anki dizilimini çözümleyelim.")

    with st.form("astrology_form"):
        col_name, col_date, col_time = st.columns(3)
        with col_name:
            birth_name = st.text_input("Adınız / Doğum İsminiz")
        with col_date:
            birth_date = st.date_input("Doğum Tarihiniz")
        with col_time:
            birth_time = st.time_input("Doğum Saatiniz (Varsa)")

        birth_place = st.text_input("Doğum Yeri (Şehir / Ülke)")
        submit_astro = st.form_submit_button("🌌 Doğum Haritamı Analiz Et")

        if submit_astro:
            astro_prompt = f"Adım {birth_name}, Doğum Tarihim: {birth_date}, Doğum Saatim: {birth_time}, Doğum Yerim: {birth_place}. Doğum haritama göre kişilik özelliklerimi, potansiyellerimi ve ruhsal yolculuğumu detaylıca analiz eder misin?"
            send_prompt_to_ai(astro_prompt, SYSTEM_PROMPT)


# ==================== 3. SEKME: TAROT AÇILIMI ====================
with tab3:
    st.markdown("### 🃏 3 Kart Tarot Açılımı")
    st.write("Geçmiş, Şimdi ve Gelecek aksındaki enerjilerini kartlara sor.")

    tarot_focus = st.text_input("Açılım öncesinde niyetin veya odaklanmak istediğin konu nedir?", placeholder="Örn: İlişkimin geleceği, iş değişikliği...")
    if st.button("🔮 Kartları Çek ve Yorumla", use_container_width=True):
        tarot_prompt = f"Tarot açılımı için niyetim: {tarot_focus if tarot_focus else 'Genel Hayat Yönüm'}. Rastgele 3 Tarot kartı seçerek bunları Geçmiş, Şimdi ve Gelecek konumu olarak mistik bir dille yorumlar mısın?"
        send_prompt_to_ai(tarot_prompt, SYSTEM_PROMPT)


# ==================== 4. SEKME: KAHVE FALI & RÜYALAR ====================
with tab4:
    st.markdown("### ☕ Kahve Falı & Rüyalar")
    st.write("Gördüğün sembolleri, fincanındaki imgeleri veya rüyalarını anlat.")

    dream_input = st.text_area("Fincanındaki sembolleri veya gördüğün rüyayı detaylıca yaz:", placeholder="Örn: Rüyamda berrak bir denizin üstünde uçuyordum...")
    if st.button("🌙 Mistik Sembol Analizi Yap", use_container_width=True):
        if dream_input:
            dream_prompt = f"Şu anlatımı bir rüya veya kahve falı sembolü olarak mistik ve psikolojik açıdan detaylıca yorumlar mısın: '{dream_input}'"
            send_prompt_to_ai(dream_prompt, SYSTEM_PROMPT)
        else:
            st.warning("Lütfen yorumlanması için bir rüya veya sembol metni girin.")
