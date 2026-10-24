using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Windows.Forms;

namespace CountingDown.Setup
{
    /// <summary>
    /// 动画驱动：一条 60fps 的界面线程定时器 + 真实时间（Stopwatch），
    /// 所有过渡都按「已过时间 / 时长」算进度再套缓动函数。
    /// 不写死每次加多少像素 —— 那样在慢机器上是慢动作、快机器上一闪而过。
    /// </summary>
    internal static class Anim
    {
        private class Ticker
        {
            public Stopwatch Clock = Stopwatch.StartNew();
            public int Duration;
            public Func<double, double> Ease;
            public Action<double> Frame;
            public Action Done;
            public bool Loop;
            public long LastMs;
            public bool Cancelled;
        }

        private static readonly List<Ticker> Items = new List<Ticker>();

        private static readonly Timer Pulse = new Timer { Interval = 8 };
        private static long _lastPump;

        static Anim()
        {
            // 两路驱动，谁先到谁干活：
            // - Application.Idle：消息队列一空就跑，正常情况下这就是满帧；
            // - 8ms 的 WinForms Timer：Idle 在某些情况下（窗口被遮挡、消息一直有积压）
            //   会迟迟不触发，光靠 Idle 会导致动画卡住不动。
            // 两者都调用 Pump()，内部按 4ms 去重，不会重复推进时间。
            Application.Idle += (s, e) =>
            {
                if (Items.Count > 0) Pump();
            };
            Pulse.Tick += (s, e) =>
            {
                if (Items.Count > 0) Pump();
            };
            Pulse.Start();
        }

        /// <summary>缓动：先快后慢（进入画面用）</summary>
        public static double OutCubic(double t)
        {
            return 1 - Math.Pow(1 - t, 3);
        }

        /// <summary>缓动：两头慢中间快（翻页用）</summary>
        public static double InOutCubic(double t)
        {
            return t < 0.5 ? 4 * t * t * t : 1 - Math.Pow(-2 * t + 2, 3) / 2;
        }

        /// <summary>缓动：冲过头一点再回来（打勾用）</summary>
        public static double OutBack(double t)
        {
            const double c1 = 1.70158;
            const double c3 = c1 + 1;
            return 1 + c3 * Math.Pow(t - 1, 3) + c1 * Math.Pow(t - 1, 2);
        }

        public static void Run(int durationMs, Func<double, double> ease, Action<double> frame, Action done = null)
        {
            if (durationMs <= 0)
            {
                frame(1);
                if (done != null) done();
                return;
            }
            var ticker = new Ticker { Duration = durationMs, Ease = ease ?? OutCubic, Frame = frame, Done = done };
            Items.Add(ticker);
        }

        /// <summary>常驻循环（暂停恢复用）：frame 收到的是距上一帧的秒数</summary>
        public static object Loop(Action<double> frame)
        {
            var ticker = new Ticker { Loop = true, Frame = frame, Ease = null };
            Items.Add(ticker);
            return ticker;
        }

        public static void Stop(object handle)
        {
            var ticker = handle as Ticker;
            if (ticker != null) ticker.Cancelled = true;
        }


        private static void Pump()
        {
            if (Items.Count == 0) return;

            // 两路驱动会同时叫醒，4ms 内的第二次调用直接忽略
            long stamp = Environment.TickCount;
            if (stamp - _lastPump < 4) return;
            _lastPump = stamp;

            foreach (var ticker in Items.ToArray())
            {
                if (ticker.Cancelled)
                {
                    Items.Remove(ticker);
                    continue;
                }

                long now = ticker.Clock.ElapsedMilliseconds;
                double dt = (now - ticker.LastMs) / 1000.0;
                ticker.LastMs = now;

                if (ticker.Loop)
                {
                    ticker.Frame(dt);
                    continue;
                }

                double progress = Math.Min(1.0, (double)now / ticker.Duration);
                ticker.Frame(ticker.Ease(progress));
                if (progress >= 1)
                {
                    Items.Remove(ticker);
                    if (ticker.Done != null) ticker.Done();
                }
            }
        }
    }
}
