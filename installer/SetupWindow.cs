using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace CountingDown.Setup
{
    /// <summary>自绘页面的容器：开双缓冲，避免滑动时闪烁。</summary>
    internal class BufferedPanel : Panel
    {
        public BufferedPanel()
        {
            DoubleBuffered = true;
            ResizeRedraw = true;
            BackColor = Palette.Bg;
        }
    }

    internal enum Phase
    {
        Wizard,
        Installing,
        Done,
        Failed
    }

    /// <summary>
    /// 安装窗口。
    ///
    /// 两条原则：
    /// 1. 界面全是自绘的 —— 原生控件在深色窗体上没法看；
    /// 2. 所有过渡都用「真实时间 + 缓动函数」驱动（见 Anim），
    ///    不用 Thread.Sleep 或「每帧加 8 像素」去凑，快慢机上都一样顺。
    /// </summary>
    internal class SetupWindow : Form
    {
        private const int BaseWidth = 720;
        private const int BaseHeight = 460;
        private const int HeaderHeight = 56;
        private const int FooterHeight = 72;

        private readonly InstallOptions _options;
        private readonly bool _auto;

        private Phase _phase = Phase.Wizard;
        private int _step;
        private bool _sliding;
        private bool _closing;

        private CaptionButton _minimize;
        private CaptionButton _close;

        private BufferedPanel _pageWelcome;
        private BufferedPanel _pageOptions;
        private BufferedPanel _pageConfirm;

        // 翻页时把两页先拍成位图再滑动：移动真实控件会带着子窗口一起重排，必卡
        private Bitmap _slideFrom;
        private Bitmap _slideTo;
        private int _slideDir;
        private double _slideT;

        private TextBox _path;
        private FlatButton _browse;
        private CheckRow _desktop;
        private CheckRow _startMenu;
        private CheckRow _autostart;

        private FlatButton _primary;
        private FlatButton _secondary;
        private FlatButton _openFolder;
        private FlatButton _launch;
        private FlatButton _finish;

        private ThinProgress _bar;

        private double _progressShown;
        private double _progressTarget;
        private double _statusFade = 1;
        private string _statusNew = "";
        private string _statusOld = "";
        private string _detail = "";
        private string _error = "";
        private double _doneT;
        private object _progressLoop;

        /* 性能自检：把每一帧的时间间隔记下来，用数字说话而不是「感觉挺顺」 */
        internal readonly System.Collections.Generic.List<double> FrameDeltas =
            new System.Collections.Generic.List<double>();
        internal bool Bench;
        private readonly Stopwatch _bench = new Stopwatch();

        private float S
        {
            get { return DeviceDpi / 96f; }
        }

        public SetupWindow(InstallOptions options, bool auto)
        {
            _options = options;
            _auto = auto;

            Text = "倒数日 " + BuildInfo.Version + " 安装程序";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(I(BaseWidth), I(BaseHeight));
            BackColor = Palette.Bg;
            DoubleBuffered = true;
            KeyPreview = true;
            ShowInTaskbar = true;
            Opacity = 0;
            // 任务栏与 Alt+Tab 用 exe 里的图标（csproj 的 ApplicationIcon 写入的那个）
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            BuildControls();
            ApplyRegion();
            LayoutAll();
            ApplyPhase();

            Shown += (s, e) =>
            {
                Activate();
                Anim.Run(220, Anim.OutCubic, t => Opacity = t);
                if (_auto) StartInstall();
            };
        }

        private int I(float value)
        {
            return (int)Math.Round(value * S);
        }

        /// <summary>
        /// 加上 WS_MINIMIZEBOX：没有这一位，最小化是「啪」地消失；
        /// 有了它才是 DWM 的原生缩放淡出动画。
        /// </summary>
        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.Style |= 0x00020000; // WS_MINIMIZEBOX
                cp.Style |= 0x00080000; // WS_SYSMENU
                return cp;
            }
        }

        private void BuildControls()
        {
            _minimize = new CaptionButton();
            _close = new CaptionButton { IsClose = true };
            _minimize.Click += (s, e) => WindowState = FormWindowState.Minimized;
            _close.Click += (s, e) => CloseRequest();

            /* ---------------- 第一页：主界面 ---------------- */
            _pageWelcome = new BufferedPanel();
            _pageWelcome.Paint += PaintWelcomePage;

            /* ---------------- 第二页：安装位置与选项 ---------------- */
            _pageOptions = new BufferedPanel();
            _pageOptions.Paint += PaintOptionsPage;

            _path = new TextBox
            {
                BorderStyle = BorderStyle.None,
                BackColor = Palette.InputBg,
                ForeColor = Palette.Text,
                Font = new Font("Consolas", 9.5f),
                Text = _options.TargetDir
            };
            _path.TextChanged += (s, e) => _options.TargetDir = _path.Text;

            _browse = new FlatButton { Text = "浏览…" };
            _browse.Click += (s, e) => BrowseFolder();

            _desktop = new CheckRow { Text = "创建桌面快捷方式", Checked = true };
            _startMenu = new CheckRow { Text = "创建开始菜单快捷方式", Checked = true };
            _autostart = new CheckRow { Text = "开机自动启动（以隐藏方式运行）" };

            _pageOptions.Controls.AddRange(new Control[] { _path, _browse, _desktop, _startMenu, _autostart });

            /* ---------------- 第二页：确认 ---------------- */
            _pageConfirm = new BufferedPanel { Visible = false };
            _pageConfirm.Paint += PaintConfirmPage;

            /* ---------------- 底栏按钮 ---------------- */
            _secondary = new FlatButton { Text = "取消" };
            _secondary.Click += (s, e) => OnSecondary();
            _primary = new FlatButton { Text = "下一步", Primary = true };
            _primary.Click += (s, e) => OnPrimary();

            _openFolder = new FlatButton { Text = "打开文件夹" };
            _openFolder.Click += (s, e) => OpenTarget();
            _launch = new FlatButton { Text = "立即启动", Primary = true };
            _launch.Click += (s, e) =>
            {
                Installer.Launch(_options.TargetDir, false);
                CloseRequest();
            };
            _finish = new FlatButton { Text = "完成" };
            _finish.Click += (s, e) => CloseRequest();

            _bar = new ThinProgress();

            Controls.Add(_pageWelcome);
            Controls.Add(_pageOptions);
            Controls.Add(_pageConfirm);
            Controls.AddRange(new Control[]
            {
                _minimize, _close, _secondary, _primary, _openFolder, _launch, _finish, _bar
            });

            // 面板盖住内容区，底栏与角标按钮要在最上层
            _primary.BringToFront();
            _secondary.BringToFront();
            _openFolder.BringToFront();
            _launch.BringToFront();
            _finish.BringToFront();
            _minimize.BringToFront();
            _close.BringToFront();
        }

        /* ------------------------------------------------------------------ 布局 */

        private int ContentTop
        {
            get { return I(HeaderHeight); }
        }

        private int ContentHeight
        {
            get { return ClientSize.Height - I(HeaderHeight) - I(FooterHeight); }
        }

        private void LayoutAll()
        {
            if (_primary == null || _path == null || _bar == null) return;

            int w = ClientSize.Width;
            int h = ClientSize.Height;
            int top = ContentTop;
            int ch = ContentHeight;
            int left = I(36);
            int right = w - I(36);

            _pageWelcome.Bounds = new Rectangle(0, top, w, ch);
            _pageOptions.Bounds = new Rectangle(0, top, w, ch);
            _pageConfirm.Bounds = new Rectangle(0, top, w, ch);

            _close.Location = new Point(w - I(42), I(13));
            _minimize.Location = new Point(w - I(78), I(13));

            _path.Location = new Point(left + I(14), I(152));
            _path.Width = right - left - I(96) - I(28);
            _path.Height = I(20);

            _browse.Location = new Point(right - I(96), I(144));
            _browse.Size = new Size(I(96), I(34));

            _desktop.Location = new Point(left, I(196));
            _desktop.Width = right - left;
            _startMenu.Location = new Point(left, I(226));
            _startMenu.Width = right - left;
            _autostart.Location = new Point(left, I(256));
            _autostart.Width = right - left;

            _bar.Location = new Point(left, I(160));
            _bar.Width = right - left;

            int footerY = h - I(FooterHeight) + I(19);
            _primary.Size = new Size(I(104), I(36));
            _primary.Location = new Point(right - I(104), footerY);
            _secondary.Size = new Size(I(88), I(36));
            _secondary.Location = new Point(right - I(104) - I(10) - I(88), footerY);

            _finish.Size = new Size(I(88), I(36));
            _finish.Location = new Point(right - I(88), footerY);
            _launch.Size = new Size(I(104), I(36));
            _launch.Location = new Point(right - I(88) - I(10) - I(104), footerY);
            _openFolder.Size = new Size(I(100), I(36));
            _openFolder.Location = new Point(right - I(88) - I(10) - I(104) - I(10) - I(100), footerY);
        }

        private void ApplyRegion()
        {
            using (var path = Draw.Round(new RectangleF(0, 0, Width, Height), I(12)))
            {
                Region = new Region(path);
            }
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            ApplyRegion();
            LayoutAll();
        }

        /* ------------------------------------------------------------------ 状态 */

        private void ApplyPhase()
        {
            bool wizard = _phase == Phase.Wizard;
            bool done = _phase == Phase.Done;
            bool failed = _phase == Phase.Failed;

            _pageWelcome.Visible = wizard && _step == 0;
            _pageOptions.Visible = wizard && _step == 1;
            _pageConfirm.Visible = wizard && _step == 2;
            _secondary.Visible = wizard;
            _primary.Visible = wizard;
            _bar.Visible = _phase == Phase.Installing;
            _openFolder.Visible = done;
            _launch.Visible = done;
            _finish.Visible = done || failed;
            _finish.Text = failed ? "关闭" : "完成";
            _close.Visible = _phase != Phase.Installing;

            UpdateFooterText();
            LayoutAll();
            Invalidate(true);
        }

        private void UpdateFooterText()
        {
            if (_phase != Phase.Wizard) return;
            _secondary.Text = _step == 0 ? "取消" : "上一步";
            _primary.Text = _step == 2 ? "安装" : "下一步";
        }

        private void OnSecondary()
        {
            if (_sliding) return;
            if (_step == 0) CloseRequest();
            else GoStep(_step - 1);
        }

        private void OnPrimary()
        {
            if (_sliding) return;
            if (_step < 2) GoStep(_step + 1);
            else StartInstall();
        }

        private BufferedPanel PageAt(int step)
        {
            if (step == 0) return _pageWelcome;
            if (step == 1) return _pageOptions;
            return _pageConfirm;
        }

        /// <summary>
        /// 翻页：先把两页拍成位图，再滑动位图。
        ///
        /// 直接改 Panel.Left 会连着里面的 TextBox / 按钮一起移动 ——
        /// 每个都是一块真实子窗口，每帧移动都要重排重绘，看着就是一帧一帧的。
        /// 拍成图之后每帧只画两张图片，剩下的交给双缓冲合成。
        /// </summary>
        private void GoStep(int target)
        {
            if (target < 0 || target > 2 || target == _step || _sliding) return;

            var outgoing = PageAt(_step);
            var incoming = PageAt(target);
            int dir = target > _step ? 1 : -1;

            _sliding = true;
            _secondary.Enabled = false;
            _primary.Enabled = false;

            // 目标页要先显示出来才能拍照
            incoming.Visible = true;
            incoming.BringToFront();
            incoming.PerformLayout();
            Application.DoEvents();

            _slideFrom = Snapshot(outgoing);
            _slideTo = Snapshot(incoming);
            _slideDir = dir;
            _slideT = 0;

            outgoing.Visible = false;
            incoming.Visible = false;

            Anim.Run(
                320,
                Anim.InOutCubic,
                t =>
                {
                    _slideT = t;
                    Repaint();
                },
                () =>
                {
                    _step = target;
                    if (_slideFrom != null) _slideFrom.Dispose();
                    if (_slideTo != null) _slideTo.Dispose();
                    _slideFrom = null;
                    _slideTo = null;
                    _sliding = false;
                    _secondary.Enabled = true;
                    _primary.Enabled = true;
                    UpdateFooterText();
                    ApplyPhase();
                });
        }

        private Bitmap Snapshot(Control page)
        {
            var width = Math.Max(1, page.Width);
            var height = Math.Max(1, page.Height);
            var bitmap = new Bitmap(width, height);
            page.DrawToBitmap(bitmap, new Rectangle(0, 0, width, height));
            return bitmap;
        }

        /* 截图模式用：直接摆到指定状态，不触发真实安装 */
        /// <summary>
        /// 立刻重绘一帧。
        /// 只用 Invalidate() 的话，一帧动画可能被消息循环合并掉（实测 320ms 只画了 3 次），
        /// 看起来就是「一帧一帧」的。Update() 会同步把无效区画掉，保证每帧都落一次。
        /// </summary>
        private void Repaint()
        {
            Invalidate();
            Update();
        }

        internal void BenchStart()
        {
            FrameDeltas.Clear();
            Bench = true;
            _bench.Restart();
        }

        internal void BenchStop()
        {
            Bench = false;
            _bench.Reset();
        }

        internal void NextForBench()
        {
            GoStep(Math.Min(2, _step + 1));
        }

        internal int CurrentStep
        {
            get { return _step; }
        }

        internal void ForceStep(int step)
        {
            _step = Math.Max(0, Math.Min(2, step));
            ApplyPhase();
        }

        internal void ForceInstalling()
        {
            _phase = Phase.Installing;
            _progressShown = 0.42;
            _progressTarget = 0.42;
            _statusNew = "解压 512 / 733";
            _statusOld = "";
            _detail = "共 733 个文件，273.5 MB";
            ApplyPhase();
            _bar.Value = _progressShown;
            Invalidate(true);
        }

        internal void ForceDone()
        {
            _phase = Phase.Done;
            _doneT = 1;
            ApplyPhase();
            Invalidate(true);
        }

        private void CloseRequest()
        {
            if (_phase == Phase.Installing || _closing) return;
            _closing = true;
            // 关闭也走淡出，别一下子消失
            Anim.Run(160, Anim.OutCubic, t => Opacity = 1 - t, () => Close());
        }

        /* ------------------------------------------------------------------ 安装 */

        private async void StartInstall()
        {
            if (_phase != Phase.Wizard) return;
            if (string.IsNullOrWhiteSpace(_options.TargetDir))
            {
                MessageBox.Show(this, "请先选择安装位置。", "倒数日", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            _options.DesktopShortcut = _desktop.Checked;
            _options.StartMenuShortcut = _startMenu.Checked;
            _options.StartAtLogin = _autostart.Checked;

            _phase = Phase.Installing;
            _progressShown = 0;
            _progressTarget = 0;
            _statusNew = "正在安装…";
            _statusOld = "";
            _statusFade = 1;
            _detail = "";
            ApplyPhase();

            // 进度条不直接跳到目标值：用指数逼近，数值大跳时也是滑过去的
            _progressLoop = Anim.Loop(dt =>
            {
                if (Math.Abs(_progressTarget - _progressShown) < 0.0015) return;
                double k = 1 - Math.Exp(-dt * 11);
                _progressShown += (_progressTarget - _progressShown) * k;
                _bar.Value = _progressShown;
                _bar.Update();
            });

            var options = _options;
            var report = new Progress<Tuple<string, double>>(p =>
            {
                if (p.Item1 != _statusNew)
                {
                    _statusOld = _statusNew;
                    _statusNew = p.Item1;
                    _statusFade = 0;
                    Anim.Run(200, Anim.OutCubic, t =>
                    {
                        _statusFade = t;
                        Repaint();
                    });
                }
                _progressTarget = p.Item2;
                Invalidate();
            });
            var log = new Progress<string>(line =>
            {
                _detail = line;
                Invalidate();
            });

            try
            {
                await Task.Run(() => Installer.Install(
                    options,
                    (step, value) => ((IProgress<Tuple<string, double>>)report).Report(Tuple.Create(step, value)),
                    line => ((IProgress<string>)log).Report(line)));

                _progressTarget = 1;
                _phase = Phase.Done;
                _doneT = 0;
                Anim.Run(460, Anim.OutBack, t =>
                {
                    _doneT = t;
                    Repaint();
                });
            }
            catch (Exception error)
            {
                _error = error.Message;
                _phase = Phase.Failed;
            }

            Anim.Stop(_progressLoop);
            _progressLoop = null;
            ApplyPhase();
        }

        private void BrowseFolder()
        {
            using (var dialog = new FolderBrowserDialog())
            {
                dialog.Description = "选择倒数日的安装位置";
                dialog.SelectedPath = Directory.Exists(_options.TargetDir)
                    ? _options.TargetDir
                    : Path.GetDirectoryName(_options.TargetDir);
                if (dialog.ShowDialog(this) != DialogResult.OK) return;

                var picked = dialog.SelectedPath;
                _options.TargetDir = string.Equals(
                    Path.GetFileName(picked.TrimEnd('\\')), "CountingDown", StringComparison.OrdinalIgnoreCase)
                    ? picked
                    : Path.Combine(picked, "CountingDown");
                _path.Text = _options.TargetDir;
            }
        }

        private void OpenTarget()
        {
            try
            {
                Process.Start("explorer.exe", "\"" + _options.TargetDir + "\"");
            }
            catch
            {
                // 打不开就算了
            }
        }

        /* ------------------------------------------------------------------ 绘制 */

        protected override void OnPaint(PaintEventArgs e)
        {
            // 必须在最前面记：下面的滑动分支会 early return，记在末尾就漏掉全部动画帧
            if (Bench)
            {
                if (_bench.IsRunning) FrameDeltas.Add(_bench.Elapsed.TotalMilliseconds);
                _bench.Restart();
            }

            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

            using (var brush = new SolidBrush(Palette.Bg))
            {
                g.FillRectangle(brush, ClientRectangle);
            }

            DrawHeader(g);
            DrawFooter(g);

            if (_slideFrom != null && _slideTo != null)
            {
                int offset = (int)Math.Round(ClientSize.Width * _slideT);
                var clip = g.Clip;
                g.SetClip(new Rectangle(0, ContentTop, ClientSize.Width, ContentHeight));
                g.DrawImageUnscaled(_slideFrom, -_slideDir * offset, ContentTop);
                g.DrawImageUnscaled(_slideTo, _slideDir * (ClientSize.Width - offset), ContentTop);
                g.Clip = clip;
                return;
            }

            if (_phase == Phase.Installing) DrawInstalling(g);
            else if (_phase == Phase.Done) DrawDone(g);
            else if (_phase == Phase.Failed) DrawFailed(g);

            using (var pen = new Pen(Palette.Stroke))
            {
                g.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
            }

        }

        private void DrawHeader(Graphics g)
        {
            int left = I(24);
            DrawMark(g, new RectangleF(left, I(15), I(26), I(26)));

            using (var font = new Font("Microsoft YaHei UI", 10f, FontStyle.Bold))
            {
                TextRenderer.DrawText(g, BuildInfo.AppName, font, new Point(left + I(36), I(19)), Palette.Text,
                    TextFormatFlags.NoPadding);
            }

            using (var font = new Font("Microsoft YaHei UI", 9f))
            {
                var text = "安装程序 · v" + BuildInfo.Version;
                var size = TextRenderer.MeasureText(g, text, font, Size.Empty, TextFormatFlags.NoPadding);
                TextRenderer.DrawText(g, text, font,
                    new Point(ClientSize.Width - I(96) - size.Width, I(21)), Palette.TextFaint,
                    TextFormatFlags.NoPadding);
            }

            using (var pen = new Pen(Palette.StrokeSoft))
            {
                g.DrawLine(pen, 0, I(HeaderHeight), ClientSize.Width, I(HeaderHeight));
            }
        }

        private void DrawFooter(Graphics g)
        {
            int y = ClientSize.Height - I(FooterHeight);
            using (var pen = new Pen(Palette.StrokeSoft))
            {
                g.DrawLine(pen, 0, y, ClientSize.Width, y);
            }

            using (var font = new Font("Microsoft YaHei UI", 8.5f))
            {
                string hint;
                if (_phase == Phase.Done) hint = "已安装到 " + _options.TargetDir;
                else if (_phase == Phase.Installing) hint = "正在写入文件，请不要关闭窗口";
                else if (_phase == Phase.Wizard) hint = _step == 0
                    ? "第 1 步 / 共 3 步 · 装到当前用户目录，不需要管理员权限"
                    : _step == 1
                        ? "第 2 步 / 共 3 步 · 选个位置，其余保持默认就行"
                        : "第 3 步 / 共 3 步 · 确认后开始安装";
                else hint = "可以关掉这个窗口，不影响已安装的内容";

                var rect = new Rectangle(I(36), y, ClientSize.Width - I(36) - I(340), I(FooterHeight));
                TextRenderer.DrawText(g, hint, font, rect, Palette.TextFaint,
                    TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding |
                    TextFormatFlags.EndEllipsis);
            }
        }

        /* ---------------- 主界面 ---------------- */

        private void PaintWelcomePage(object sender, PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

            DrawMark(g, new RectangleF(I(36), I(34), I(88), I(88)));

            using (var font = new Font("Microsoft YaHei UI", 24f, FontStyle.Bold))
            {
                TextRenderer.DrawText(g, BuildInfo.AppName, font, new Point(I(146), I(40)), Palette.Text,
                    TextFormatFlags.NoPadding);
            }

            using (var font = new Font("Microsoft YaHei UI", 9.5f))
            {
                TextRenderer.DrawText(g, "v" + BuildInfo.Version + "   ·   Windows 桌面小组件", font,
                    new Point(I(148), I(80)), Palette.TextDim, TextFormatFlags.NoPadding);
            }

            using (var pen = new Pen(Palette.StrokeSoft))
            {
                g.DrawLine(pen, I(36), I(148), ClientSize.Width - I(36), I(148));
            }

            using (var font = new Font("Microsoft YaHei UI", 10f))
            {
                TextRenderer.DrawText(g, "一个把日子数给你看的桌面小组件，装在角落，不占地方。", font,
                    new Rectangle(I(36), I(172), ClientSize.Width - I(72), I(28)), Palette.Text,
                    TextFormatFlags.Left | TextFormatFlags.NoPadding);
            }

            using (var font = new Font("Microsoft YaHei UI", 9f))
            {
                var lines = "   ·  桌面卡片 + 托盘常驻，倒计时随时看得到\r\n" +
                            "   ·  完全离线运行，不联网也能用\r\n" +
                            "   ·  只装进当前用户目录，不需要管理员权限";
                TextRenderer.DrawText(g, lines, font,
                    new Rectangle(I(36), I(212), ClientSize.Width - I(72), I(96)), Palette.TextFaint,
                    TextFormatFlags.Left | TextFormatFlags.WordBreak | TextFormatFlags.NoPadding);
            }
        }

        /* ---------------- 第二页 ---------------- */

        private void PaintOptionsPage(object sender, PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

            DrawMark(g, new RectangleF(I(36), I(22), I(64), I(64)));

            using (var font = new Font("Microsoft YaHei UI", 17f, FontStyle.Bold))
            {
                TextRenderer.DrawText(g, BuildInfo.AppName, font, new Point(I(116), I(26)), Palette.Text,
                    TextFormatFlags.NoPadding);
            }

            using (var font = new Font("Microsoft YaHei UI", 9.5f))
            {
                TextRenderer.DrawText(g, "v" + BuildInfo.Version + "   ·   Windows 桌面小组件", font,
                    new Point(I(118), I(58)), Palette.TextDim, TextFormatFlags.NoPadding);
            }

            using (var pen = new Pen(Palette.StrokeSoft))
            {
                g.DrawLine(pen, I(36), I(106), ClientSize.Width - I(36), I(106));
            }

            using (var font = new Font("Microsoft YaHei UI", 9f))
            {
                TextRenderer.DrawText(g, "安装位置", font, new Point(I(36), I(124)), Palette.TextDim,
                    TextFormatFlags.NoPadding);
            }

            var rect = new RectangleF(I(36), I(144), ClientSize.Width - I(36) * 2 - I(96) - I(12), I(34));
            Draw.FillRound(g, rect, I(8), Palette.InputBg);
            Draw.StrokeRound(g, rect, I(8), Palette.Stroke);
        }

        /* ---------------- 第二页 ---------------- */

        private void PaintConfirmPage(object sender, PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

            using (var font = new Font("Microsoft YaHei UI", 15f, FontStyle.Bold))
            {
                TextRenderer.DrawText(g, "确认一下", font, new Point(I(36), I(26)), Palette.Text,
                    TextFormatFlags.NoPadding);
            }

            using (var font = new Font("Microsoft YaHei UI", 9f))
            {
                TextRenderer.DrawText(g, "没问题就开始装，装完会自动登记卸载入口", font,
                    new Point(I(36), I(58)), Palette.TextFaint, TextFormatFlags.NoPadding);
            }

            var rows = new[]
            {
                Tuple.Create("安装到", _options.TargetDir),
                Tuple.Create("桌面快捷方式", _desktop.Checked ? "创建" : "不创建"),
                Tuple.Create("开始菜单", _startMenu.Checked ? "创建" : "不创建"),
                Tuple.Create("开机启动", _autostart.Checked ? "开启（隐藏运行）" : "不开启")
            };

            int y = I(104);
            for (int i = 0; i < rows.Length; i++)
            {
                if (i > 0)
                {
                    using (var pen = new Pen(Palette.StrokeSoft))
                    {
                        g.DrawLine(pen, I(36), y - I(8), ClientSize.Width - I(36), y - I(8));
                    }
                }

                using (var label = new Font("Microsoft YaHei UI", 9f))
                using (var value = new Font("Microsoft YaHei UI", 9.5f))
                {
                    TextRenderer.DrawText(g, rows[i].Item1, label, new Point(I(36), y + I(4)), Palette.TextDim,
                        TextFormatFlags.NoPadding);
                    var rect = new Rectangle(I(160), y, ClientSize.Width - I(160) - I(36), I(28));
                    TextRenderer.DrawText(g, rows[i].Item2, value, rect, Palette.Text,
                        TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding |
                        TextFormatFlags.EndEllipsis);
                }

                y += I(46);
            }
        }

        /* ---------------- 安装中 ---------------- */

        private void DrawInstalling(Graphics g)
        {
            int fade = (int)Math.Round(255 * _statusFade);

            if (_statusOld.Length > 0)
            {
                using (var font = new Font("Microsoft YaHei UI", 14f, FontStyle.Bold))
                {
                    TextRenderer.DrawText(g, _statusOld, font, new Point(I(36), I(100)),
                        Color.FromArgb(Math.Max(0, 255 - fade), Palette.Text), TextFormatFlags.NoPadding);
                }
            }

            if (_statusNew.Length > 0)
            {
                using (var font = new Font("Microsoft YaHei UI", 14f, FontStyle.Bold))
                {
                    TextRenderer.DrawText(g, _statusNew, font, new Point(I(36), I(100)),
                        Color.FromArgb(Math.Min(255, fade), Palette.Text), TextFormatFlags.NoPadding);
                }
            }

            using (var font = new Font("Microsoft YaHei UI", 9f))
            {
                TextRenderer.DrawText(g, _detail, font, new Point(I(36), I(190)), Palette.TextFaint,
                    TextFormatFlags.NoPadding);

                var percent = ((int)Math.Round(_progressShown * 100)) + "%";
                var size = TextRenderer.MeasureText(g, percent, font, Size.Empty, TextFormatFlags.NoPadding);
                TextRenderer.DrawText(g, percent, font,
                    new Point(ClientSize.Width - I(36) - size.Width, I(190)), Palette.TextDim,
                    TextFormatFlags.NoPadding);
            }
        }

        /* ---------------- 完成 / 失败 ---------------- */

        private void DrawDone(Graphics g)
        {
            // 完成页直接画在窗体上，纵坐标要加上内容区起点（56），否则会压到标题栏
            int top = ContentTop;
            var box = new RectangleF(I(36), top + I(22), I(64), I(64));
            float scale = (float)(0.72 + 0.28 * _doneT);
            var scaled = new RectangleF(
                box.X + box.Width * (1 - scale) / 2,
                box.Y + box.Height * (1 - scale) / 2,
                box.Width * scale,
                box.Height * scale);

            int alpha = (int)Math.Round(255 * Math.Min(1, _doneT * 1.6));

            using (var path = Draw.Round(scaled, I(16) * scale))
            using (var brush = new LinearGradientBrush(scaled, Palette.Accent, Palette.Accent2, 30f))
            {
                g.FillPath(brush, path);
            }
            using (var pen = new Pen(Color.FromArgb(alpha, Color.White), I(3.2f) * scale))
            {
                pen.StartCap = LineCap.Round;
                pen.EndCap = LineCap.Round;
                g.DrawLines(pen, new[]
                {
                    new PointF(scaled.X + scaled.Width * 0.26f, scaled.Y + scaled.Height * 0.52f),
                    new PointF(scaled.X + scaled.Width * 0.44f, scaled.Y + scaled.Height * 0.70f),
                    new PointF(scaled.X + scaled.Width * 0.74f, scaled.Y + scaled.Height * 0.33f)
                });
            }

            using (var font = new Font("Microsoft YaHei UI", 15f, FontStyle.Bold))
            {
                TextRenderer.DrawText(g, "安装完成", font, new Point(I(116), top + I(26)), Palette.Text,
                    TextFormatFlags.NoPadding);
            }

            using (var font = new Font("Microsoft YaHei UI", 9.5f))
            {
                var text = "托盘里会多一个图标，卡片默认出现在屏幕右上角。\r\n右键托盘可以改位置、隐藏卡片，或者彻底退出。";
                TextRenderer.DrawText(g, text, font, new Rectangle(I(116), top + I(58), ClientSize.Width - I(152), I(56)),
                    Palette.TextDim, TextFormatFlags.Left | TextFormatFlags.WordBreak | TextFormatFlags.NoPadding);
            }

            using (var font = new Font("Microsoft YaHei UI", 9f))
            {
                var tips = "接下来\r\n" +
                           "   ·  左键单击托盘图标：显示 / 隐藏卡片\r\n" +
                           "   ·  右键托盘：位置、鼠标穿透、快捷键、设置\r\n" +
                           "   ·  卸载：Windows 设置 → 应用 → 已安装的应用 → 倒数日";
                TextRenderer.DrawText(g, tips, font, new Rectangle(I(36), top + I(140), ClientSize.Width - I(72), I(140)),
                    Palette.TextFaint, TextFormatFlags.Left | TextFormatFlags.WordBreak | TextFormatFlags.NoPadding);
            }
        }

        private void DrawFailed(Graphics g)
        {
            int top = ContentTop;
            var box = new RectangleF(I(36), top + I(22), I(64), I(64));
            Draw.FillRound(g, box, I(16), ColorTranslator.FromHtml("#3A1520"));
            using (var font = new Font("Microsoft YaHei UI", 22f, FontStyle.Bold))
            {
                TextRenderer.DrawText(g, "!", font, Rectangle.Round(box), Palette.Danger,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
            }

            using (var font = new Font("Microsoft YaHei UI", 15f, FontStyle.Bold))
            {
                TextRenderer.DrawText(g, "安装没有完成", font, new Point(I(116), top + I(30)), Palette.Text,
                    TextFormatFlags.NoPadding);
            }

            using (var font = new Font("Microsoft YaHei UI", 9.5f))
            {
                TextRenderer.DrawText(g, _error, font,
                    new Rectangle(I(116), top + I(62), ClientSize.Width - I(152), I(120)), Palette.Danger,
                    TextFormatFlags.Left | TextFormatFlags.WordBreak | TextFormatFlags.NoPadding);
            }
        }

        /// <summary>应用标记：渐变圆角方块 + 白色「27」，跟 icon 同源</summary>
        private void DrawMark(Graphics g, RectangleF rect)
        {
            using (var path = Draw.Round(rect, rect.Width * 0.24f))
            using (var brush = new LinearGradientBrush(rect, Palette.Accent, Palette.Accent2, 55f))
            {
                g.FillPath(brush, path);
            }
            using (var font = new Font("Microsoft YaHei UI", rect.Width * 0.42f, FontStyle.Bold))
            {
                TextRenderer.DrawText(g, "27", font, Rectangle.Round(rect), Color.White,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            }
        }

        /* ------------------------------------------------------------------ 窗口行为 */

        protected override void WndProc(ref Message m)
        {
            const int WM_NCHITTEST = 0x0084;
            const int HTCAPTION = 2;
            const int WM_NCLBUTTONDBLCLK = 0x00A3;

            if (m.Msg == WM_NCHITTEST)
            {
                int y = (short)((long)m.LParam & 0xFFFF);
                var client = PointToClient(new Point(0, y));
                if (client.Y >= 0 && client.Y < I(HeaderHeight))
                {
                    m.Result = (IntPtr)HTCAPTION;
                    return;
                }
            }
            else if (m.Msg == WM_NCLBUTTONDBLCLK)
            {
                m.Result = IntPtr.Zero;
                return;
            }

            base.WndProc(ref m);
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape && _phase != Phase.Installing) CloseRequest();
            base.OnKeyDown(e);
        }
    }
}
