// Website / installed-app layer: service worker, install button, update and offline notices.
(function () {
  const $ = s => document.querySelector(s);
  const toast = t => { const el = $("#toast"); if (!el) return; el.textContent = t; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 2600); };
  const tools = $(".rail-tools");

  // 1. offline support and updates
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("sw.js").then(reg => {
      const offer = w => {
        const b = document.createElement("button"); b.className = "btn sm pri"; b.type = "button"; b.textContent = "⬆ גרסה חדשה: רענון";
        b.onclick = () => w.postMessage("skip-waiting"); tools && tools.prepend(b); toast("גרסה חדשה של האקדמיה זמינה");
      };
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener("updatefound", () => { const w = reg.installing; w && w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) offer(w); }); });
    }).catch(() => {});
    // reload only when an update replaces a running worker, never on the first install
    const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  }

  // 2. install as an app
  let deferred = null;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const btn = document.createElement("button"); btn.className = "btn sm"; btn.type = "button"; btn.id = "installBtn"; btn.textContent = "📲 התקנה כאפליקציה"; btn.hidden = true;
  tools && tools.prepend(btn);
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; btn.hidden = false; });
  btn.onclick = async () => {
    if (deferred) { deferred.prompt(); const r = await deferred.userChoice; if (r.outcome === "accepted") { btn.hidden = true; toast("האקדמיה הותקנה 🎉"); } deferred = null; return; }
    toast("ב-iPhone: כפתור השיתוף ← ׳הוספה למסך הבית׳");
  };
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone;
  if (ios) btn.hidden = false;
  window.addEventListener("appinstalled", () => { btn.hidden = true; });

  // 3. connection state and how sync works on the website
  const note = () => {
    const s = $("#syncStatus"); if (!s || !s.textContent.includes("בדפדפן הזה")) return;
    s.textContent = navigator.onLine ? "💾 נשמר במכשיר הזה · לסנכרון: גיבוי ושחזור בלוח הבקרה" : "📴 מצב לא מקוון · הכול עובד, נשמר במכשיר";
  };
  window.addEventListener("online", () => { note(); toast("חזרתם לרשת"); });
  window.addEventListener("offline", () => { note(); toast("אין חיבור. האקדמיה ממשיכה לעבוד"); });
  setTimeout(note, 1500);
})();
