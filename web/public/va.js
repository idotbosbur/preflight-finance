// Vercel Web Analytics setup (cookieless page-view counts). Loaded before /_vercel/insights/script.js.
// Only the page path and campaign tags (ref, utm_*) are sent: the #/… part of app addresses, which can name
// internal batch and case IDs, is always removed.
window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
window.va("beforeSend", function (event) {
  try {
    var url = new URL(event.url);
    url.hash = "";
    var keep = new URLSearchParams();
    url.searchParams.forEach(function (value, key) {
      if (key === "ref" || key.indexOf("utm_") === 0) keep.set(key, value);
    });
    url.search = keep.toString();
    return Object.assign({}, event, { url: url.toString() });
  } catch (e) {
    return null;
  }
});
