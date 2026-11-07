# 動畫瘋彈幕防重疊

修正巴哈姆特動畫瘋影片頁面（`https://ani.gamer.com.tw/animeVideo.php?sn=*`）彈幕互相重疊的問題。本專案為 userscript，主要原始碼為本 repo 的 `main.js`。

**彈幕為什麼會重疊**
- **滾動彈幕追撞：** 滾動速度為 `(螢幕寬度 + 2 × 彈幕寬度) / 12 秒`，越長的彈幕跑得越快。原生的分配方式只保留到彈幕尾巴離開右邊界為止，之後同一行就讓給下一條彈幕；若下一條比較長（比較快），就會從後面追撞上前一條。
- **不同模式互不相知：** 滾動、頂部、底部彈幕各自分配位置，因此頂部彈幕常和滾動彈幕疊在同一行。

**修正方式**
- 彈幕管理器（`mt`）與分配位置的 `Cs` 都包在 `anime_player.js` 的閉包內無法直接取得。腳本暫時攔截 `Function.prototype.bind`（播放時管理器會呼叫 `this.start.bind(this)` / `this.buildDanmu.bind(this)`）取得管理器實例，再透過 prototype 覆寫 `mt.prototype.buildDanmu` 與 `Cs.prototype.getLocation`。
- 頂部 / 底部的固定彈幕維持原生位置，即使重疊也不移動。觀眾常用多條固定彈幕排出直書歌詞或圖案，移動位置會打亂順序。
- 滾動彈幕改用新的分配方式：計算每條彈幕（滾動與固定）在每個影片時間點的水平範圍，只選擇在共同存在期間完全不會與其他彈幕相交的行。彈幕速度設定與播放速度的變化都會納入計算。
- 若畫面真的沒有空位，滾動彈幕仍會顯示，放在重疊量（重疊高度 × 重疊時間）最小的位置。若想改為不顯示，可將 `main.js` 中的 `OVERFLOW_MODE` 改為 `'drop'`。

**安裝型別套件（編輯器提示用）**
若想在 VS Code 等編輯器中取得較好的型別提示與 IntelliSense，可在專案根目錄執行以下指令安裝型別定義：

```bash
npm install
```

**快速開發流程（Chrome + Tampermonkey）**
1. 確認腳本原始碼為本 repo 的 `main.js`（Windows 範例路徑：`C:\path\to\anigamerDanmakuFix\main.js`）。
2. 開啟 Chrome，若尚未安裝 Tampermonkey 請先安裝。
3. 允許 Tampermonkey 存取本機檔案：開啟 `chrome://extensions/`，找到 Tampermonkey，點選「詳細資料」，開啟「允許存取檔案網址」。
4. 在 Tampermonkey 新增腳本（控制台 → 新增腳本），貼上下方的 header，並將 `@require` 的本機路徑改為你自己的絕對路徑。
5. 儲存腳本。由於 `@require` 指向 `file:///` 網址，每次載入目標頁面時 Tampermonkey 都會從磁碟讀取 `main.js`，因此在外部修改檔案後重新整理動畫頁面即可看到變更。

**Userscript header（貼到 Tampermonkey，並將 `file:///...` 改為你自己的絕對路徑）**

```js
// ==UserScript==
// @name         動畫瘋彈幕防重疊
// @description  修正動畫瘋彈幕互相重疊的問題（滾動彈幕追撞、滾動與頂部/底部彈幕互相覆蓋）。
// @namespace    nathan60107
// @author       nathan60107(貝果)
// @version      0.0.0
// @homepage     https://home.gamer.com.tw/creationCategory.php?owner=nathan60107&c=425332
// @match        https://ani.gamer.com.tw/animeVideo.php?sn=*
// @icon         https://ani.gamer.com.tw/apple-touch-icon-144.jpg
// @grant        none
// @run-at       document-start
// @noframes
// @require      file:///C:/path/to/anigamerDanmakuFix/main.js
// ==/UserScript==
```
