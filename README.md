# 网盘直链下载助手IDM修复版

An unofficial fork of [网盘直链下载助手](https://www.youxiaohou.com/) (PanLinker) v6.2.7 that makes its
**API下载** mode on Baidu Netdisk hand downloads to **Internet Download Manager (IDM)** again.
Everything else works as in the original.

## Install

**Install link: <https://tinyurl.com/baidupcs-idm-fix>**

Backup (direct GitHub link):
<https://github.com/steathy/baidupcs-idm-download-assistant/raw/refs/heads/main/panlinker-idm.user.js>

1. In Tampermonkey, disable or remove the original 网盘直链下载助手. Two copies would both add a "下载助手"
   button and both handle clicks.
2. Open the install link above. Tampermonkey shows its install page; click **Install**.
3. Reload `pan.baidu.com`. Tampermonkey treats this as a new script, so it starts with empty settings and
   re-authorises with Baidu on first use. There is no activation-code prompt.
4. Select a file → **下载助手 → API下载** → click the file's link. IDM takes the download over.

IDM has to be set up as follows:

- IDM is running.
- **Options → General → Use advanced browser integration** is enabled (used for everything except video/audio).
- The **IDM Integration Module** extension is enabled in the browser (used for video/audio).
- The file's extension is listed in **Options → File types**. IDM ignores types that are not listed.

Tested in November 2026 with Chrome 157, Tampermonkey 5.5.0, IDM 6.43 build 15 and IDM Integration Module 6.43.18.

## Configuration

One constant near the top of the script:

```js
const IDM_HANDOFF = 'auto';   // 'auto' | 'http' | 'browser'
```

- `auto` (default): video/audio → `browser`, everything else → `http`.
- `http`: always the plain-HTTP route. Does not work for video/audio.
- `browser`: always a normal HTTPS browser download. Keeps everything encrypted and needs only IDM's browser
  extension.

The two routes are explained under [What this fork changes](#what-this-fork-changes).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Row shows "未发现IDM，使用自带浏览器下载" and a progress bar | The file type is not in IDM's **File types** list, IDM is not running, or advanced browser integration is off. |
| Video/audio keeps downloading in the browser | IDM's browser extension is disabled or not connected to IDM, or the type is not in IDM's **File types** list. |
| Row stays on "正在获取可被 IDM 接管的直链…" for ~15 s, then behaves like the original | The redirect lookup failed or timed out; the original behaviour is used as fallback. |
| Two "下载助手" buttons | The original script is still enabled next to this fork. |
| The install link shows the script's source text instead of an install page | Tampermonkey is disabled or not installed in this browser. |

## Why the hand-off broke

With the original script, clicking a link in the "API下载" dialog no longer invokes IDM: it shows
"未发现IDM，使用自带浏览器下载" and the file is downloaded inside the browser. Nothing is wrong with
Tampermonkey, the original script or IDM. Baidu changed where its download link redirects to.

- In "API下载" mode the script fetches the file in the background (`GM_xmlhttpRequest`) and reports
  "已成功唤起IDM" only when that request comes back as `HTTP 204 Intercepted by the IDM Advanced Integration`.
- That reply is injected by IDM's **network driver** ("Use advanced browser integration"), not by IDM's browser
  extension. The driver can only see **plain-HTTP** traffic.
- Baidu's download link used to leave HTTPS on the second hop. It no longer does:

  ```
  until mid-2025:  https://d.pcs.baidu.com/file/…  -> 302 ->  http://<node>.baidupcs.com/…   IDM sees it
  now:             https://d.pcs.baidu.com/file/…  -> 302 -> https://<node>.baidupcs.com/…   IDM is blind
  ```

- The CDN node still serves the very same signed link over `http://`, and the link is not tied to a
  particular User-Agent. That is what the fix uses.
- Separate IDM rule: the driver never takes over **video/audio** responses of background requests, whatever
  the scheme. Those need a real browser download, which IDM's browser extension takes over.

## What this fork changes

All changes are marked `IDM fix` or `Fork:` in the code.

1. **IDM hand-off (Baidu "API下载").** On each click the script first asks Baidu over HTTPS (one byte only)
   where the link redirects to, then hands that final CDN link to IDM:

   | Route | Used for (`IDM_HANDOFF = 'auto'`) | How IDM gets the download |
   |---|---|---|
   | `http` | everything except video/audio | The final link is fetched over `http://`, so IDM's network driver intercepts the request as it did until 2025. The row shows "已成功唤起IDM，请查看IDM下载框！". |
   | `browser` | video/audio | A normal HTTPS browser download of the final link is started in a hidden frame. IDM's browser extension takes it over like any other download; if it does not, the browser downloads the file itself. |

   If the final link cannot be determined, the original link is used, which is the pre-fix behaviour.
   The access token never leaves HTTPS. On the `http` route only the signed, per-file CDN link (and the file
   content) travel over plain HTTP, which is how the hand-off worked before Baidu's change.

2. **Updates come only from this repository.** `@updateURL` / `@downloadURL` point at this repository, and the
   original's "new version" menu entry is hidden, so the original can never replace this script through an
   update.

3. **Own identity and version.** Separate `@name` / `@namespace` and its own version numbers. The author's
   configuration service is still called with the upstream version this fork is based on (`6.2.7`).

4. **No activation-code dialog.** The original shows a dimmed button on first use and asks for a code
   ("请输入本助手开源协议"). This fork shows the working download button straight away.

## Limitations

- The `http` route relies on Baidu's CDN nodes still answering on port 80; the `browser` route relies on the
  final link not being tied to the `pan.baidu.com` User-Agent. Both hold as of November 2026.
- Like the original, the script fetches its configuration (API endpoints, texts) from the original author's
  service at run time. Pinning the code here does not pin that.
- Download speed is whatever Baidu grants the account; this fork does not change it.

## Releasing an update

Bump `@version` in `panlinker-idm.user.js`, commit, tag (`vX.Y.Z`) and push. Tampermonkey picks the new
version up from this repository on its next update check.

To take over a newer upstream release, re-apply the marked changes (`IDM fix`, `Fork:` and the metadata
block) to the new upstream file and set the upstream version constant accordingly.

## Credits and license

Original script: 网盘直链下载助手 © YouXiaoHou, <https://github.com/syhyz1990/baiduyun>, licensed
AGPL-3.0-or-later. This fork is distributed under the same license; see [LICENSE](LICENSE). The script file
carries a notice describing what was modified and when.
