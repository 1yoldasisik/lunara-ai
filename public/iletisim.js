"use strict";

const form = document.getElementById("contactForm");
const status = document.getElementById("contactStatus");
const submitButton = document.getElementById("contactSubmit");

if (form && status && submitButton) {
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        status.textContent = "";
        status.classList.remove("error");

        if (!form.reportValidity()) return;

        const payload = Object.fromEntries(new FormData(form).entries());
        submitButton.disabled = true;
        submitButton.textContent = "Gönderiliyor…";

        try {
            const response = await fetch("/api/contact", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const result = await response.json().catch(() => ({}));

            if (!response.ok || !result.success) {
                throw new Error(result.message || "Mesaj gönderilemedi. Lütfen tekrar deneyin.");
            }

            form.reset();
            status.textContent = result.message;
        } catch (error) {
            status.textContent = error.message || "Bir bağlantı hatası oluştu. Lütfen tekrar deneyin.";
            status.classList.add("error");
        } finally {
            submitButton.disabled = false;
            submitButton.innerHTML = 'Mesajı Gönder <span>✧</span>';
        }
    });
}
