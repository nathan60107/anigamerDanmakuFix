// ==UserScript==
// @name         動畫瘋彈幕防重疊
// @description  修正動畫瘋彈幕互相重疊的問題（滾動彈幕追撞、滾動與頂部/底部彈幕互相覆蓋）。
// @namespace    nathan60107
// @author       nathan60107(貝果)
// @version      1.0.0
// @homepage     https://home.gamer.com.tw/creationCategory.php?owner=nathan60107&c=425332
// @match        https://ani.gamer.com.tw/animeVideo.php?sn=*
// @icon         https://ani.gamer.com.tw/apple-touch-icon-144.jpg
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

/**
 * 動畫瘋的彈幕引擎（anime_player.js 內的 DanmuManager，以下稱 mt）用 Cs 這個 class
 * 來分配每條彈幕的垂直位置，它有兩個問題：
 *
 * 1. 滾動彈幕的速度 = (螢幕寬 + 2 * 彈幕寬) / 12 秒，越長的彈幕跑越快。
 *    但 Cs 只保留「彈幕尾巴離開右邊界」為止的時間，之後同一行就讓給下一條彈幕。
 *    若下一條彈幕比較長（比較快），就會從後面追撞上前一條。
 * 2. 滾動 / 頂部 / 底部各自有獨立的 Cs，彼此不知道對方的存在，
 *    所以頂部彈幕常常和滾動彈幕疊在同一行。
 *
 * 修正方式：mt 與 Cs 都被包在 bundle 的閉包裡拿不到，
 * 但 mt.prototype.start 每一幀都會呼叫 this.start.bind(this)，
 * 因此暫時攔截 Function.prototype.bind 取得 DanmuManager 實例，
 * 再從實例往上取得 mt.prototype 與 Cs.prototype 並覆寫：
 *   - mt.prototype.buildDanmu：記下目前正在建立的彈幕。
 *   - Cs.prototype.getLocation：
 *     - 頂部 / 底部固定彈幕維持原生位置（避免打亂用固定彈幕排出的直書歌詞等），
 *       但會登記到分配器中。
 *     - 滾動彈幕改用新的分配器，以「每條彈幕在每個時間點的水平範圍」判斷是否碰撞，
 *       同時避開其他滾動彈幕與固定彈幕。
 */

//---------------------Config---------------------//
/**
 * 畫面已經沒有任何不重疊的位置時的處理方式：
 *   'overlap' - 放在重疊最少（重疊高度 × 重疊時間最小）的位置，保留所有彈幕
 *   'drop'    - 不顯示這條彈幕（完全不重疊）
 */
const OVERFLOW_MODE = 'overlap'
/** 同一行兩條彈幕之間至少保留的水平距離 (px) */
const H_GAP = 8
/** 印出除錯訊息 */
const DEBUG = false
//---------------------Config---------------------//

const LOG_PREFIX = '[動畫瘋彈幕防重疊]'
let dd = (...d) => {
  if (DEBUG) console.log(LOG_PREFIX, ...d)
}

/**
 * @typedef { object } DanmuData
 * @property { number } sn
 * @property { number } time 彈幕時間 (ms)
 * @property { 'rolling' | 'top' | 'bottom' | 'location' } mode
 * @property { number } [duration]
 */

/**
 * 一條已分配位置的彈幕。
 * 水平左緣位置為 left(t) = x0 + k * (t - start)，t 為影片時間 (ms)。
 * @typedef { object } Slot
 * @property { number } y0 上緣 (px，自畫面頂端起算)
 * @property { number } y1 下緣 (px，不含)
 * @property { number } start 出現時間 (影片 ms)
 * @property { number } end 消失時間 (影片 ms)
 * @property { number } x0 start 時的左緣 (px)
 * @property { number } k 水平速度 (px / 影片 ms)，固定彈幕為 0
 * @property { number } w 寬度 (px)
 */

/**
 * 在 [ts, te] 中，找出使 p + q * (t - ts) < 0 成立的區間。
 * @returns { [number, number] | null }
 */
function solveNegative(p, q, ts, te) {
  if (q === 0) return p < 0 ? [ts, te] : null
  const root = ts - p / q
  if (q > 0) return root > ts ? [ts, Math.min(te, root)] : null
  return root < te ? [Math.max(ts, root), te] : null
}

/**
 * 計算兩條彈幕在畫面上重疊的程度：垂直重疊高度 (px) * 水平範圍相交的時間長度 (影片 ms)。
 * 回傳 0 表示不會碰撞。
 * @param { Slot } a
 * @param { Slot } b
 */
function overlapCost(a, b) {
  const dy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  if (dy <= 0) return 0
  const ts = Math.max(a.start, b.start)
  const te = Math.min(a.end, b.end)
  if (te <= ts) return 0

  const aLeft = a.x0 + a.k * (ts - a.start)
  const bLeft = b.x0 + b.k * (ts - b.start)
  // a.left - (b.right + gap) < 0
  const r1 = solveNegative(aLeft - (bLeft + b.w + H_GAP), a.k - b.k, ts, te)
  if (!r1) return 0
  // b.left - (a.right + gap) < 0
  const r2 = solveNegative(bLeft - (aLeft + a.w + H_GAP), b.k - a.k, ts, te)
  if (!r2) return 0
  const dt = Math.min(r1[1], r2[1]) - Math.max(r1[0], r2[0])
  return dt > 1 ? dy * dt : 0
}

/**
 * 判斷兩條彈幕是否會在畫面上碰撞（垂直範圍重疊，且在共同存在的時間內水平範圍曾經相交）。
 * @param { Slot } a
 * @param { Slot } b
 */
function isCollide(a, b) {
  return overlapCost(a, b) > 0
}

/**
 * 所有模式共用的位置分配器，掛在 DLA.rolling 上，
 * 因此 cleanAll() → iniDLA() 重建 DLA 時（例如拖動進度條）會一併重置。
 */
class SlotAllocator {
  constructor() {
    /** @type { Slot[] } */
    this.slots = []
  }

  /** @param { number } now 影片時間 (ms) */
  prune(now) {
    this.slots = this.slots.filter((s) => s.end > now && s.start <= now)
  }

  /**
   * 直接登記一條已決定位置的彈幕（固定彈幕），讓之後的滾動彈幕避開它。
   * @param { Slot } slot
   */
  add(slot) {
    this.prune(slot.start)
    this.slots.push(slot)
  }

  /**
   * 為滾動彈幕找一個不會碰撞的位置。
   * @param { Omit<Slot, 'y0' | 'y1'> } item
   * @param { number } h 彈幕高度
   * @param { number } maxHeight 可用高度
   * @returns { number | null } 上緣位置，找不到時依 OVERFLOW_MODE 回傳 null 或重疊最少的位置
   */
  allocate(item, h, maxHeight) {
    this.prune(item.start)
    const active = this.slots.filter((s) => s.start < item.end)

    const maxY = Math.max(0, maxHeight - h)
    const candidates = [...new Set([0, ...active.map((s) => s.y1)])]
      .filter((y) => y >= 0 && y <= maxY)
      .sort((a, b) => a - b)

    let best = null
    let bestCost = Infinity
    for (const y of candidates) {
      const slot = { ...item, y0: y, y1: y + h }
      const cost = active.reduce((n, s) => n + overlapCost(slot, s), 0)
      if (cost === 0) {
        this.slots.push(slot)
        return y
      }
      if (cost < bestCost) {
        bestCost = cost
        best = slot
      }
    }

    if (OVERFLOW_MODE === 'drop' || !best) return null
    this.slots.push(best)
    return best.y0
  }

  /**
   * 播放速度改變時，畫面上已存在的彈幕仍以原本的實際速度移動，
   * 換算成影片時間後速度與剩餘時間都會改變，需重新定位。
   * @param { number } now 影片時間 (ms)
   * @param { number } factor 舊播放速度 / 新播放速度
   */
  rescale(now, factor) {
    this.slots = this.slots.filter((s) => s.end > now)
    for (const s of this.slots) {
      if (s.start < now) {
        s.x0 += s.k * (now - s.start)
        s.start = now
      }
      s.k *= factor
      s.end = s.start + (s.end - s.start) / factor
    }
  }
}

/** @param { any } mgr DanmuManager */
function getVideo(mgr) {
  return mgr.getWarp()[0]?.closest('.video-js')?.querySelector('video')
}

/** @param { any } mgr DanmuManager */
function getVideoRate(mgr) {
  return getVideo(mgr)?.playbackRate || 1
}

/** @type { WeakSet<HTMLVideoElement> } */
const watchedVideos = new WeakSet()

/** @param { any } mgr DanmuManager */
function watchRateChange(mgr) {
  const video = getVideo(mgr)
  if (!video || watchedVideos.has(video)) return
  watchedVideos.add(video)
  let lastRate = video.playbackRate || 1
  video.addEventListener('ratechange', () => {
    const rate = video.playbackRate || 1
    if (rate === lastRate) return
    const allocator = mgr.DLA[mgr._const.DANMU_MODE.ROLLING]?.__fixAllocator
    allocator?.rescale(video.currentTime * 1000, lastRate / rate)
    lastRate = rate
  })
}

/**
 * 依照原生 buildDanmu 的公式計算彈幕的移動參數（以影片時間為單位）。
 * @param { any } mgr DanmuManager
 * @param { DanmuData } danmu
 * @param { HTMLElement } el
 * @returns { Omit<Slot, 'y0' | 'y1'> }
 */
function getMotion(mgr, danmu, el) {
  const now = Number(mgr._const.TIME_POINT_GETTER()) || danmu.time
  const warpEl = mgr.getWarp()[0]
  const warpWidth = mgr.getWarp().width()
  const w = el.offsetWidth
  // 動畫以實際時間播放，而彈幕位置以影片時間計算：影片時間 = 實際時間 * playbackRate
  const realToVideo = getVideoRate(mgr)
  const speedRate = mgr.display.speedRate || 1

  if (danmu.mode === mgr._const.DANMU_MODE.ROLLING) {
    const rule = mgr._setting.danmuRollingRule
    const unit = parseFloat(rule.unit)
    let pxPerSec
    if (rule.type === 'speed') {
      pxPerSec = unit
    } else {
      const ref = rule.reference === 'warp' ? warpWidth : window.screen.availWidth
      pxPerSec = (ref + w * 2) / unit
    }
    const k = -((pxPerSec / 1000) * speedRate) / realToVideo
    // 原生動畫：translate3d(warpWidth) → translate3d(-110%)
    return { start: now, end: now + (warpWidth + w * 1.1) / -k, x0: warpWidth, k, w }
  }

  const duration = ((danmu.duration || mgr._setting.danmuDuration) / speedRate) * realToVideo
  const x0 = el.getBoundingClientRect().left - warpEl.getBoundingClientRect().left
  return { start: now, end: now + duration, x0, k: 0, w }
}

/** 目前正在 buildDanmu 中的彈幕 */
let building = null

/**
 * @param { any } mgr DanmuManager
 * @returns { Map<Function, Function> } 原生函式 → 覆寫後函式
 */
function patch(mgr) {
  const mtProto = Object.getPrototypeOf(mgr)
  const csProto = Object.getPrototypeOf(mgr.DLA[mgr._const.DANMU_MODE.ROLLING])
  if (mtProto.__fixDanmaku) return mtProto.__fixDanmaku

  const origBuildDanmu = mtProto.buildDanmu
  mtProto.buildDanmu = function (danmu) {
    building = { mgr: this, danmu }
    try {
      return origBuildDanmu.apply(this, arguments)
    } finally {
      building = null
    }
  }

  const origGetLocation = csProto.getLocation
  csProto.getLocation = function (h, start, end) {
    const ctx = building
    if (!ctx) return origGetLocation.apply(this, arguments)
    const { mgr, danmu } = ctx
    const MODE = mgr._const.DANMU_MODE
    try {
      // 原生 buildDanmu 會先把彈幕 append 到 warp 量尺寸，再呼叫 getLocation
      const el = mgr.getWarp()[0].lastElementChild
      if (!el || el.id !== mgr.getDanmuID(danmu.sn)) return origGetLocation.apply(this, arguments)

      watchRateChange(mgr)
      const rolling = mgr.DLA[MODE.ROLLING]
      rolling.__fixAllocator ??= new SlotAllocator()
      const allocator = rolling.__fixAllocator
      const motion = getMotion(mgr, danmu, el)

      // 固定彈幕（頂部 / 底部）維持原生位置，不論是否重疊：
      // 常有人用多條固定彈幕排出直書歌詞等圖案，移動位置會打亂順序。
      // 只登記到分配器中，讓滾動彈幕避開它。
      if (danmu.mode !== MODE.ROLLING) {
        const v = origGetLocation.apply(this, arguments)
        // 底部彈幕使用 css bottom
        const y = danmu.mode === MODE.BOTTOM ? this.maxHeight - h - v : v
        allocator.add({ ...motion, y0: y, y1: y + h })
        return v
      }

      const y = allocator.allocate(motion, h, this.maxHeight)
      if (y === null) {
        dd('drop', danmu.mode, danmu.text)
        el.style.display = 'none'
        el.classList.add('useless')
        return 0
      }
      return y
    } catch (e) {
      console.error(LOG_PREFIX, e)
      return origGetLocation.apply(this, arguments)
    }
  }

  mtProto.__fixDanmaku = new Map([[origBuildDanmu, mtProto.buildDanmu]])
  dd('patched', mgr)
  return mtProto.__fixDanmaku
}

/**
 * 暫時攔截 Function.prototype.bind 以取得 DanmuManager 實例。
 * 播放時 mt.prototype.start 每一幀都會呼叫 this.start.bind(this)，
 * 而第一次觸發的通常是 fireThisTimePoint 中的 this.buildDanmu.bind(this)。
 */
function hookBind() {
  const origBind = Function.prototype.bind
  function bind(thisArg, ...args) {
    let fn = this
    if (thisArg && thisArg.DLA && thisArg._const?.DANMU_MODE && thisArg._setting?.danmuRollingRule) {
      if (Function.prototype.bind === bind) Function.prototype.bind = origBind
      try {
        // 呼叫 bind 前已經先取得了原生的 buildDanmu，這裡改成 bind 覆寫後的版本
        fn = patch(thisArg).get(fn) ?? fn
      } catch (e) {
        console.error(LOG_PREFIX, e)
      }
    }
    return origBind.call(fn, thisArg, ...args)
  }
  Function.prototype.bind = bind
}

hookBind()
