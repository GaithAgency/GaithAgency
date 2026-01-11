
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp, doc, updateDoc, increment, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBRDD6ts7PHYs2DyHEoUx2l-lbdWWs5zXY",
    authDomain: "brandflow-7afee.firebaseapp.com",
    projectId: "brandflow-7afee",
    storageBucket: "brandflow-7afee.firebasestorage.app",
    messagingSenderId: "75262099069",
    appId: "1:75262099069:web:696ab61e10e1d4fec83b14",
    measurementId: "G-QEC114RPKN"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Helper to get or create visitor ID
const getVisitorId = () => {
    let id = localStorage.getItem('ghaith_visitor_id');
    if (!id) {
        id = 'v_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
        localStorage.setItem('ghaith_visitor_id', id);
    }
    return id;
};

// Simple Geolocation
async function getGeoData() {
    try {
        const response = await fetch('https://ipapi.co/json/');
        const data = await response.json();
        return {
            country: data.country_name || 'Unknown',
            city: data.city || 'Unknown',
            ip: data.ip || 'Unknown'
        };
    } catch (e) {
        console.error("Geo error:", e);
        return { country: 'Unknown', city: 'Unknown', ip: 'Unknown' };
    }
}

// Track Visit
async function trackVisit() {
    const visitorId = getVisitorId();
    const geo = await getGeoData();
    const referrer = document.referrer || 'Direct';
    let source = 'Direct';

    if (referrer.includes('google.com')) source = 'Google Search';
    else if (referrer.includes('facebook.com') || referrer.includes('fb.me') || referrer.includes('instagram.com') || referrer.includes('t.co') || referrer.includes('twitter.com') || referrer.includes('tiktok.com')) source = 'Social Media';
    else if (referrer !== 'Direct' && !referrer.includes(window.location.hostname)) source = 'Other Referral';

    const sessionData = {
        visitorId,
        page: window.location.pathname,
        startTime: serverTimestamp(),
        lastActive: serverTimestamp(),
        duration: 0,
        source,
        referrer,
        country: geo.country,
        city: geo.city,
        ip: geo.ip,
        userAgent: navigator.userAgent,
        device: /Mobile|Android|iPhone/i.test(navigator.userAgent) ? 'Mobile' : 'Desktop'
    };

    const docRef = await addDoc(collection(db, "visits"), sessionData);

    // Update daily stats summary
    const today = new Date().toISOString().split('T')[0];
    const statsRef = doc(db, "dailyStats", today);
    const statsSnap = await getDoc(statsRef);

    if (!statsSnap.exists()) {
        await setDoc(statsRef, {
            visits: 1,
            google: source === 'Google Search' ? 1 : 0,
            social: source === 'Social Media' ? 1 : 0,
            direct: source === 'Direct' ? 1 : 0,
            other: source === 'Other Referral' ? 1 : 0,
            date: today
        });
    } else {
        const updateObj = { visits: increment(1) };
        if (source === 'Google Search') updateObj.google = increment(1);
        else if (source === 'Social Media') updateObj.social = increment(1);
        else if (source === 'Direct') updateObj.direct = increment(1);
        else updateObj.other = increment(1);
        await updateDoc(statsRef, updateObj);
    }

    // Keep updating duration every 10 seconds while page is open
    let durationSeconds = 0;
    const interval = setInterval(async () => {
        durationSeconds += 10;
        try {
            await updateDoc(docRef, {
                duration: durationSeconds,
                lastActive: serverTimestamp()
            });
        } catch (e) {
            clearInterval(interval);
        }
    }, 10000);

    // Track WhatsApp clicks
    document.querySelectorAll('a[href*="wa.me"]').forEach(link => {
        link.addEventListener('click', async () => {
            await addDoc(collection(db, "events"), {
                type: 'whatsapp_click',
                visitorId,
                page: window.location.pathname,
                timestamp: serverTimestamp()
            });
            await updateDoc(doc(db, "totals", "stats"), {
                whatsappClicks: increment(1)
            }, { merge: true });
        });
    });

    // Track Form Submissions
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        form.addEventListener('submit', async (e) => {
            if (form.getAttribute('data-submitting') === 'true') return;
            e.preventDefault();
            form.setAttribute('data-submitting', 'true');

            const submitBtn = form.querySelector('button[type="submit"]');
            const originalBtnText = submitBtn ? submitBtn.innerHTML : '';
            if (submitBtn) submitBtn.innerHTML = 'جاري الإرسال...';

            const formData = new FormData(form);
            const data = Object.fromEntries(formData.entries());

            try {
                // 1. Save to Firestore
                await addDoc(collection(db, "leads"), {
                    ...data,
                    visitorId,
                    page: window.location.pathname,
                    timestamp: serverTimestamp()
                });

                await setDoc(doc(db, "totals", "stats"), {
                    formSubmissions: increment(1)
                }, { merge: true });

                await addDoc(collection(db, "events"), {
                    type: 'form_submission',
                    visitorId,
                    page: window.location.pathname,
                    timestamp: serverTimestamp(),
                    formId: form.id || 'contact_form'
                });

                // 2. Submit to Formspree (or original action)
                const response = await fetch(form.action, {
                    method: 'POST',
                    body: formData,
                    headers: { 'Accept': 'application/json' }
                });

                if (response.ok) {
                    form.reset();
                    if (submitBtn) {
                        submitBtn.innerHTML = 'تم الإرسال بنجاح ✅';
                        submitBtn.style.backgroundColor = '#10b981';
                    }
                    alert('تم استلام طلبك بنجاح، وسنتواصل معك قريباً.');
                } else {
                    throw new Error('Formspree error');
                }
            } catch (error) {
                console.error("Error submitting form:", error);
                form.submit(); // Fallback to traditional submission
            } finally {
                form.removeAttribute('data-submitting');
                if (submitBtn && submitBtn.innerHTML === 'جاري الإرسال...') {
                    submitBtn.innerHTML = originalBtnText;
                }
            }
        });
    });
}

// Check if we should track (prevent tracking on local dev if needed, or allow it)
trackVisit();
