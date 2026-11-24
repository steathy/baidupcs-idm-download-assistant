# Baidu Pan IDM download assistant

A small companion userscript for [网盘直链下载助手](https://www.youxiaohou.com/) (PanLinker) that makes its
**API下载** mode on Baidu Netdisk hand downloads to **Internet Download Manager (IDM)** again.

Without it, clicking a link in the helper's "API下载" dialog no longer invokes IDM: the helper shows
"未发现IDM，使用自带浏览器下载" and the file is downloaded inside the browser.

## Why the hand-off broke

Nothing is wrong with Tampermonkey, the helper script or IDM. Baidu changed where its download link redirects to.

- In "API下载" mode the helper fetches the file in the background (`GM_xmlhttpRequest`) and reports
  "已成功唤起IDM" only when that request comes back as `HTTP 204 Intercepted by the IDM Advanced Integration`.
- That reply is injected by IDM's **network driver** ("Use advanced browser integration"), not by IDM's browser
  extension. The driver can only see **plain-HTTP** traffic.
- Baidu's download link used to leave HTTPS on the second hop. It no longer does:

  ```
  until mid-2025:  https://d.pcs.baidu.com/file/…  -> 302 ->  http://<node>.baidupcs.com/…   IDM sees it
  now:             https://d.pcs.baidu.com/file/…  -> 302 -> https://<node>.baidupcs.com/…   IDM is blind
  ```

- The CDN node still serves the very same signed link over `http://`, and the link is not tied to a
  particular User-Agent. That is what this script uses.
- Separate IDM rule: the driver never takes over **video/audio** responses of background requests, whatever
  the scheme. Those need a real browser download, which IDM's browser extension takes over.

## What the script does

On every click of a file link in the helper's "API下载" dialog it asks Baidu over HTTPS (one byte only) where the
link redirects to, then hands that final CDN link to IDM in one of two ways:

| Route | Used for (`HANDOFF = 'auto'`) | How IDM gets the download |
|---|---|---|
| `http` | everything except video/audio | The final link is swapped to `http://` and the click is replayed, so the helper continues exactly as before and IDM's network driver intercepts its request. The helper shows "已成功唤起IDM，请查看IDM下载框！". |
| `browser` | video/audio | A normal HTTPS browser download of the final link is started in a hidden frame. IDM's browser extension takes it over like any other download; if it does not, the browser downloads the file itself. |

If anything fails (lookup error, unexpected link), the click is passed to the helper untouched, which is the
old in-browser download.

The access token never leaves HTTPS. On the `http` route only the signed, per-file CDN link (and the file
content) travel over plain HTTP, which is how the hand-off worked before Baidu's change.

## Requirements

- A Chromium browser with Tampermonkey.
- 网盘直链下载助手 installed and working ("下载助手" button visible on `pan.baidu.com`).
- IDM running, with
  - **Options → General → Use advanced browser integration** enabled (needed for the `http` route),
  - the **IDM Integration Module** extension enabled in the browser (needed for the `browser` route),
  - the file's extension listed in **Options → File types** (IDM ignores types that are not listed).

Tested in November 2026 with Chrome 157, Tampermonkey 5.5.0, 网盘直链下载助手 6.2.7, IDM 6.43 build 15 and
IDM Integration Module 6.43.18.

## Install

1. Open [`panlinker-idm-fix.user.js`](panlinker-idm-fix.user.js) in this repository and click **Raw**.
   Tampermonkey shows its install page; click **Install**.
   If the browser only shows the source text, open the Tampermonkey dashboard, create a new script (**+**),
   paste the file's contents and save.
2. Reload `pan.baidu.com`.
3. Select a file → **下载助手 → API下载** → click the file's link.

The script declares no update URL of its own, so Tampermonkey checks for updates at the address it was
installed from. Installed from this repository, it can only ever be updated from this repository.

## Configuration

One constant at the top of the script:

```js
const HANDOFF = 'auto';   // 'auto' | 'http' | 'browser'
```

- `auto` (default): video/audio → `browser`, everything else → `http`.
- `http`: always the plain-HTTP route. Does not work for video/audio.
- `browser`: always a normal HTTPS browser download. Keeps everything encrypted and needs only IDM's browser
  extension.

## Keeping the helper script from changing underneath you

This script is separate from the helper, so an update of the helper cannot overwrite it. An update could still
change the parts of the helper this script relies on (see below). To freeze the helper at the version you
tested: Tampermonkey dashboard → the helper script → **Settings** → **Updates** → untick **Check for updates**.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Link shows "未发现IDM，使用自带浏览器下载" and a progress bar | The file type is not in IDM's **File types** list, IDM is not running, or advanced browser integration is off. |
| Video/audio keeps downloading in the browser | IDM's browser extension is disabled or not connected to IDM, or the type is not in IDM's **File types** list. |
| Nothing changes compared to before | This script is disabled, or the helper's dialog markup changed. Look for `[panlinker-idm-fix]` messages in the page console. |
| Link stays on "正在获取可被 IDM 接管的直链…" for ~15 s, then behaves as before | The redirect lookup failed or timed out; the original behaviour is used as fallback. |

## Limitations

- Relies on the helper's dialog markup: links matching `a.listener-link-api` with `data-link` and
  `data-filename` attributes (verified against 6.2.7).
- The `http` route relies on Baidu's CDN nodes still answering on port 80; the `browser` route relies on the
  final link not being tied to the `pan.baidu.com` User-Agent. Both hold as of November 2026.
- Only the "my netdisk" pages (`/disk/main`, `/disk/home`) are covered, which is where the helper offers
  "API下载".
- Download speed is whatever Baidu grants the account; this script does not change it.
