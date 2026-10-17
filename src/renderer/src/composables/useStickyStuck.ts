import { nextTick, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * 判断一个 `position: sticky` 元素当前是否「已经吸顶」。
 *
 * 判定方式不依赖 `top` 的具体数值、容器的 padding，也不关心滚动容器是谁：
 * 在吸顶元素**紧前面**放一个零高度的普通流内锚点，它的 `top` 恒等于吸顶元素
 * 「没有吸顶时应该在的位置」。往下滚动时锚点跟着内容往上走，而吸顶元素被钉住不动，
 * 于是吸顶元素的 `top` 一定**大于**锚点 `top`（差值就是「本应滚上去的距离」）。
 *
 * 之所以不用 `bar.top <= scroller.top` 这种写法：那把阈值写死成了滚动容器的顶边，
 * 只要有人改动 `top`（哪怕从 -18px 改成 0）判定就整体偏移。
 *
 * 时序上也做了处理：`scroll` 事件在绘制之前派发，这里**同步**测量并改 ref，
 * Vue 在微任务里更新 class，仍然赶在同一帧绘制前完成 —— 不会出现「先画一帧圆角边框、
 * 下一帧才变方」的闪烁。
 */
export function useStickyStuck(
  barRef: Ref<HTMLElement | null>,
  anchorRef: Ref<HTMLElement | null>
) {
  const stuck = ref(false)

  let frame = 0
  let observer: ResizeObserver | null = null

  /** 量一次；`scroll` 走这条路（同步，保证同一帧生效） */
  function measure(): void {
    if (frame) {
      cancelAnimationFrame(frame)
      frame = 0
    }
    const bar = barRef.value
    const anchor = anchorRef.value
    if (!bar || !anchor) return
    const barTop = bar.getBoundingClientRect().top
    const naturalTop = anchor.getBoundingClientRect().top
    // 钉住后栏体停在视口顶端，而锚点已经跟着内容滚上去了 —— 栏体 top 反而更大
    // 0.5px 容差：亚像素滚动/缩放会让两者差零点几像素
    const next = barTop > naturalTop + 0.5
    if (next !== stuck.value) stuck.value = next
  }

  /** 布局变化（窗口尺寸、栏体自身高度变化）走 rAF，避免同一任务里反复测量 */
  function schedule(): void {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      measure()
    })
  }

  onMounted(() => {
    measure()
    void nextTick(measure)
    // 捕获阶段能收到**任意**滚动容器的 scroll（scroll 不冒泡，但会走捕获）
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', schedule)
    // 窗口从后台/最小化回来时补一次：后台期间渲染生命周期是停的，scroll 事件可能没派发
    window.addEventListener('focus', schedule)
    document.addEventListener('visibilitychange', schedule)
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule)
      if (barRef.value) observer.observe(barRef.value)
      if (anchorRef.value) observer.observe(anchorRef.value)
    }
  })

  onBeforeUnmount(() => {
    if (frame) {
      cancelAnimationFrame(frame)
      frame = 0
    }
    window.removeEventListener('scroll', measure, true)
    window.removeEventListener('resize', schedule)
    window.removeEventListener('focus', schedule)
    document.removeEventListener('visibilitychange', schedule)
    observer?.disconnect()
    observer = null
  })

  return { stuck, measure }
}
