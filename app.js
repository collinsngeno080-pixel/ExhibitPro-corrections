import { initClarity, identifyClarity } from "./clarity.js";
import { captureAttribution, getAttribution } from "./attribution.js";

initClarity();
captureAttribution();

const form      = document.getElementById("contactForm");
const successEl = document.getElementById("contactSuccess");
const errorEl   = document.getElementById("contactError");
const submitBtn = document.getElementById("contactSubmit");
const resetBtn  = document.getElementById("contactReset");

form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.style.display = "none";
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";

    const formData = {
        firstName: form.firstName.value.trim(),
        lastName:  form.lastName.value.trim(),
        email:     form.email.value.trim(),
        phone:     form.phone.value.trim(),
        message:   form.message.value.trim(),
    };

    try {
        identifyClarity(formData.email);
        const attribution = getAttribution(formData.email);

        const response = await fetch("/api/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...formData, attribution }),
        });

        if (!response.ok) throw new Error("Failed to send");

        form.style.display = "none";
        successEl.style.display = "block";
        form.reset();
    } catch (err) {
        console.error(err);
        errorEl.style.display = "block";
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Inquiry";
    }
});

resetBtn.addEventListener("click", () => {
    successEl.style.display = "none";
    form.style.display = "flex";
});
