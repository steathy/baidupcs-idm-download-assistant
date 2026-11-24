// ==UserScript==
// @name         网盘直链下载助手 IDM 修复 (Baidu)
// @namespace    local.panlinker.idm-fix
// @version      1.2.0
// @description  Companion to 网盘直链下载助手: makes "API下载" on Baidu Netdisk hand downloads to IDM again. Baidu now keeps the download redirect on HTTPS, which IDM's network driver cannot see, so the helper silently fell back to downloading inside the browser.
// @match        *://pan.baidu.com/disk/home*
// @match        *://yun.baidu.com/disk/home*
// @match        *://pan.baidu.com/disk/main*
// @match        *://yun.baidu.com/disk/main*
// @connect      baidu.com
// @connect      baidupcs.com
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// ==/UserScript==

/*
 * Why this exists
 * ---------------
 * In "API下载" mode the helper script downloads the file with GM_xmlhttpRequest and only reports
 * "已成功唤起IDM" when that request comes back as HTTP 204 - the reply IDM's network driver
 * ("advanced browser integration") injects when it takes a download over. That driver only sees
 * plain-HTTP traffic, and it never takes over video/audio responses of background requests.
 *
 *   until mid-2025:  https://d.pcs.baidu.com/file/..  -> 302 ->  http://<node>.baidupcs.com/..   (IDM sees it)
 *   now:             https://d.pcs.baidu.com/file/..  -> 302 -> https://<node>.baidupcs.com/..   (IDM is blind)
 *
 * What it does on each click of a link in the helper's "API下载" dialog
 * ------------------------------------------------------------------
 *   1. Asks Baidu over HTTPS (1 byte only) where the link redirects to.
 *   2. Hands that final CDN link to IDM in one of two ways (see HANDOFF below):
 *      'http'    - swaps the final link to http:// and lets the helper script continue as before.
 *                  IDM's network driver intercepts it exactly like it did until 2025.
 *                  Only the signed per-file CDN link travels over HTTP; the access token stays on HTTPS.
 *      'browser' - starts a normal browser download of the https:// final link (hidden frame).
 *                  IDM's browser extension takes it over like any other download; if IDM does not,
 *                  Chrome simply downloads the file itself.
 *   If anything fails, the click is passed to the helper untouched (its old in-browser download).
 */
(function () {
    'use strict';

    // How to hand the download to IDM:
    //   'auto'    - video/audio files -> 'browser', everything else -> 'http'   (recommended)
    //   'http'    - always the plain-HTTP route (IDM network driver; does not work for video/audio)
    //   'browser' - always a normal HTTPS browser download (IDM browser extension)
    const HANDOFF = 'auto';

    const UA = 'pan.baidu.com';                  // the User-Agent the helper script uses for Baidu links
    const LINK_SELECTOR = 'a.listener-link-api'; // the per-file links in the helper's "API下载" dialog
    const CDN_HOST = /(^|\.)baidupcs\.com$|(^|\.)pcs\.baidu\.com$/i;
    const MEDIA_EXT = /\.(mp4|m4v|mkv|avi|wmv|asf|mov|qt|flv|f4v|webm|3gp|3gpp|mpg|mpeg|mpe|ts|m2ts|rm|rmvb|vob|ogv|mp3|m4a|aac|wav|wma|ogg|flac|ape|ra|aif|mpa)$/i;
    const BUSY_TEXT = '正在获取可被 IDM 接管的直链…';
    const BROWSER_TEXT = '已发起浏览器下载，IDM 会自动接管；若未弹出 IDM，则由浏览器直接下载。';
    const TAG = '[panlinker-idm-fix]';

    const replaying = new WeakSet(); // links whose click we are re-dispatching right now
    const busy = new WeakSet();      // links currently being resolved

    // Follow the redirect over HTTPS without downloading the file: ask for 1 byte only, and stop as soon as
    // the response headers are in (so nothing big is ever pulled, even if the range were ignored).
    function resolveFinal(url) {
        return new Promise((resolve, reject) => {
            let done = false;
            let req = null;
            const settle = (res) => {
                if (done) return;
                done = true;
                const type = /^content-type:\s*([^\r\n;]+)/im.exec(res.responseHeaders || '');
                resolve({url: res.finalUrl || '', contentType: type ? type[1].trim() : ''});
                try {
                    req && req.abort && req.abort();
                } catch (e) { /* already finished */ }
            };
            const fail = (why) => {
                if (done) return;
                done = true;
                reject(new Error(why));
            };
            req = GM_xmlhttpRequest({
                method: 'GET',
                url,
                headers: {'User-Agent': UA, 'Range': 'bytes=0-0'},
                timeout: 15000,
                onreadystatechange: (res) => {
                    if (res.readyState >= 2 && res.status && res.finalUrl) settle(res);
                },
                onload: settle,
                onerror: () => fail('request failed'),
                onabort: () => fail('aborted'),
                ontimeout: () => fail('timed out'),
            });
        });
    }

    // Only accept an https link on Baidu's download CDN as "the final link".
    function cdnLink(finalUrl) {
        let u;
        try {
            u = new URL(finalUrl);
        } catch (e) {
            return '';
        }
        return u.protocol === 'https:' && !u.port && CDN_HOST.test(u.hostname) ? finalUrl : '';
    }

    function isMedia(filename, contentType) {
        return /^(video|audio)\//i.test(contentType || '') || MEDIA_EXT.test(filename || '');
    }

    // Normal browser download: navigate a hidden frame to the link (the CDN answers with an attachment).
    function browserDownload(url) {
        const frame = document.createElement('iframe');
        frame.style.display = 'none';
        frame.src = url;
        document.body.appendChild(frame);
        setTimeout(() => frame.remove(), 120000);
    }

    // Let the helper script handle the click (now that data-link is what we want it to fetch).
    function replay(link) {
        replaying.add(link);
        try {
            link.click();
        } finally {
            replaying.delete(link);
        }
    }

    // Capture phase on document: runs before the helper's (bubble-phase, delegated) click handler.
    document.addEventListener('click', (e) => {
        const link = e.target && e.target.closest ? e.target.closest(LINK_SELECTOR) : null;
        if (!link || replaying.has(link)) return;

        // Always start from the link Baidu's API gave us, so repeated clicks get a fresh signed URL.
        const original = link.dataset.plOrigLink || link.dataset.link || '';
        if (!/^https:\/\//i.test(original)) return; // nothing to fix - let the helper handle it

        e.preventDefault();
        e.stopImmediatePropagation();
        if (busy.has(link)) return;
        busy.add(link);

        if (!link.dataset.plOrigLink) {
            link.dataset.plOrigLink = original;
            link.dataset.plOrigText = link.textContent;
        }
        link.textContent = BUSY_TEXT;

        resolveFinal(original)
            .catch((err) => {
                console.warn(TAG, 'could not resolve the final link:', err && err.message);
                return {url: '', contentType: ''};
            })
            .then((res) => {
                const finalUrl = cdnLink(res.url);
                const viaBrowser = HANDOFF === 'browser' ||
                    (HANDOFF === 'auto' && isMedia(link.dataset.filename, res.contentType));
                busy.delete(link);

                if (viaBrowser) {
                    browserDownload(finalUrl || original);
                    link.textContent = BROWSER_TEXT;
                    return;
                }
                if (!finalUrl) console.warn(TAG, 'no final CDN link, IDM will probably not be invoked');
                link.textContent = link.dataset.plOrigText;
                link.dataset.link = finalUrl ? finalUrl.replace(/^https:/i, 'http:') : original; // signed query stays byte-identical
                replay(link);
            });
    }, true);
})();
